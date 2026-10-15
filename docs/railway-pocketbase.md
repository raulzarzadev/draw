# PocketBase on Railway

Draw uses a dedicated PocketBase service (`draw-db`), separate from the Vite
frontend. The public endpoint is `https://draw-db.raulzarza.com`.

## Service

- GitHub repository: `raulzarzadev/draw`, branch `main`.
- Root directory: `/pocketbase` (Dockerfile is in that directory).
- Start command: use the Dockerfile default.
- Persistent volume: `/pb/pb_data`, one replica.
- Variable: `PORT=8090`.
- Health check: `/api/health`.
- Frontend build variable: `VITE_POCKETBASE_URL=https://draw-db.raulzarza.com`.

The image pins PocketBase 0.40.5 and verifies the archive SHA-256. Migrations
run when the server starts, after Railway mounts the persistent volume. They
support a fresh database, OTP authentication, drawings, sharing and limits.

## Brevo

Set these variables on **draw-db**, never on the frontend:

- `BREVO_API_KEY`: Brevo API key for HTTPS transactional email delivery.
- `BREVO_SENDER_EMAIL`: sender email verified in Brevo.
- `APP_URL=https://draw.raulzarza.com`.

The configured sender is `Draw <no-reply@draw-mail.raulzarza.com>`. The
`draw-mail.raulzarza.com` domain is authenticated in Brevo with its verification
TXT, two DKIM CNAME records (DNS only), and a DMARC TXT record in Cloudflare.
It is separate from the web app's `draw.raulzarza.com` CNAME.

Restart/redeploy the backend after changing them. The mail hook uses Brevo's
HTTPS API, which works on Railway Hobby (outbound SMTP is blocked on that plan).
For environments that permit SMTP, the optional `BREVO_SMTP_LOGIN` and
`BREVO_SMTP_KEY` configure port 587 with STARTTLS when no API key is supplied.
An API delivery failure is logged and never retried through SMTP. OTP requests register missing users with a
random inaccessible password; only successful email-code verification creates
an authenticated session. Password login and public direct user creation are
disabled. Admin rules require verified ownership of the configured admin email.

Open the backend deployment logs in Railway for the initial PocketBase setup
link, and use it to set up your superuser account. Keep this link and all
credentials private. The admin dashboard is at `https://draw-db.raulzarza.com/_/`.

## Backups

The Railway volume survives redeployments. Configure scheduled backups in the
PocketBase admin dashboard and store an independent copy outside the service.
This deployment starts a fresh database; it does not import the old Raspberry
Pi's users or drawings. A PocketBase backup is needed to recover those records.
