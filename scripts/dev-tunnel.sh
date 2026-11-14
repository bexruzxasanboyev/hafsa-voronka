#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_ENV="$ROOT_DIR/apps/api/.env"
WEB_ENV="$ROOT_DIR/apps/web/.env.local"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
API_ENV_BACKUP="$TMP_DIR/api.env.bak"
WEB_ENV_BACKUP="$TMP_DIR/web.env.bak"
cp "$API_ENV" "$API_ENV_BACKUP"
cp "$WEB_ENV" "$WEB_ENV_BACKUP"

cleanup() {
  if [[ -f "$API_ENV_BACKUP" ]]; then
    cp "$API_ENV_BACKUP" "$API_ENV"
  fi
  if [[ -f "$WEB_ENV_BACKUP" ]]; then
    cp "$WEB_ENV_BACKUP" "$WEB_ENV"
  fi
  kill "${API_TUNNEL_PID:-}" "${WEB_TUNNEL_PID:-}" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

cloudflared tunnel --no-autoupdate --url http://localhost:3001 >"$TMP_DIR/api.log" 2>&1 &
API_TUNNEL_PID=$!

cloudflared tunnel --no-autoupdate --url http://localhost:3000 >"$TMP_DIR/web.log" 2>&1 &
WEB_TUNNEL_PID=$!

extract_url() {
  local logfile="$1"
  local url=""
  for _ in $(seq 1 60); do
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$logfile" | head -n 1 || true)"
    if [[ -n "$url" ]]; then
      echo "$url"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

API_TUNNEL_URL="$(extract_url "$TMP_DIR/api.log")"
WEB_TUNNEL_URL="$(extract_url "$TMP_DIR/web.log")"

if [[ -z "$API_TUNNEL_URL" || -z "$WEB_TUNNEL_URL" ]]; then
  echo "Failed to acquire trycloudflare.com tunnel URLs" >&2
  exit 1
fi

node -e '
const fs = require("node:fs");
const [apiEnvPath, webEnvPath, apiUrl, webUrl] = process.argv.slice(1);
function setVars(filePath, updates) {
  let content = fs.readFileSync(filePath, "utf8");
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }
  fs.writeFileSync(filePath, content.endsWith("\n") ? content : content + "\n");
}
setVars(apiEnvPath, { API_URL: apiUrl, WEB_URL: webUrl });
setVars(webEnvPath, { NEXT_PUBLIC_API_URL: apiUrl, NEXT_PUBLIC_APP_URL: webUrl });
' "$API_ENV" "$WEB_ENV" "$API_TUNNEL_URL" "$WEB_TUNNEL_URL"

echo "API tunnel: $API_TUNNEL_URL"
echo "WEB tunnel: $WEB_TUNNEL_URL"

cd "$ROOT_DIR"
pnpm --filter @funnel/api db:migrate
pnpm --filter @funnel/api set-webhook
pnpm dev
