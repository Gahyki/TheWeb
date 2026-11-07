import { useEffect, useState } from "react";
import type { GithubSnapshot } from "../ui/github";
import { fetchGithubSnapshot } from "../ui/github";

/** Featured repos + contribution calendar; `failed` once a fetch errors. */
export function useGithubSnapshot() {
  const [snapshot, setSnapshot] = useState<GithubSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchGithubSnapshot(controller.signal)
      .then(setSnapshot)
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, []);

  return { snapshot, failed };
}
