import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import {
  getSmtpConfig,
  sendContactMessage,
  type ContactMessage,
} from "./contact.js";
import { createGithubService } from "./getGithubApi.js";
import { getProfileAge, parseProfileBirthMonth } from "./profileAge.js";

type AppOptions = {
  env?: NodeJS.ProcessEnv;
  sendEmail?: (message: ContactMessage) => Promise<void>;
  contactRateLimit?: number;
  githubFetch?: typeof fetch;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum = 1,
) {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }

  return parsed;
}

const contactSchema = z
  .object({
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject ASCII control characters in submitted names.
    name: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/),
    email: z.string().trim().regex(emailPattern).max(254),
    // Only tab and LF are allowed; CR is rejected because CRLF.CRLF ends SMTP DATA.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters that could affect downstream message handling.
    message: z.string().trim().min(10).max(5000).regex(/^[^\u0000-\u0008\u000b-\u001f\u007f]+$/),
  })
  .strict();

export function createApp(options: AppOptions = {}) {
  const env = options.env ?? process.env;
  const smtpConfig = getSmtpConfig(env);
  const profileBirthMonth = parseProfileBirthMonth(
    env.PROFILE_BIRTH_YEAR,
    env.PROFILE_BIRTH_MONTH,
  );
  const profileTimeZone = env.PROFILE_TIME_ZONE ?? "America/Vancouver";
  new Intl.DateTimeFormat("en-US", { timeZone: profileTimeZone });
  const app = express();
  // On Vercel (which sets VERCEL=1) requests always arrive through exactly
  // one trusted proxy; without this, req.ip is a shared internal address and
  // the contact rate limiter would throttle ALL visitors as one client.
  const trustedProxyHops = parseInteger(
    env.TRUST_PROXY_HOPS,
    "TRUST_PROXY_HOPS",
    env.VERCEL ? 1 : 0,
    0,
  );
  const rateLimitWindowMs = parseInteger(
    env.CONTACT_RATE_LIMIT_WINDOW_MS,
    "CONTACT_RATE_LIMIT_WINDOW_MS",
    15 * 60 * 1000,
  );
  const contactRateLimit = options.contactRateLimit ??
    parseInteger(env.CONTACT_RATE_LIMIT, "CONTACT_RATE_LIMIT", 5);
  const allowedOrigins = new Set(
    (env.APP_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  app.disable("x-powered-by");
  app.set("trust proxy", trustedProxyHops);
  app.use(helmet());
  app.use(express.json({ limit: "10kb", strict: true }));
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  const githubService = createGithubService({
    username: env.GITHUB_USERNAME ?? "Gahyki",
    token: env.GITHUB_TOKEN,
    fetcher: options.githubFetch,
  });

  app.get("/api/github", async (_request, response) => {
    try {
      const snapshot = await githubService.getSnapshot();
      // s-maxage lets the CDN absorb traffic (the in-memory cache is
      // per-instance on serverless); browsers revalidate more often.
      response.setHeader(
        "Cache-Control",
        "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
      );
      response.json(snapshot);
    } catch (error) {
      console.error(
        "GitHub snapshot failed.",
        error instanceof Error ? error.message : error,
      );
      response.status(502).json({ error: "GitHub data is unavailable right now." });
    }
  });

  app.get("/api/age", (_request, response) => {
    if (!profileBirthMonth) {
      response.status(503).json({ error: "Age display is not configured." });
      return;
    }

    response.setHeader("Cache-Control", "private, max-age=3600");
    response.json({ age: getProfileAge(profileBirthMonth, profileTimeZone) });
  });

  const contactRateLimiter = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: contactRateLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many messages. Please try again later." },
  });

  app.post(
    "/api/contact",
    (request, response, next) => {
      const origin = request.get("origin");
      if (origin && !allowedOrigins.has(origin)) {
        response.status(403).json({ error: "Request origin is not allowed." });
        return;
      }
      if (!request.is("application/json")) {
        response.status(415).json({ error: "Content-Type must be application/json." });
        return;
      }
      next();
    },
    contactRateLimiter,
    async (request, response) => {
      const parsed = contactSchema.safeParse(request.body);
      if (!parsed.success) {
        const hasInvalidEmail = parsed.error.issues.some(
          (issue) => issue.path[0] === "email" && issue.code === "invalid_format",
        );
        if (hasInvalidEmail) {
          response.status(400).json({
            error: "Please enter a valid email address.",
            field: "email",
          });
          return;
        }

        response.status(400).json({ error: "Please check the contact form fields." });
        return;
      }

      try {
        if (!smtpConfig) {
          response.status(503).json({ error: "Contact delivery is not configured yet." });
          return;
        }

        const sendEmail =
          options.sendEmail ??
          ((message: ContactMessage) => sendContactMessage(smtpConfig, message));
        await sendEmail(parsed.data);
        response.status(202).json({ status: "accepted" });
      } catch (error) {
        console.error(
          "Contact message delivery failed.",
          error instanceof Error ? error.message : "Unknown SMTP error.",
        );
        response.status(502).json({ error: "Message delivery failed. Please try again later." });
      }
    },
  );

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found." });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (response.headersSent) {
      return;
    }

    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({ error: "Request body must be valid JSON." });
      return;
    }

    if (typeof error === "object" && error !== null && "status" in error) {
      const status = error.status;
      if (status === 413) {
        response.status(413).json({ error: "Request body is too large." });
        return;
      }
    }

    console.error("Unhandled API error.", error instanceof Error ? error.message : error);
    response.status(500).json({ error: "Internal server error." });
  };
  app.use(errorHandler);

  return app;
}
