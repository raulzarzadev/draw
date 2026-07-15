#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 20+ and run this again." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js with npm and run this again." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

host="${HOST:-127.0.0.1}"
port="${PORT:-5173}"

echo "Starting Draw at http://${host}:${port}"
exec npx vite --host "$host" --port "$port"
