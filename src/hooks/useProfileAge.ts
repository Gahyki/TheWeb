import { useEffect, useState } from "react";
import { cacheAge, fetchAge, getCachedAge } from "../utils/age";

export function useProfileAge() {
  const [age, setAge] = useState<number | null>(() => getCachedAge());

  useEffect(() => {
    if (age !== null) {
      return;
    }

    const controller = new AbortController();
    fetchAge(controller.signal)
      .then((freshAge) => {
        cacheAge(freshAge);
        setAge(freshAge);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        console.error("Unable to load profile age.", error);
      });

    return () => controller.abort();
  }, [age]);

  return age;
}
