import { z } from "zod";
import type { ContactMessage } from "./contact.js";

/** Printable ASCII on one line, plus accented Latin letters (Latin-1 and Extended-A/B, minus the x and / signs). */
const NAME_LINE = /^[\x20-\x7e\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+$/;

/** Printable ASCII plus tab and LF; CR is rejected because CRLF.CRLF ends SMTP DATA. */
const ASCII_TEXT = /^[\t\n\x20-\x7e]+$/;

// Visible ASCII only. Labels exclude dots so each dot has one parse; matching stays linear on crafted input.
export const EMAIL = /^(?=[\x21-\x7e]+$)[^@]+@[^@.]+(?:\.[^@.]+)+$/;

const ASCII_PUNCTUATION: [RegExp, string][] = [
  [/[\u2018\u2019\u201a\u2032]/g, "'"],
  [/[\u201c\u201d\u201e\u2033]/g, '"'],
  [/[\u2013\u2014\u2212]/g, "-"],
  [/\u2026/g, "..."],
  [/[\u00a0\u2007\u202f]/g, " "],
];

/**
 * Phone keyboards insert typographic punctuation by default; map it to ASCII.
 * NFC first so a letter typed as base + combining accent becomes one character.
 */
function toPlainPunctuation(text: string) {
  return ASCII_PUNCTUATION.reduce(
    (result, [pattern, ascii]) => result.replace(pattern, ascii),
    text.normalize("NFC"),
  );
}

function plainText(min: number, max: number, allowed: RegExp) {
  return z.string().overwrite(toPlainPunctuation).trim().min(min).max(max).regex(allowed);
}

const FORMAT_ERRORS = [
  ["name", "Names can only use letters (accents are fine), numbers, and basic punctuation."],
  ["email", "Please enter a valid email address."],
  ["message", "Messages can only use English letters, numbers, and basic punctuation."],
] as const;

const contactSchema = z
  .object({
    name: plainText(1, 100, NAME_LINE),
    email: z.string().trim().regex(EMAIL).max(254),
    message: plainText(10, 5000, ASCII_TEXT),
  })
  .strict();

type ContactInputError = { error: string; field?: (typeof FORMAT_ERRORS)[number][0] };

/** Validates a contact submission; format errors name the offending field. */
export function parseContact(
  body: unknown,
): { data: ContactMessage } | { error: ContactInputError } {
  const parsed = contactSchema.safeParse(body);
  if (parsed.success) {
    return { data: parsed.data };
  }
  const invalid = FORMAT_ERRORS.find(([field]) =>
    parsed.error.issues.some((issue) => issue.path[0] === field && issue.code === "invalid_format"),
  );
  return {
    error: invalid
      ? { error: invalid[1], field: invalid[0] }
      : { error: "Please check the contact form fields." },
  };
}
