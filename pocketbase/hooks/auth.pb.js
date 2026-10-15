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
  // SMTP secrets belong in Railway variables, never in the frontend bundle.
  if ($os.getenv("BREVO_SMTP_KEY")) {
    settings.smtp.enabled = true;
    settings.smtp.host = "smtp-relay.brevo.com";
    settings.smtp.port = 587;
    settings.smtp.tls = false;
    settings.smtp.username = $os.getenv("BREVO_SMTP_LOGIN");
    settings.smtp.password = $os.getenv("BREVO_SMTP_KEY");
    settings.smtp.authMethod = "LOGIN";
    settings.meta.senderName = "Draw";
    settings.meta.senderAddress = $os.getenv("BREVO_SENDER_EMAIL");
  }
  settings.rateLimits.enabled = true;
  e.app.save(settings);
});
