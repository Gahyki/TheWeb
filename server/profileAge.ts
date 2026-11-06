export type ProfileBirthMonth = {
  year: number;
  month: number;
};

export function parseProfileBirthMonth(
  yearValue?: string,
  monthValue?: string,
): ProfileBirthMonth | null {
  if (!yearValue && !monthValue) {
    return null;
  }

  if (!yearValue || !monthValue || !/^\d{4}$/.test(yearValue) || !/^\d{1,2}$/.test(monthValue)) {
    throw new Error("PROFILE_BIRTH_YEAR and PROFILE_BIRTH_MONTH must be set as a four-digit year and month.");
  }

  const birthMonth = {
    year: Number(yearValue),
    month: Number(monthValue),
  };

  if (birthMonth.year < 1900 || birthMonth.year > new Date().getFullYear() || birthMonth.month < 1 || birthMonth.month > 12) {
    throw new Error("PROFILE_BIRTH_YEAR and PROFILE_BIRTH_MONTH must be a valid past year and month.");
  }

  return birthMonth;
}

export function getProfileAge(
  birthMonth: ProfileBirthMonth,
  timeZone: string,
  now = new Date(),
) {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const today = Object.fromEntries(
    dateParts.map(({ type, value }) => [type, Number(value)]),
  );
  const hasReachedBirthMonth = today.month >= birthMonth.month;

  return today.year - birthMonth.year - (hasReachedBirthMonth ? 0 : 1);
}
