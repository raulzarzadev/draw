# Draw

Whiteboard app built with React, Vite, Excalidraw, and PocketBase.

## Run Locally

From a fresh machine:

```bash
git clone git@github.com:raulzarzadev/draw.git && cd draw && bash scripts/local.sh
```

That command installs dependencies if needed and starts the local dev server at:

```text
http://127.0.0.1:5173
```

To use a different port:

```bash
PORT=3000 bash scripts/local.sh
```

## Environment

The app uses Raul's PocketBase by default:

```text
https://draw-db.raulzarza.com
```

To point at another PocketBase instance, copy `.env.example` to `.env.local` and change:

```bash
VITE_POCKETBASE_URL=https://your-pocketbase.example.com
VITE_ADMIN_EMAILS=admin@example.com
```

`VITE_ADMIN_EMAILS` is a comma-separated list of emails that can see the in-app
admin panel.

## PocketBase Migrations

Production PocketBase runs as the separate `draw-db` Railway service with a
persistent volume mounted at `/pb/pb_data`. Its Docker build context is
`pocketbase/`. See [Railway backend setup](docs/railway-pocketbase.md).

PocketBase collection rules live in:

```text
pocketbase/migrations
```

Copy those files into your PocketBase `pb_migrations` folder and run:

```bash
pocketbase migrate up --dir=/path/to/pb_data --migrationsDir=/path/to/pb_migrations
```

## Scripts

```bash
npm run local
npm run dev
npm run build
npm run start
```

`npm run local` is the convenience script for local testing. `npm run build` writes the static app to `dist/client`.

## Sharing

The Share button supports restricted, view-only, and editable links. Before enabling it in production, add the sharing fields and access rules described in [docs/pocketbase-sharing.md](docs/pocketbase-sharing.md) to the PocketBase `drawings` collection.
