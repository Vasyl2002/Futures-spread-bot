#!/usr/bin/env bash
# Установка SpreadDesk на чистый Ubuntu VPS (запускать из корня репозитория под root).
# Использование: sudo bash deploy/install.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "==> 1/6 Файл подкачки (нужен для сборки фронтенда на 1 ГБ RAM)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    swap 2G создан"
else
  echo "    swap уже есть"
fi

echo "==> 2/6 Системные пакеты"
apt-get update -q
apt-get install -y -q python3-venv python3-pip nodejs npm curl >/dev/null

echo "==> 3/6 Сборка фронтенда"
cd "$REPO_DIR/frontend"
npm install --no-audit --no-fund >/dev/null
npm run build >/dev/null
echo "    собрано"

echo "==> 4/6 Backend (venv + зависимости)"
cd "$REPO_DIR/backend"
python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
echo "    готово"

echo "==> 5/6 Пароль веб-интерфейса"
if [ -z "${SPREADDESK_PASSWORD:-}" ]; then
  read -r -s -p "    Придумайте пароль для входа в веб-интерфейс: " SPREADDESK_PASSWORD
  echo
fi
if [ -z "$SPREADDESK_PASSWORD" ]; then
  echo "    ОШИБКА: пароль пустой — на публичном сервере это опасно"; exit 1
fi

echo "==> 6/6 Служба systemd (автозапуск 24/7)"
cat > /etc/systemd/system/spreaddesk.service <<EOF
[Unit]
Description=SpreadDesk spread trading terminal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR/backend
Environment=SPREADDESK_PASSWORD=$SPREADDESK_PASSWORD
ExecStart=$REPO_DIR/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
chmod 600 /etc/systemd/system/spreaddesk.service
systemctl daemon-reload
systemctl enable --now spreaddesk >/dev/null

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 8000/tcp >/dev/null
  echo "    ufw: порт 8000 открыт"
fi

sleep 3
IP=$(curl -s --max-time 5 ifconfig.me || echo "<IP сервера>")
STATUS=$(systemctl is-active spreaddesk)
echo
echo "=================================================="
echo " Готово! Статус службы: $STATUS"
echo " Веб-интерфейс:  http://$IP:8000"
echo " Логи:           journalctl -u spreaddesk -f"
echo " Перезапуск:     systemctl restart spreaddesk"
echo "=================================================="
