import { SMTPClient } from "emailjs";

export type ContactMessage = {
  name: string;
  email: string;
  message: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  to: string;
  secure: boolean;
};

export function getSmtpConfig(env: NodeJS.ProcessEnv): SmtpConfig | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, CONTACT_FROM } = env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !CONTACT_FROM) {
    return null;
  }

  const CONTACT_TO = env.CONTACT_TO?.trim() || "contact@gahyki.com";
  const port = Number(SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }

  return {
    host: SMTP_HOST,
    port,
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    from: CONTACT_FROM,
    to: CONTACT_TO,
    secure: env.SMTP_SECURE === "true" || port === 465,
  };
}

/**
 * Prepares text for the SMTP DATA phase (RFC 5321 section 4.5.2): every line
 * ending becomes CRLF and any line starting with "." gets an extra ".", so no
 * submitted content can form the "CRLF . CRLF" terminator. emailjs writes the
 * body to the socket as-is, so this must run before handing text to it.
 */
export function toSmtpBody(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
}

export async function sendContactMessage(
  config: SmtpConfig,
  contact: ContactMessage,
): Promise<void> {
  const client = new SMTPClient({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    ssl: config.secure,
    tls: !config.secure,
    timeout: 10_000,
  });

  try {
    await client.sendAsync({
      from: config.from,
      to: config.to,
      "reply-to": contact.email,
      subject: "New message from your personal website",
      text: toSmtpBody(`From: ${contact.name}\nEmail: ${contact.email}\n\n${contact.message}`),
    });
  } finally {
    client.smtp.close();
  }
}
