import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../hooks/auth.pb.js", import.meta.url), "utf8");

function transport({ apiKey = "test-secret-api-key", status = 201, networkError } = {}) {
  let handler;
  const requests = [];
  const logs = [];
  let smtpCalls = 0;
  vm.runInNewContext(source, {
    onRecordRequestOTPRequest() {},
    onBootstrap() {},
    onMailerSend(fn) { handler = fn; },
    $os: { getenv(name) { return name === "BREVO_API_KEY" ? apiKey : ""; } },
    $http: { send(request) {
      requests.push(request);
      if (networkError) throw new Error("network timeout");
      return { statusCode: status };
    } },
    console: { log(value) { logs.push(value); }, error(value) { logs.push(value); } },
  });
  return {
    requests, logs,
    get smtpCalls() { return smtpCalls; },
    send(overrides = {}) {
      handler({
        message: {
          from: { address: "no-reply@draw-mail.example.com", name: "Draw" },
          to: [{ address: "person@example.com" }],
          subject: "Access code", html: "<p>test-code</p>", text: "test-code",
          cc: [], bcc: [], attachments: {}, inlineAttachments: {}, ...overrides,
        },
        next() { smtpCalls++; },
      });
    },
  };
}

test("HTTPS delivery preserves sender, recipients and OTP body without SMTP duplication", () => {
  const mail = transport();
  mail.send({ cc: [{ address: "copy@example.com", name: "Copy" }] });
  assert.equal(mail.requests.length, 1);
  assert.equal(mail.smtpCalls, 0);
  const request = mail.requests[0];
  assert.equal(request.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(request.headers["api-key"], "test-secret-api-key");
  const payload = JSON.parse(request.body);
  assert.equal(payload.sender.email, "no-reply@draw-mail.example.com");
  assert.equal(payload.to[0].email, "person@example.com");
  assert.equal(payload.cc[0].name, "Copy");
  assert.equal(payload.htmlContent, "<p>test-code</p>");
  assert.equal(payload.textContent, "test-code");
  assert.ok(mail.logs.every(line => !line.includes("test-secret-api-key") && !line.includes("test-code")));
});

test("API and network errors fail without falling back to blocked SMTP", () => {
  for (const config of [{ status: 401 }, { status: 429 }, { status: 500 }, { networkError: true }]) {
    const mail = transport(config);
    assert.throws(() => mail.send());
    assert.equal(mail.smtpCalls, 0);
    assert.ok(mail.logs.every(line => !line.includes("test-secret-api-key")));
  }
});

test("SMTP remains available when an API key is not configured", () => {
  const mail = transport({ apiKey: "" });
  mail.send();
  assert.equal(mail.smtpCalls, 1);
  assert.equal(mail.requests.length, 0);
});

test("attachments fail explicitly instead of silently losing content", () => {
  const mail = transport();
  assert.throws(() => mail.send({ attachments: { "example.txt": {} } }), /attachments/);
  assert.equal(mail.requests.length, 0);
});
