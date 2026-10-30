#!/usr/bin/env bash
# FitGym panel route deploy — sadece panelRoutes + panelAuth kopyalar, fitgymapi restart eder.
# Kullanım: SSHPASS='sifre' ./scripts/deploy-fitgym-panel.sh
set -euo pipefail

HOST="${FITGYM_DEPLOY_HOST:-root@104.247.173.71}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/fitgym-pro---api"

SSH_CMD=(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15)
SCP_CMD=(scp -o StrictHostKeyChecking=no)
if [[ -n "${SSHPASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
  SSH_CMD=(sshpass -e ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15)
  SCP_CMD=(sshpass -e scp -o StrictHostKeyChecking=no)
  export SSHPASS
fi

for dir in /root/fitgym-api /root/apis/fitgym-api; do
  if "${SSH_CMD[@]}" "$HOST" "test -d $dir/routes"; then
    REMOTE_DIR="$dir"
    break
  fi
done

if [[ -z "${REMOTE_DIR:-}" ]]; then
  echo "Hata: sunucuda fitgym-api klasörü bulunamadı."
  exit 1
fi

echo "Deploy hedefi: $HOST:$REMOTE_DIR"

"${SCP_CMD[@]}" "$SRC/routes/panelRoutes.js" "$HOST:$REMOTE_DIR/routes/panelRoutes.js"
"${SCP_CMD[@]}" "$SRC/middleware/panelAuth.js" "$HOST:$REMOTE_DIR/middleware/panelAuth.js"

"${SSH_CMD[@]}" "$HOST" "bash -s" <<EOF
set -e
cd "$REMOTE_DIR"
mkdir -p routes middleware
if ! grep -q "/panel/v1" server.js 2>/dev/null; then
  echo "UYARI: server.js içinde /panel/v1 mount yok — elle eklemen gerekebilir."
fi
if ! grep -q '^FITGYM_PANEL_API_KEY=' .env 2>/dev/null; then
  echo "UYARI: .env içinde FITGYM_PANEL_API_KEY yok."
fi
pm2 restart fitgymapi --update-env
sleep 3
pm2 show fitgymapi | egrep 'status|restarts|uptime|script path' || true
EOF

echo "Bitti. Panelde Yenile'ye bas."
