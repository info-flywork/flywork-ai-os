#!/bin/sh
# Geri yükleme yalnızca boş ve ayrı bir veritabanına yapılır.
set -eu

file="${1:-}"
target="${RESTORE_DATABASE_URL:-}"

if [ -z "$file" ] || [ -z "$target" ]; then
  echo "Kullanım: RESTORE_DATABASE_URL=mysql://KULLANICI:SIFRE@127.0.0.1:3306/ayri_veritabani sh scripts/restore-database.sh backups/flywork-TARIH.sql" >&2
  exit 1
fi

case "$target" in
  *flywork1_yonetim-paneli|*flywork1_yonetim-paneli\?*)
    echo "Canlı veritabanına geri yükleme kapalı. Ayrı bir veritabanı adı kullanın." >&2
    exit 1
    ;;
esac

if [ ! -f "$file" ]; then
  echo "Yedek dosyası bulunamadı." >&2
  exit 1
fi

if ! command -v mysql >/dev/null 2>&1; then
  echo "mysql istemcisi bulunamadı." >&2
  exit 1
fi

DATABASE_URL="$target" RESTORE_FILE="$file" node <<'NODE'
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const url = new URL(process.env.DATABASE_URL);
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
const dir = mkdtempSync(join(tmpdir(), "flywork-restore-"));
const config = join(dir, "client.cnf");
writeFileSync(
  config,
  ["[client]", `host=${url.hostname}`, `port=${url.port || 3306}`, `user=${decodeURIComponent(url.username)}`, `password=${decodeURIComponent(url.password)}`, ""].join("\n"),
  { mode: 0o600 },
);
const result = spawnSync(
  "mysql",
  [`--defaults-extra-file=${config}`, database],
  { input: readFileSync(process.env.RESTORE_FILE), stdio: ["pipe", "inherit", "inherit"] },
);
rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
NODE

echo "Geri yükleme ayrı veritabanında bitti. Canlı adı değiştirilmedi."
