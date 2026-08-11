"""Хранилище настроек в таблице KV. Кэшируется в памяти, обновляется через API."""

import json
from typing import Any

from sqlalchemy import select

from .database import SessionLocal
from .models import KV

EXCHANGES = ["binance", "bitget", "kucoin", "gateio"]

DEFAULT_SETTINGS: dict[str, Any] = {
    # Режим торговли: paper — виртуальные сделки (работает без ключей), live — реальные ордера
    "trading_mode": "paper",
    "poll_interval_sec": 2.0,
    # Telegram
    "telegram": {
        "enabled": False,
        "bot_token": "",
        "chat_id": "",
        "signal_cooldown_sec": 300,
        "notify_trades": True,
    },
    # Ключи и прокси по биржам. Прокси — обход IP-ограничений на торговлю фьючерсами:
    # укажите http://user:pass@host:port или socks5://host:port
    "exchanges": {
        ex: {
            "api_key": "",
            "api_secret": "",
            "api_password": "",  # KuCoin/Bitget passphrase
            "proxy": "",
            "enabled": True,
        }
        for ex in EXCHANGES
    },
}

SECRET_FIELDS = {"api_key", "api_secret", "api_password", "bot_token"}

_cache: dict[str, Any] | None = None


def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


async def load_settings() -> dict[str, Any]:
    global _cache
    if _cache is not None:
        return _cache
    async with SessionLocal() as session:
        row = (await session.execute(select(KV).where(KV.key == "settings"))).scalar_one_or_none()
    stored = json.loads(row.value) if row and row.value else {}
    _cache = _deep_merge(DEFAULT_SETTINGS, stored)
    return _cache


async def save_settings(patch: dict[str, Any]) -> dict[str, Any]:
    global _cache
    current = await load_settings()
    merged = _deep_merge(current, patch)
    async with SessionLocal() as session:
        row = (await session.execute(select(KV).where(KV.key == "settings"))).scalar_one_or_none()
        if row is None:
            row = KV(key="settings", value=json.dumps(merged))
            session.add(row)
        else:
            row.value = json.dumps(merged)
        await session.commit()
    _cache = merged
    return merged


def mask_secrets(settings: dict[str, Any]) -> dict[str, Any]:
    """Возвращает копию настроек с замаскированными секретами для фронтенда."""

    def walk(obj: Any) -> Any:
        if isinstance(obj, dict):
            return {
                k: ("••••" + str(v)[-4:] if k in SECRET_FIELDS and v else walk(v))
                for k, v in obj.items()
            }
        return obj

    return walk(settings)


def unmask_patch(patch: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """Если фронт прислал замаскированное значение — оставляем прежнее."""

    def walk(p: Any, c: Any) -> Any:
        if isinstance(p, dict):
            out = {}
            for k, v in p.items():
                cv = c.get(k) if isinstance(c, dict) else None
                if k in SECRET_FIELDS and isinstance(v, str) and v.startswith("••••"):
                    out[k] = cv or ""
                else:
                    out[k] = walk(v, cv)
            return out
        return p

    return walk(patch, current)
