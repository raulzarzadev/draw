// Validated OTP requests also register new users. Accounts gain no privileges
// until the email owner proves possession of the code.
onRecordRequestOTPRequest((e) => {
  if (!e.record) {
    const body = e.requestInfo().body;
    const record = new Record(e.collection);
    record.setEmail(String(body.email).trim().toLowerCase());
    record.setRandomPassword();
    e.app.save(record);
    e.record = record;
  }
  e.next();
}, "users");

onBootstrap((e) => {
  e.next();
  const settings = e.app.settings();
  settings.meta.appName = "Draw";
  settings.meta.appURL = $os.getenv("APP_URL") || "https://draw.raulzarza.com";
  if ($os.getenv("BREVO_SENDER_EMAIL")) {
    settings.meta.senderName = "Draw";
    settings.meta.senderAddress = $os.getenv("BREVO_SENDER_EMAIL");
  }
  // SMTP secrets belong in Railway variables, never in the frontend bundle.
  if ($os.getenv("BREVO_SMTP_KEY")) {
    settings.smtp.enabled = true;
    settings.smtp.host = "smtp-relay.brevo.com";
    settings.smtp.port = 587;
    settings.smtp.tls = false;
    settings.smtp.username = $os.getenv("BREVO_SMTP_LOGIN");
    settings.smtp.password = $os.getenv("BREVO_SMTP_KEY");
    settings.smtp.authMethod = "LOGIN";
  }
  settings.rateLimits.enabled = true;
  e.app.save(settings);
});

// PocketBase also stores mail errors in its internal logs. Mirror transport
// failures to Railway's container logs without logging credentials or codes.
onMailerSend((e) => {
  try {
    const apiKey = $os.getenv("BREVO_API_KEY");
    if (!apiKey) {
      e.next();
      return;
    }
    const message = e.message;
    if (Object.keys(message.attachments || {}).length || Object.keys(message.inlineAttachments || {}).length) {
      throw new Error("Draw email attachments are not supported by the Brevo API transport");
    }
    const address = (value) => ({ email: value.address, name: value.name || undefined });
    const payload = {
      sender: address(message.from),
      to: message.to.map(address),
      subject: message.subject,
      tags: ["draw-auth"],
    };
    if (message.html) payload.htmlContent = message.html;
    if (message.text) payload.textContent = message.text;
    if (message.cc && message.cc.length) payload.cc = message.cc.map(address);
    if (message.bcc && message.bcc.length) payload.bcc = message.bcc.map(address);
    const response = $http.send({
      url: "https://api.brevo.com/v3/smtp/email",
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      timeout: 15,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error("Brevo HTTPS email failed with status " + response.statusCode);
    }
    // Do not call e.next(): the email was already sent through HTTPS.
    console.log("Draw email accepted by Brevo HTTPS API");
  } catch (error) {
    console.error("Draw email transport failed: " + String(error));
    throw error;
  }
});
