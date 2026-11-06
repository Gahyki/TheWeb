import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../server/app.js";
import { getSmtpConfig, toSmtpBody, type ContactMessage } from "../server/contact.js";
import { startApiServer } from "./apiServer.js";

const origin = "http://localhost:5173";
const message = {
  name: "Test Sender",
  email: "sender@example.com",
  message: "This is a test message with enough characters.",
};
const sentMessages: ContactMessage[] = [];
const testSmtpEnv = {
  APP_ORIGIN: origin,
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "test-user",
  SMTP_PASSWORD: "test-password",
  CONTACT_FROM: "website@example.com",
  CONTACT_TO: "owner@example.com",
};

let configuredApi: Awaited<ReturnType<typeof startApiServer>>;
let unconfiguredApi: Awaited<ReturnType<typeof startApiServer>>;

before(async () => {
  configuredApi = await startApiServer(
    createApp({
      env: testSmtpEnv,
      sendEmail: async (contact) => {
        sentMessages.push(contact);
      },
      contactRateLimit: 3,
    }),
  );
  unconfiguredApi = await startApiServer(
    createApp({ env: { APP_ORIGIN: origin }, contactRateLimit: 3 }),
  );
});

after(async () => {
  await Promise.all([configuredApi.close(), unconfiguredApi.close()]);
});

test("contact endpoint validates, restricts origin, sends, and limits requests", async () => {
  const disallowedOrigin = await fetch(`${configuredApi.baseUrl}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify(message),
  });
  assert.equal(disallowedOrigin.status, 403);

  const wrongContentType = await fetch(`${configuredApi.baseUrl}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Origin: origin },
    body: JSON.stringify(message),
  });
  assert.equal(wrongContentType.status, 415);

  const oversizedBody = await fetch(`${configuredApi.baseUrl}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ ...message, message: "x".repeat(11_000) }),
  });
  assert.equal(oversizedBody.status, 413);

  const invalidMessage = await fetch(`${configuredApi.baseUrl}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ ...message, email: "not-an-email" }),
  });
  assert.equal(invalidMessage.status, 400);
  assert.deepEqual(await invalidMessage.json(), {
    error: "Please enter a valid email address.",
    field: "email",
  });

  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(`${configuredApi.baseUrl}/api/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(message),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: "accepted" });
  }

  assert.equal(sentMessages.length, 2);
  assert.deepEqual(sentMessages[0], message);

  const limitedResponse = await fetch(`${configuredApi.baseUrl}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(message),
  });
  assert.equal(limitedResponse.status, 429);
});

test("contact endpoint does not claim delivery when SMTP is unconfigured", async () => {
  const response = await fetch(`${unconfiguredApi.baseUrl}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(message),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Contact delivery is not configured yet.",
  });
});

test("contact delivery defaults to the public contact address", () => {
  const config = getSmtpConfig({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "test-user",
    SMTP_PASSWORD: "test-password",
    CONTACT_FROM: "website@example.com",
  });

  assert.equal(config?.to, "contact@gahyki.com");
});

test("contact endpoint rejects CR so a message cannot end SMTP DATA early", async () => {
  const delivered: ContactMessage[] = [];
  const api = await startApiServer(
    createApp({
      env: testSmtpEnv,
      sendEmail: async (contact) => {
        delivered.push(contact);
      },
      contactRateLimit: 10,
    }),
  );
  try {
    const post = (body: unknown) =>
      fetch(`${api.baseUrl}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });

    for (const injected of [
      "Hello there friend\r\n.\r\nMAIL FROM:<x@y>\r\n",
      "Hello there friend\r.\rMAIL FROM:<x@y>",
    ]) {
      const rejected = await post({ ...message, message: injected });
      assert.equal(rejected.status, 400);
      assert.deepEqual(await rejected.json(), {
        error: "Please check the contact form fields.",
      });
    }
    assert.equal(delivered.length, 0);

    const multiLine = { ...message, message: "First line here.\nSecond line.\n\tIndented." };
    const accepted = await post(multiLine);
    assert.equal(accepted.status, 202);
    assert.deepEqual(delivered, [multiLine]);
  } finally {
    await api.close();
  }
});

test("SMTP body helper normalizes line endings to CRLF and dot-stuffs", () => {
  assert.equal(toSmtpBody("a\nb"), "a\r\nb");
  assert.equal(toSmtpBody("a\rb"), "a\r\nb");
  assert.equal(toSmtpBody("a\r\nb\n\rc"), "a\r\nb\r\n\r\nc");
  assert.equal(toSmtpBody("a\n.\nb"), "a\r\n..\r\nb");
  assert.equal(toSmtpBody("a\r\n.\r\nMAIL FROM:<x@y>\r\n"), "a\r\n..\r\nMAIL FROM:<x@y>\r\n");
  assert.equal(toSmtpBody(".leading"), "..leading");
  assert.equal(toSmtpBody("x\n..two"), "x\r\n...two");
  assert.equal(toSmtpBody("mid.dle and end."), "mid.dle and end.");
  assert.ok(!/(^|\r\n)\.\r\n/.test(toSmtpBody("x\r.\ry")));
});
