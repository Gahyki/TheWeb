import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../server/app.js";
import { getSmtpConfig, toSmtpBody, type ContactMessage } from "../server/contact.js";
import { EMAIL } from "../server/contactInput.js";
import { startApiServer } from "./apiServer.js";

const origin = "http://localhost:5173";
const message = {
  name: "Test Sender",
  email: "sender@example.com",
  message: "This is a test message with enough characters.",
};
const testSmtpEnv = {
  APP_ORIGIN: origin,
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "test-user",
  SMTP_PASSWORD: "test-password",
  CONTACT_FROM: "website@example.com",
  CONTACT_TO: "owner@example.com",
};

type ContactApi = {
  post: (body: unknown, headers?: Record<string, string>) => Promise<Response>;
  delivered: ContactMessage[];
};

/** Runs `run` against a fresh API whose deliveries land in `delivered`. */
async function withContactApi(
  run: (api: ContactApi) => Promise<void>,
  { env = testSmtpEnv as NodeJS.ProcessEnv, contactRateLimit = 10 } = {},
) {
  const delivered: ContactMessage[] = [];
  const api = await startApiServer(
    createApp({
      env,
      sendEmail: async (contact) => {
        delivered.push(contact);
      },
      contactRateLimit,
    }),
  );
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${api.baseUrl}/api/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, ...headers },
      body: JSON.stringify(body),
    });
  try {
    await run({ post, delivered });
  } finally {
    await api.close();
  }
}

test("contact endpoint validates, restricts origin, sends, and limits requests", () =>
  withContactApi(
    async ({ post, delivered }) => {
      assert.equal((await post(message, { Origin: "https://attacker.example" })).status, 403);
      assert.equal((await post(message, { "Content-Type": "text/plain" })).status, 415);
      assert.equal((await post({ ...message, message: "x".repeat(11_000) })).status, 413);

      const invalidEmail = await post({ ...message, email: "not-an-email" });
      assert.equal(invalidEmail.status, 400);
      assert.deepEqual(await invalidEmail.json(), {
        error: "Please enter a valid email address.",
        field: "email",
      });

      for (let index = 0; index < 2; index += 1) {
        const response = await post(message);
        assert.equal(response.status, 202);
        assert.deepEqual(await response.json(), { status: "accepted" });
      }
      assert.deepEqual(delivered, [message, message]);

      assert.equal((await post(message)).status, 429);
    },
    { contactRateLimit: 3 },
  ));

test("contact endpoint does not claim delivery when SMTP is unconfigured", () =>
  withContactApi(
    async ({ post }) => {
      const response = await post(message);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Contact delivery is not configured yet.",
      });
    },
    { env: { APP_ORIGIN: origin } },
  ));

test("contact delivery defaults to the public contact address", () => {
  const config = getSmtpConfig({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "test-user",
    SMTP_PASSWORD: "test-password",
    CONTACT_FROM: "website@example.com",
  });

  assert.equal(config?.to, "contact@gahyki.com");
});

test("contact endpoint rejects CR so a message cannot end SMTP DATA early", () =>
  withContactApi(async ({ post, delivered }) => {
    for (const injected of [
      "Hello there friend\r\n.\r\nMAIL FROM:<x@y>\r\n",
      "Hello there friend\r.\rMAIL FROM:<x@y>",
    ]) {
      assert.equal((await post({ ...message, message: injected })).status, 400);
    }
    assert.equal(delivered.length, 0);

    const multiLine = { ...message, message: "First line here.\nSecond line.\n\tIndented." };
    assert.equal((await post(multiLine)).status, 202);
    assert.deepEqual(delivered, [multiLine]);
  }));

for (const { field, error, rejected, mapped, accepted } of [
  {
    field: "message",
    error: "Messages can only use English letters, numbers, and basic punctuation.",
    rejected: ["Great site, merci beaucoup! caf\u00e9", "Love the planets \ud83e\ude90 a lot", "\uc548\ub155\ud558\uc138\uc694 \ubc18\uac11\uc2b5\ub2c8\ub2e4"],
    mapped: ["\u201cIt\u2019s great\u201d \u2013 really\u2026\u00a0thanks", '"It\'s great" - really... thanks'],
    accepted: [],
  },
  {
    field: "name",
    error: "Names can only use letters (accents are fine), numbers, and basic punctuation.",
    rejected: ["\uae40\uac00\ud76c", "Ada \ud83e\ude90", "Ada\tLovelace", "2\u00d73"],
    mapped: ["Conan O\u2019Brien", "Conan O'Brien"],
    accepted: ["Jos\u00e9", "Fran\u00e7ois M\u00fcller", "\u0141ukasz \u017b\u00f3\u0142w"],
  },
] as const) {
  test(`contact ${field} keeps to its allowed characters after mapping phone punctuation`, () =>
    withContactApi(async ({ post, delivered }) => {
      for (const value of rejected) {
        const response = await post({ ...message, [field]: value });
        assert.equal(response.status, 400, value);
        assert.deepEqual(await response.json(), { error, field });
      }
      assert.equal(delivered.length, 0);

      const [typographic, plain] = mapped;
      assert.equal((await post({ ...message, [field]: typographic })).status, 202);
      assert.equal(delivered[0][field], plain);

      for (const value of accepted) {
        assert.equal((await post({ ...message, [field]: value })).status, 202, value);
      }
      assert.deepEqual(delivered.slice(1).map((contact) => contact[field]), accepted);
    }));
}

test("a name typed with a combining accent is stored as one character", () =>
  withContactApi(async ({ post, delivered }) => {
    assert.equal((await post({ ...message, name: "Jose\u0301" })).status, 202);
    assert.equal(delivered[0].name, "Jos\u00e9");
  }));

test("SMTP body helper normalizes line endings to CRLF and dot-stuffs", () => {
  assert.equal(toSmtpBody("a\nb"), "a\r\nb");
  assert.equal(toSmtpBody("a\rb"), "a\r\nb");
  assert.equal(toSmtpBody("a\r\nb\n\rc"), "a\r\nb\r\n\r\nc");
  assert.equal(toSmtpBody("a\n.\nb"), "a\r\n..\r\nb");
  assert.equal(toSmtpBody("a\r\n.\r\nMAIL FROM:<x@y>\r\n"), "a\r\n..\r\nMAIL FROM:<x@y>\r\n");
  assert.equal(toSmtpBody(".leading"), "..leading");
  assert.equal(toSmtpBody("x\n..two"), "x\r\n...two");
  assert.equal(toSmtpBody("mid.dle and end."), "mid.dle and end.");
  assert.ok(!/(^|\r\n)\.\r\n/.test(toSmtpBody("x\r.\ry")));
});

test("email pattern accepts real addresses and stays fast on crafted input", () => {
  for (const valid of ["a@b.co", "first.last+tag@sub.example.com"]) {
    assert.ok(EMAIL.test(valid), valid);
  }
  for (const invalid of ["a@b", "a@.com", "a@b.", "a@b..c", "a b@c.d", "a@@b.c", "jos\u00e9@example.com", "a@b\u00fccher.de", "a\u00a0b@c.d"]) {
    assert.ok(!EMAIL.test(invalid), invalid);
  }
  // Each fits the 10KB body limit; the previous pattern took ~45-90ms on them.
  for (const crafted of [`a@${".".repeat(9000)} `, `a@${"a.".repeat(4500)} `]) {
    const start = performance.now();
    assert.ok(!EMAIL.test(crafted));
    assert.ok(performance.now() - start < 10, "email pattern backtracks on crafted input");
  }
});
