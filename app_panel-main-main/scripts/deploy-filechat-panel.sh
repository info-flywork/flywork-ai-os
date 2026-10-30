#!/usr/bin/env bash
# FileChat panel deploy — panelRoutes + panelAuth + app.js mount, env key, pm2 restart filechat
# Kullanım: SSHPASS='sifre' ./scripts/deploy-filechat-panel.sh
set -euo pipefail

HOST="${FILECHAT_DEPLOY_HOST:-root@104.247.173.71}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/filechatapi"
PANEL_KEY="${FILECHAT_PANEL_API_KEY:-c8\\5|2NWH81L}"

SSH_CMD=(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=25)
SCP_CMD=(scp -o StrictHostKeyChecking=no)
if [[ -n "${SSHPASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
  SSH_CMD=(sshpass -e ssh -o StrictHostKeyChecking=no -o ConnectTimeout=25)
  SCP_CMD=(sshpass -e scp -o StrictHostKeyChecking=no)
  export SSHPASS
fi

REMOTE_DIR=""
for dir in /root/apis/filechat /root/apis/filechatapi /root/apis/filechat-api; do
  if "${SSH_CMD[@]}" "$HOST" "test -d $dir"; then
    REMOTE_DIR="$dir"
    break
  fi
done

if [[ -z "$REMOTE_DIR" ]]; then
  echo "Hata: sunucuda filechatapi klasörü bulunamadı."
  exit 1
fi

echo "Deploy hedefi: $HOST:$REMOTE_DIR"

"${SSH_CMD[@]}" "$HOST" "mkdir -p $REMOTE_DIR/routes $REMOTE_DIR/middleware"
"${SCP_CMD[@]}" "$SRC/routes/panelRoutes.js" "$HOST:$REMOTE_DIR/routes/panelRoutes.js"
"${SCP_CMD[@]}" "$SRC/middleware/panelAuth.js" "$HOST:$REMOTE_DIR/middleware/panelAuth.js"
"${SCP_CMD[@]}" "$SRC/app.js" "$HOST:$REMOTE_DIR/app.js"

"${SSH_CMD[@]}" "$HOST" "bash -s" <<EOF
set -e
cd "$REMOTE_DIR"
touch .env
if ! grep -q '^FILECHAT_PANEL_API_KEY=' .env; then
  echo 'FILECHAT_PANEL_API_KEY=${PANEL_KEY}' >> .env
  echo 'FILECHAT_PANEL_API_KEY eklendi'
else
  echo 'FILECHAT_PANEL_API_KEY zaten var (degistirilmedi)'
fi
if ! grep -q "/panel/v1" app.js; then
  echo 'UYARI: app.js panel mount eksik — gonderilen app.js kontrol edin'
fi
pm2 restart filechat --update-env
sleep 4
KEY=\$(grep '^FILECHAT_PANEL_API_KEY=' .env | cut -d= -f2-)
PORT=\$(grep '^PORT=' .env | cut -d= -f2-); PORT=\${PORT:-3012}
for path in health analyse; do
  if curl -sS -H "x-panel-api-key: \$KEY" -H "Authorization: Bearer \$KEY" "http://127.0.0.1:\${PORT}/panel/v1/\$path" | head -c 200; then
    echo
  else
    echo "\$path FAIL"
  fi
done
pm2 show filechat | egrep 'status|uptime|restarts|script path' || true
EOF

echo "Bitti. Panelde FileChat sayfasini yenileyin."
