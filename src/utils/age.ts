const AGE_CACHE_KEY = "profile-age";
const AGE_CACHE_TTL_MS = 60 * 60 * 1000;
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

type AgeCache = {
  age: number;
  expiresAt: number;
};

function isAgeCache(value: unknown): value is AgeCache {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const cache = value as Record<string, unknown>;
  return (
    typeof cache.age === "number" &&
    Number.isInteger(cache.age) &&
    cache.age >= 0 &&
    cache.age <= 130 &&
    typeof cache.expiresAt === "number" &&
    Number.isFinite(cache.expiresAt)
  );
}

export function getCachedAge() {
  try {
    const cachedValue = window.localStorage.getItem(AGE_CACHE_KEY);
    if (cachedValue) {
      const cached: unknown = JSON.parse(cachedValue);
      if (isAgeCache(cached) && cached.expiresAt > Date.now()) {
        return cached.age;
      }
    }
  } catch (error) {
    console.error("Unable to read the cached profile age.", error);
  }

  return null;
}

export function cacheAge(age: number) {
  if (!Number.isInteger(age) || age < 0 || age > 130) {
    throw new Error("The age API returned an invalid age.");
  }

  const cache: AgeCache = { age, expiresAt: Date.now() + AGE_CACHE_TTL_MS };
  try {
    window.localStorage.setItem(AGE_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Unable to store the cached profile age.", error);
  }
}

export async function fetchAge(signal: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/age`, { signal });
  if (!response.ok) {
    throw new Error(`Age request failed with status ${response.status}.`);
  }

  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null || !("age" in result)) {
    throw new Error("The age API returned an invalid response.");
  }

  const age = result.age;
  if (typeof age !== "number" || !Number.isInteger(age) || age < 0 || age > 130) {
    throw new Error("The age API returned an invalid age.");
  }

  return age;
}
