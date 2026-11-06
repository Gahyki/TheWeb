import { z } from "zod";

export type FeaturedRepo = {
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
  url: string;
};

export type ContributionCalendar = {
  total: number;
  /** Weeks, oldest first; each week holds up to 7 daily counts. */
  weeks: number[][];
};

export type GithubSnapshot = {
  repos: FeaturedRepo[];
  /** Null when no GITHUB_TOKEN is configured (GraphQL requires auth). */
  contributions: ContributionCalendar | null;
};

type GithubServiceOptions = {
  username: string;
  token?: string;
  cacheTtlMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
};

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const FEATURED_COUNT = 4;
const UPSTREAM_TIMEOUT_MS = 8000;
/** After a failed refresh, back off instead of re-firing per request. */
const FAILURE_BACKOFF_MS = 60 * 1000;

const CONTRIBUTIONS_QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
            }
          }
        }
      }
    }
  }
`;

function shapeRepos(payload: unknown): FeaturedRepo[] {
  if (!Array.isArray(payload)) {
    throw new Error("GitHub repos payload is not an array.");
  }

  return payload
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    )
    .filter((entry) => entry.fork !== true)
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "",
      description: typeof entry.description === "string" ? entry.description : null,
      stars: typeof entry.stargazers_count === "number" ? entry.stargazers_count : 0,
      language: typeof entry.language === "string" ? entry.language : null,
      url: typeof entry.html_url === "string" ? entry.html_url : "",
    }))
    // Only https://github.com/ links may reach an href in the frontend.
    .filter((repo) => repo.name !== "" && repo.url.startsWith("https://github.com/"))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, FEATURED_COUNT);
}

// Lenient below the calendar: a malformed week or day degrades to [] / 0
// instead of discarding the whole payload.
const contributionDaySchema = z
  .object({ contributionCount: z.number().nonnegative().catch(0) })
  .catch({ contributionCount: 0 });

const contributionWeekSchema = z
  .object({ contributionDays: z.array(contributionDaySchema).catch([]) })
  .catch({ contributionDays: [] });

const contributionsPayloadSchema = z.object({
  data: z.object({
    user: z.object({
      contributionsCollection: z.object({
        contributionCalendar: z.object({
          totalContributions: z.number(),
          weeks: z.array(contributionWeekSchema),
        }),
      }),
    }),
  }),
});

function shapeContributions(payload: unknown): ContributionCalendar {
  const parsed = contributionsPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("GitHub contributions payload has an unexpected shape.");
  }
  const calendar = parsed.data.data.user.contributionsCollection.contributionCalendar;
  return {
    total: calendar.totalContributions,
    weeks: calendar.weeks.map((week) =>
      week.contributionDays.map((day) => day.contributionCount),
    ),
  };
}

/**
 * Server-side GitHub access with an in-memory cache: one upstream request
 * per TTL regardless of visitor traffic, and the token never leaves the
 * server. Stale data is served if a refresh fails.
 */
export function createGithubService(options: GithubServiceOptions) {
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;

  let cache: { expiresAt: number; snapshot: GithubSnapshot } | null = null;
  let inflight: Promise<GithubSnapshot> | null = null;
  let failedUntil = 0;

  const authHeaders: Record<string, string> = options.token
    ? { Authorization: `Bearer ${options.token}` }
    : {};

  async function fetchRepos(): Promise<FeaturedRepo[]> {
    const response = await fetcher(
      `https://api.github.com/users/${encodeURIComponent(options.username)}/repos?per_page=100&sort=pushed`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "gahyki.com",
          ...authHeaders,
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub repos request failed with status ${response.status}.`);
    }
    return shapeRepos(await response.json());
  }

  async function fetchContributions(): Promise<ContributionCalendar | null> {
    if (!options.token) {
      return null;
    }
    const response = await fetcher("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "gahyki.com",
        ...authHeaders,
      },
      body: JSON.stringify({
        query: CONTRIBUTIONS_QUERY,
        variables: { login: options.username },
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`GitHub GraphQL request failed with status ${response.status}.`);
    }
    return shapeContributions(await response.json());
  }

  async function refresh(): Promise<GithubSnapshot> {
    const repos = await fetchRepos();
    let contributions: ContributionCalendar | null = null;
    try {
      contributions = await fetchContributions();
    } catch (error) {
      // Partial success: featured repos still ship without the calendar.
      console.error(
        "GitHub contributions fetch failed.",
        error instanceof Error ? error.message : error,
      );
    }
    return { repos, contributions };
  }

  return {
    async getSnapshot(): Promise<GithubSnapshot> {
      if (cache && cache.expiresAt > now()) {
        return cache.snapshot;
      }
      if (!inflight) {
        // Negative cache: while GitHub is failing, don't let every visitor
        // request re-fire upstream calls (and burn token quota).
        if (failedUntil > now()) {
          if (cache) {
            return cache.snapshot;
          }
          throw new Error("GitHub upstream recently failed; backing off.");
        }
        inflight = refresh()
          .then((snapshot) => {
            cache = { expiresAt: now() + ttlMs, snapshot };
            return snapshot;
          })
          .catch((error: unknown) => {
            failedUntil = now() + FAILURE_BACKOFF_MS;
            throw error;
          })
          .finally(() => {
            inflight = null;
          });
      }
      try {
        return await inflight;
      } catch (error) {
        if (cache) {
          // Serve stale rather than failing the page.
          return cache.snapshot;
        }
        throw error;
      }
    },
  };
}
