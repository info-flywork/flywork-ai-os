#!/bin/sh
# Canlı veriyi değiştirmez. SQL yedeği yazar.
set -eu
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Yedek için .env dosyası gerekli." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL yok." >&2
  exit 1
fi

if ! command -v mysqldump >/dev/null 2>&1; then
  echo "mysqldump bulunamadı." >&2
  exit 1
fi

mkdir -p backups
stamp="$(date +%Y%m%d-%H%M%S)"
out="backups/flywork-${stamp}.sql"
export BACKUP_OUT="$out"

node <<'NODE'
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const url = new URL(process.env.DATABASE_URL);
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
const dir = mkdtempSync(join(tmpdir(), "flywork-dump-"));
const config = join(dir, "client.cnf");
writeFileSync(
  config,
  ["[client]", `host=${url.hostname}`, `port=${url.port || 3306}`, `user=${decodeURIComponent(url.username)}`, `password=${decodeURIComponent(url.password)}`, ""].join("\n"),
  { mode: 0o600 },
);
const result = spawnSync(
  "mysqldump",
  [
    `--defaults-extra-file=${config}`,
    "--single-transaction",
    "--skip-lock-tables",
    "--result-file",
    process.env.BACKUP_OUT,
    database,
  ],
  { stdio: "inherit" },
);
rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
NODE

echo "Yedek yazıldı: $out"
