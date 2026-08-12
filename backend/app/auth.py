"""Простая защита паролем для публичного развёртывания (VPS).

Пароль задаётся переменной окружения SPREADDESK_PASSWORD. Если она не задана —
авторизация выключена (удобно для локального запуска).
"""

import hashlib
import hmac
import os

PASSWORD = os.environ.get("SPREADDESK_PASSWORD", "")


def required() -> bool:
    return bool(PASSWORD)


def make_token() -> str | None:
    if not PASSWORD:
        return None
    return hashlib.sha256(f"spreaddesk-v1:{PASSWORD}".encode()).hexdigest()


def check_password(password: str) -> bool:
    return bool(PASSWORD) and hmac.compare_digest(password, PASSWORD)


def check_token(token: str | None) -> bool:
    if not required():
        return True
    expected = make_token()
    return bool(token) and hmac.compare_digest(token, expected or "")
