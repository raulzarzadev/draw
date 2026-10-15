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

- `BREVO_SMTP_LOGIN`: SMTP login from Brevo.
- `BREVO_SMTP_KEY`: SMTP key (not an API key).
- `BREVO_SENDER_EMAIL`: sender email verified in Brevo.
- `APP_URL=https://draw.raulzarza.com`.

Restart/redeploy the backend after changing them. The bootstrap hook configures
Brevo SMTP on port 587 with STARTTLS. OTP requests register missing users with a
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
