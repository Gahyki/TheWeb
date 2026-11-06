// Wire types come from the server, the other end of this contract.
import type { FeaturedRepo, GithubSnapshot } from "../../server/getGithubApi";

export type {
  ContributionCalendar,
  FeaturedRepo,
  GithubSnapshot,
} from "../../server/getGithubApi";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const CACHE_KEY = "gh-snapshot-v2";
const CACHE_TTL_MS = 30 * 60 * 1000;

export const FALLBACK_REPOS: FeaturedRepo[] = [
  { name: "space", description: "Experiments in orbit.", stars: 0, language: "TypeScript", url: "https://github.com/Gahyki/space" },
  { name: "UAV", description: "Unmanned aerial vehicle work.", stars: 0, language: "C++", url: "https://github.com/Gahyki/UAV" },
  { name: "StockPrediction", description: "Market prediction experiments.", stars: 0, language: "Python", url: "https://github.com/Gahyki/StockPrediction" },
  { name: "FluidSound", description: "Sound from simulated fluids.", stars: 0, language: "Python", url: "https://github.com/Gahyki/FluidSound" },
];

function isSnapshot(value: unknown): value is GithubSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.repos)) {
    return false;
  }
  if (candidate.contributions !== null) {
    const contributions = candidate.contributions as Record<string, unknown> | undefined;
    if (
      typeof contributions !== "object" ||
      contributions === null ||
      typeof contributions.total !== "number" ||
      !Array.isArray(contributions.weeks)
    ) {
      return false;
    }
  }
  return candidate.repos.every(
    (repo) =>
      typeof repo === "object" &&
      repo !== null &&
      typeof (repo as Record<string, unknown>).name === "string" &&
      typeof (repo as Record<string, unknown>).url === "string" &&
      // Defense in depth: these strings become hrefs.
      ((repo as Record<string, unknown>).url as string).startsWith("https://github.com/"),
  );
}

function readCache(): GithubSnapshot | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    const envelope = parsed as { expiresAt?: unknown; snapshot?: unknown };
    if (
      typeof envelope.expiresAt === "number" &&
      envelope.expiresAt > Date.now() &&
      isSnapshot(envelope.snapshot)
    ) {
      return envelope.snapshot;
    }
  } catch {
    // Treat unreadable cache as a miss.
  }
  return null;
}

function writeCache(snapshot: GithubSnapshot) {
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, snapshot }),
    );
  } catch {
    // Storage may be unavailable; the fetch result is still used in-memory.
  }
}

/** Fetches the server-cached GitHub snapshot (repos + contribution calendar). */
export async function fetchGithubSnapshot(signal: AbortSignal): Promise<GithubSnapshot> {
  const cached = readCache();
  if (cached) {
    return cached;
  }

  const response = await fetch(`${API_BASE_URL}/api/github`, { signal });
  if (!response.ok) {
    throw new Error(`GitHub snapshot request failed with status ${response.status}.`);
  }

  const body: unknown = await response.json();
  if (!isSnapshot(body)) {
    throw new Error("GitHub snapshot has an unexpected shape.");
  }

  if (body.repos.length > 0) {
    writeCache(body);
  }
  return body;
}
