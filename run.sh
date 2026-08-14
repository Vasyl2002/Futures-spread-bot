#!/usr/bin/env bash
# Запуск SpreadDesk: установка зависимостей (при первом запуске), сборка фронта, старт сервера
set -e
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -r backend/requirements.txt
fi

if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install)
fi

if [ ! -d frontend/dist ]; then
  (cd frontend && npm run build)
fi

echo "SpreadDesk: http://localhost:${PORT:-8000}"
exec backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --app-dir backend
