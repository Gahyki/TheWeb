import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../server/app.js";
import { createGithubService } from "../server/getGithubApi.js";
import { startApiServer } from "./apiServer.js";

const REPOS_PAYLOAD = [
  { name: "alpha", description: "First", stargazers_count: 2, language: "TypeScript", html_url: "https://github.com/Gahyki/alpha", fork: false },
  { name: "forked", description: "Fork", stargazers_count: 99, language: "C", html_url: "https://github.com/Gahyki/forked", fork: true },
  { name: "beta", description: null, stargazers_count: 7, language: "Python", html_url: "https://github.com/Gahyki/beta", fork: false },
  { name: "gamma", description: "Third", stargazers_count: 4, language: null, html_url: "https://github.com/Gahyki/gamma", fork: false },
  { name: "delta", description: "Fourth", stargazers_count: 1, language: "Go", html_url: "https://github.com/Gahyki/delta", fork: false },
  { name: "epsilon", description: "Fifth", stargazers_count: 0, language: "Rust", html_url: "https://github.com/Gahyki/epsilon", fork: false },
];

const GRAPHQL_PAYLOAD = {
  data: {
    user: {
      contributionsCollection: {
        contributionCalendar: {
          totalContributions: 321,
          weeks: [
            { contributionDays: [{ contributionCount: 0 }, { contributionCount: 3 }] },
            { contributionDays: [{ contributionCount: 5 }] },
          ],
        },
      },
    },
  },
};

function makeGraphqlStubFetch(graphqlPayload: unknown) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/graphql")) {
      return new Response(JSON.stringify(graphqlPayload), { status: 200 });
    }
    return new Response(JSON.stringify(REPOS_PAYLOAD), { status: 200 });
  }) as typeof fetch;
}

function makeStubFetch(state: { calls: number; failRepos?: boolean }) {
  return (async (input: string | URL | Request) => {
    state.calls += 1;
    const url = String(input);
    if (url.includes("/graphql")) {
      return new Response(JSON.stringify(GRAPHQL_PAYLOAD), { status: 200 });
    }
    if (state.failRepos) {
      return new Response("rate limited", { status: 403 });
    }
    return new Response(JSON.stringify(REPOS_PAYLOAD), { status: 200 });
  }) as typeof fetch;
}

let api: Awaited<ReturnType<typeof startApiServer>>;
const apiFetchState = { calls: 0 };

before(async () => {
  api = await startApiServer(
    createApp({ env: {}, githubFetch: makeStubFetch(apiFetchState) }),
  );
});

after(async () => {
  await api.close();
});

test("github endpoint returns shaped repos without contributions when no token is set", async () => {
  const response = await fetch(`${api.baseUrl}/api/github`);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
  );

  const result = (await response.json()) as {
    repos: { name: string; stars: number }[];
    contributions: unknown;
  };
  assert.equal(result.contributions, null);
  // Forks excluded, sorted by stars, capped at four.
  assert.deepEqual(
    result.repos.map((repo) => repo.name),
    ["beta", "gamma", "alpha", "delta"],
  );
});

test("github endpoint serves repeat requests from the server cache", async () => {
  // Self-priming so the test holds under name filtering or reordering.
  const first = await fetch(`${api.baseUrl}/api/github`);
  assert.equal(first.status, 200);
  const callsAfterPrime = apiFetchState.calls;

  const second = await fetch(`${api.baseUrl}/api/github`);
  assert.equal(second.status, 200);
  assert.equal(apiFetchState.calls, callsAfterPrime);
});

test("github service fetches the contribution calendar when a token is set", async () => {
  const service = createGithubService({
    username: "Gahyki",
    token: "test-token",
    fetcher: makeStubFetch({ calls: 0 }),
  });
  const snapshot = await service.getSnapshot();
  assert.ok(snapshot.contributions);
  assert.equal(snapshot.contributions.total, 321);
  assert.deepEqual(snapshot.contributions.weeks, [[0, 3], [5]]);
});

test("github service degrades malformed weeks and days instead of discarding the calendar", async () => {
  const service = createGithubService({
    username: "Gahyki",
    token: "test-token",
    fetcher: makeGraphqlStubFetch({
      data: {
        user: {
          contributionsCollection: {
            contributionCalendar: {
              totalContributions: 42,
              weeks: [{ contributionDays: [{ contributionCount: "x" }, null] }, "junk"],
            },
          },
        },
      },
    }),
  });
  const snapshot = await service.getSnapshot();
  assert.ok(snapshot.contributions);
  assert.equal(snapshot.contributions.total, 42);
  assert.deepEqual(snapshot.contributions.weeks, [[0, 0], []]);
});

test("github service treats a structurally broken contributions payload as partial success", async () => {
  const service = createGithubService({
    username: "Gahyki",
    token: "test-token",
    fetcher: makeGraphqlStubFetch({
      data: {
        user: {
          contributionsCollection: {
            contributionCalendar: { weeks: [] }, // totalContributions missing
          },
        },
      },
    }),
  });
  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.contributions, null);
  assert.equal(snapshot.repos.length, 4);
});

test("github endpoint reports upstream failure when nothing is cached", async () => {
  const failingApi = await startApiServer(
    createApp({ env: {}, githubFetch: makeStubFetch({ calls: 0, failRepos: true }) }),
  );
  try {
    const response = await fetch(`${failingApi.baseUrl}/api/github`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "GitHub data is unavailable right now.",
    });
  } finally {
    await failingApi.close();
  }
});

test("github service backs off after a failed refresh instead of re-firing upstream", async () => {
  let clock = 0;
  const state: { calls: number; failRepos?: boolean } = { calls: 0, failRepos: true };
  const service = createGithubService({
    username: "Gahyki",
    fetcher: makeStubFetch(state),
    cacheTtlMs: 1000,
    now: () => clock,
  });

  await assert.rejects(service.getSnapshot());
  const callsAfterFailure = state.calls;

  clock = 500; // Within the backoff window: no new upstream call.
  await assert.rejects(service.getSnapshot());
  assert.equal(state.calls, callsAfterFailure);
});

test("github service serves stale data when a refresh fails", async () => {
  let clock = 0;
  const state: { calls: number; failRepos?: boolean } = { calls: 0 };
  const service = createGithubService({
    username: "Gahyki",
    fetcher: makeStubFetch(state),
    cacheTtlMs: 1000,
    now: () => clock,
  });

  const fresh = await service.getSnapshot();
  assert.equal(fresh.repos.length, 4);

  clock = 2000;
  state.failRepos = true;
  const stale = await service.getSnapshot();
  assert.deepEqual(stale, fresh);
});
