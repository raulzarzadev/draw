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

Shared drawings receive live changes through PocketBase realtime subscriptions.
Edits are sent about every 250 ms while drawing. Owners/editors can use the
laser tool to present to all authorized viewers; laser positions are temporary
and are not stored in the drawing. Reload existing tabs once after deploying
this feature.

Concurrent changes to different elements are merged on the server. Conflicting
edits to the same element use Excalidraw's version and nonce ordering. Local
viewport, zoom and selection are kept on each device. Deleted elements remain
as tombstones to prevent stale clients from bringing them back.

To run the collaboration integration checks against a disposable local database:

```bash
POCKETBASE_BIN=/path/to/pocketbase node --experimental-strip-types --experimental-eventsource --test pocketbase/tests/*.test.mjs
```

Use the PocketBase version pinned in `pocketbase/Dockerfile`. The tests create
and remove their own temporary database and do not connect to production.

## Install as an app (PWA)

Production builds include a web manifest, app icons, and a versioned service worker.
Serve `dist/client` over HTTPS (localhost also works for testing). In Chrome/Edge,
use the browser's install action; on iPhone/iPad, use Safari → Share → Add to Home Screen.

The worker caches the application files after the first successful online visit.
Local drawings can then reopen offline; account access and shared-drawing sync need
connectivity. API responses and shared-link URLs are not cached by the worker.
Updates activate after the existing app windows/tabs close. Development mode does
not register a service worker. Test the production build with `npm run build` and
`npm run start`.

Laser regression checks (including quick strokes and slow requests):

```bash
node --experimental-strip-types --test scripts/laser-channel.test.mjs
```

Shared viewers can receive laser trails without an account. Presenters must be
signed in and have edit permission. The integration suite checks an anonymous
viewer receiving a complete quick stroke against a disposable PocketBase.
