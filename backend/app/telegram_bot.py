"""Отправка сигналов и уведомлений в Telegram."""

import logging
import time

import httpx

log = logging.getLogger("telegram")


class TelegramNotifier:
    def __init__(self) -> None:
        self._settings: dict = {}
        self._last_signal: dict[int, float] = {}  # card_id -> monotonic ts
        self._last_key: dict[str, float] = {}

    def configure(self, settings: dict) -> None:
        self._settings = settings.get("telegram") or {}

    @property
    def enabled(self) -> bool:
        return bool(self._settings.get("enabled") and self._settings.get("bot_token")
                    and self._settings.get("chat_id"))

    async def send(self, text: str) -> bool:
        if not self.enabled:
            return False
        token = self._settings["bot_token"]
        chat_id = self._settings["chat_id"]
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(url, json={
                    "chat_id": chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                })
                if r.status_code != 200:
                    log.warning("telegram send failed: %s", r.text[:200])
                    return False
                return True
        except Exception as e:
            log.warning("telegram send error: %s", e)
            return False

    def signal_allowed(self, card_id: int) -> bool:
        """Антиспам: не чаще одного сигнала на карточку за cooldown."""
        cooldown = float(self._settings.get("signal_cooldown_sec", 300))
        last = self._last_signal.get(card_id, 0.0)
        return time.monotonic() - last >= cooldown

    def mark_signal(self, card_id: int) -> None:
        self._last_signal[card_id] = time.monotonic()

    def signal_allowed_key(self, key: str, cooldown: float | None = None) -> bool:
        cd = float(cooldown if cooldown is not None else self._settings.get("signal_cooldown_sec", 300))
        last = self._last_key.get(key, 0.0)
        return time.monotonic() - last >= cd

    def mark_signal_key(self, key: str) -> None:
        self._last_key[key] = time.monotonic()


def recommend_entry(spread_pct: float, funding_long: float | None,
                    funding_short: float | None, market_a: str, market_b: str) -> dict:
    """Рекомендация: чем заходить (монетой или USDT) и с каким плечом.

    Логика плеча: чем больше спред, тем больше запас хода и тем выше допустимое
    плечо, но ограничиваем 10x, чтобы ликвидация была далеко от входа.
    """
    base = 2 + spread_pct * 4  # 0.5% -> 4x, 1% -> 6x, 2% -> 10x
    leverage = max(2, min(10, round(base)))

    # Суммарный funding-поток позиции: лонг платит rate, шорт получает rate
    funding_edge = 0.0
    if funding_long is not None:
        funding_edge -= funding_long * 100
    if funding_short is not None:
        funding_edge += funding_short * 100

    if market_a == "spot" or market_b == "spot":
        margin = "монетой (спот-нога) + USDT на фьючерсной ноге"
        margin_short = "COIN+USDT"
    elif funding_edge > 0.005:
        margin = "USDT (USDT-M): funding работает в вашу пользу"
        margin_short = "USDT"
    else:
        margin = "USDT (USDT-M) — стандартный вариант; монетой только если она уже есть на балансе"
        margin_short = "USDT"

    return {
        "leverage": leverage,
        "margin": margin,
        "margin_short": margin_short,
        "funding_edge_pct": round(funding_edge, 4),
    }


notifier = TelegramNotifier()
