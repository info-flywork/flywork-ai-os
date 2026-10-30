#!/usr/bin/env bash
# DayFlow panel deploy — panelRoutes + panelAuth + server.js mount, env key, pm2 restart dayflow
# Kullanım: SSHPASS='sifre' ./scripts/deploy-dayflow-panel.sh
set -euo pipefail

HOST="${DAYFLOW_DEPLOY_HOST:-root@104.247.173.71}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dayflow-backend"
PANEL_KEY="${DAYFLOW_PANEL_API_KEY:-c8\\5|2NWH81L}"

SSH_CMD=(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=25)
SCP_CMD=(scp -o StrictHostKeyChecking=no)
if [[ -n "${SSHPASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
  SSH_CMD=(sshpass -e ssh -o StrictHostKeyChecking=no -o ConnectTimeout=25)
  SCP_CMD=(sshpass -e scp -o StrictHostKeyChecking=no)
  export SSHPASS
fi

REMOTE_DIR=""
for dir in /root/apis/dayflow-backend /root/apis/dayflow-api /root/apis/dayflow; do
  if "${SSH_CMD[@]}" "$HOST" "test -f $dir/server.js"; then
    REMOTE_DIR="$dir"
    break
  fi
done

if [[ -z "$REMOTE_DIR" ]]; then
  echo "Hata: sunucuda dayflow server.js bulunamadı."
  exit 1
fi

echo "Deploy hedefi: $HOST:$REMOTE_DIR"

"${SSH_CMD[@]}" "$HOST" "mkdir -p $REMOTE_DIR/routes $REMOTE_DIR/middleware"
"${SCP_CMD[@]}" "$SRC/routes/panelRoutes.js" "$HOST:$REMOTE_DIR/routes/panelRoutes.js"
"${SCP_CMD[@]}" "$SRC/middleware/panelAuth.js" "$HOST:$REMOTE_DIR/middleware/panelAuth.js"
"${SCP_CMD[@]}" "$SRC/server.js" "$HOST:$REMOTE_DIR/server.js"

"${SSH_CMD[@]}" "$HOST" "bash -s" <<EOF
set -e
cd "$REMOTE_DIR"
touch .env
if ! grep -q '^DAYFLOW_PANEL_API_KEY=' .env; then
  echo 'DAYFLOW_PANEL_API_KEY=${PANEL_KEY}' >> .env
  echo 'DAYFLOW_PANEL_API_KEY eklendi'
else
  echo 'DAYFLOW_PANEL_API_KEY zaten var (degistirilmedi)'
fi
if ! grep -q "/panel/v1" server.js; then
  echo 'UYARI: server.js panel mount eksik'
fi
pm2 restart dayflow --update-env 2>/dev/null || pm2 restart dayflowapi --update-env
sleep 4
KEY=\$(grep '^DAYFLOW_PANEL_API_KEY=' .env | cut -d= -f2-)
PORT=\$(grep '^PORT=' .env | cut -d= -f2-); PORT=\${PORT:-3011}
for path in health analyse; do
  if curl -sS -H "x-panel-api-key: \$KEY" -H "Authorization: Bearer \$KEY" "http://127.0.0.1:\${PORT}/panel/v1/\$path" | head -c 200; then
    echo
  else
    echo "\$path FAIL"
  fi
done
pm2 show dayflow 2>/dev/null | egrep 'status|uptime|restarts|script path' || pm2 show dayflowapi | egrep 'status|uptime|restarts|script path' || true
EOF

echo "Bitti. Panelde DayFlow sayfasini yenileyin."
