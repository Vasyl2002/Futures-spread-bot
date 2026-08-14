"""Единый доступ к биржам через ccxt (async).

Поддерживаются Binance, Bitget, KuCoin, Gate.io — спот и USDT-M фьючерсы.
Для обхода IP-ограничений (например, торговля фьючерсами Binance из
запрещённого региона) на каждую биржу можно указать свой прокси
(http:// или socks5://) в настройках.
"""

import asyncio
import logging
import time
from typing import Any

import ccxt.async_support as ccxt

log = logging.getLogger("exchange_manager")

# ccxt-классы: для фьючерсов Binance и KuCoin — отдельные классы
CLIENT_CLASSES: dict[tuple[str, str], str] = {
    ("binance", "spot"): "binance",
    ("binance", "futures"): "binanceusdm",
    ("bitget", "spot"): "bitget",
    ("bitget", "futures"): "bitget",
    ("kucoin", "spot"): "kucoin",
    ("kucoin", "futures"): "kucoinfutures",
    ("gateio", "spot"): "gate",
    ("gateio", "futures"): "gate",
}

# Примерные тейкерские комиссии (%), используются для оценки PnL в paper-режиме
TAKER_FEES: dict[tuple[str, str], float] = {
    ("binance", "spot"): 0.10, ("binance", "futures"): 0.05,
    ("bitget", "spot"): 0.10, ("bitget", "futures"): 0.06,
    ("kucoin", "spot"): 0.10, ("kucoin", "futures"): 0.06,
    ("gateio", "spot"): 0.10, ("gateio", "futures"): 0.05,
}

FUNDING_CACHE_TTL = 60.0
BOOK_CACHE_TTL = 1.5

# у KuCoin стакан можно запросить только глубиной 20 или 100
BOOK_LIMITS = {"kucoin": 20}


class ExchangeManager:
    def __init__(self) -> None:
        self._clients: dict[tuple[str, str], ccxt.Exchange] = {}
        self._markets_loaded: set[tuple[str, str]] = set()
        self._settings: dict[str, Any] = {}
        self._funding_cache: dict[tuple[str, str], tuple[float, dict]] = {}
        self._book_cache: dict[tuple[str, str, str], tuple[float, dict]] = {}
        self._lock = asyncio.Lock()

    def configure(self, settings: dict[str, Any]) -> None:
        self._settings = settings

    async def reset(self) -> None:
        """Закрыть все клиенты (после смены ключей/прокси)."""
        async with self._lock:
            for client in self._clients.values():
                try:
                    await client.close()
                except Exception:
                    pass
            self._clients.clear()
            self._markets_loaded.clear()

    async def close(self) -> None:
        await self.reset()

    def _build_client(self, exchange: str, market: str) -> ccxt.Exchange:
        class_name = CLIENT_CLASSES[(exchange, market)]
        ex_cfg = (self._settings.get("exchanges") or {}).get(exchange, {})
        config: dict[str, Any] = {
            "enableRateLimit": True,
            "options": {"defaultType": "swap" if market == "futures" else "spot"},
        }
        if ex_cfg.get("api_key"):
            config["apiKey"] = ex_cfg["api_key"]
            config["secret"] = ex_cfg.get("api_secret", "")
            if ex_cfg.get("api_password"):
                config["password"] = ex_cfg["api_password"]

        client: ccxt.Exchange = getattr(ccxt, class_name)(config)

        proxy = (ex_cfg.get("proxy") or "").strip()
        if proxy:
            # ccxt требует ровно один вид прокси, выбираем по схеме URL
            if proxy.startswith("socks"):
                client.socksProxy = proxy
            elif proxy.startswith("https://"):
                client.httpsProxy = proxy
            elif proxy.startswith("http://"):
                client.httpProxy = proxy
            else:
                log.warning("ignoring invalid proxy for %s: %r", exchange, proxy)
        return client

    async def get_client(self, exchange: str, market: str) -> ccxt.Exchange:
        key = (exchange, market)
        async with self._lock:
            if key not in self._clients:
                self._clients[key] = self._build_client(exchange, market)
        client = self._clients[key]
        if key not in self._markets_loaded:
            await client.load_markets()
            self._markets_loaded.add(key)
        return client

    # ------------------------------------------------------------------ symbols

    def unified_symbol(self, market: str, base: str, quote: str = "USDT") -> str:
        return f"{base}/{quote}:{quote}" if market == "futures" else f"{base}/{quote}"

    async def list_symbols(self, exchange: str, market: str, quote: str = "USDT") -> list[str]:
        """Список базовых монет, доступных на бирже для данного типа рынка."""
        client = await self.get_client(exchange, market)
        bases = []
        for m in client.markets.values():
            if not m.get("active", True):
                continue
            if market == "futures" and not m.get("swap"):
                continue
            if market == "spot" and not m.get("spot"):
                continue
            if m.get("quote") != quote:
                continue
            if market == "futures" and m.get("settle") != quote:
                continue
            bases.append(m["base"])
        return sorted(set(bases))

    # ------------------------------------------------------------------ market data

    async def get_book_top(self, exchange: str, market: str, symbol: str) -> dict:
        """Лучший bid/ask с коротким кэшем (одна карточка может делить данные с другой)."""
        key = (exchange, market, symbol)
        cached = self._book_cache.get(key)
        now = time.monotonic()
        if cached and now - cached[0] < BOOK_CACHE_TTL:
            return cached[1]
        client = await self.get_client(exchange, market)
        ob = await client.fetch_order_book(symbol, limit=BOOK_LIMITS.get(exchange, 5))
        bid = ob["bids"][0][0] if ob["bids"] else None
        ask = ob["asks"][0][0] if ob["asks"] else None
        bid_qty = ob["bids"][0][1] if ob["bids"] else 0
        ask_qty = ob["asks"][0][1] if ob["asks"] else 0
        result = {"bid": bid, "ask": ask, "bid_qty": bid_qty, "ask_qty": ask_qty, "ts": ob.get("timestamp")}
        self._book_cache[key] = (now, result)
        return result

    async def get_funding(self, exchange: str, symbol: str) -> dict:
        """Ставка финансирования и время следующей выплаты (кэш 60 c)."""
        key = (exchange, symbol)
        cached = self._funding_cache.get(key)
        now = time.monotonic()
        if cached and now - cached[0] < FUNDING_CACHE_TTL:
            return cached[1]
        try:
            client = await self.get_client(exchange, "futures")
            fr = await client.fetch_funding_rate(symbol)
            result = {
                "rate": fr.get("fundingRate"),
                "next_ts": fr.get("nextFundingTimestamp") or fr.get("fundingTimestamp"),
                "interval": fr.get("interval"),
            }
        except Exception as e:  # у некоторых бирж метод может отличаться
            log.debug("funding fetch failed %s %s: %s", exchange, symbol, e)
            result = {"rate": None, "next_ts": None, "interval": None}
        self._funding_cache[key] = (now, result)
        return result

    async def get_ohlcv(self, exchange: str, market: str, symbol: str,
                        timeframe: str = "5m", limit: int = 200) -> list:
        client = await self.get_client(exchange, market)
        return await client.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)

    # ------------------------------------------------------------------ account

    def has_keys(self, exchange: str) -> bool:
        ex_cfg = (self._settings.get("exchanges") or {}).get(exchange, {})
        return bool(ex_cfg.get("api_key") and ex_cfg.get("api_secret"))

    async def fetch_balances(self, exchange: str) -> dict:
        """Балансы спота и фьючерсов (требуются API-ключи)."""
        out: dict[str, Any] = {"spot": {}, "futures": {}, "error": None}
        if not self.has_keys(exchange):
            out["error"] = "no_keys"
            return out
        for market in ("spot", "futures"):
            try:
                client = await self.get_client(exchange, market)
                bal = await client.fetch_balance()
                totals = {
                    coin: amount
                    for coin, amount in (bal.get("total") or {}).items()
                    if amount and abs(float(amount)) > 1e-9
                }
                out[market] = totals
            except Exception as e:
                out["error"] = str(e)[:200]
        return out

    # ------------------------------------------------------------------ trading

    def taker_fee_pct(self, exchange: str, market: str) -> float:
        return TAKER_FEES.get((exchange, market), 0.1)

    async def set_leverage(self, exchange: str, symbol: str, leverage: int) -> None:
        try:
            client = await self.get_client(exchange, "futures")
            await client.set_leverage(leverage, symbol)
        except Exception as e:
            log.warning("set_leverage failed %s %s: %s", exchange, symbol, e)

    async def create_market_order(self, exchange: str, market: str, symbol: str,
                                  side: str, amount: float,
                                  reduce_only: bool = False) -> dict:
        client = await self.get_client(exchange, market)
        params: dict[str, Any] = {}
        if market == "futures" and reduce_only:
            params["reduceOnly"] = True
        amount = float(client.amount_to_precision(symbol, amount))
        order = await client.create_order(symbol, "market", side, amount, None, params)
        return order


manager = ExchangeManager()
