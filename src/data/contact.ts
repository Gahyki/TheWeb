const configuredEmail =
  (import.meta.env.VITE_PUBLIC_CONTACT_EMAIL || "contact@gahyki.com").trim();

export const publicContactEmail =
  configuredEmail && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(configuredEmail)
    ? configuredEmail
    : null;
