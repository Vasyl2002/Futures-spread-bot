"""Глобальный сканер спредов по всем монетам всех бирж.

Карточки не нужны: каждые N секунд тянем тикеры Binance / Bitget / KuCoin / Gate,
считаем спреды фьюч↔фьюч (приоритет) и фьюч↔спот, шлём колл в Telegram
как только спред выше порога. Перед коллом подтверждаем стаканом,
чтобы не слать ложные сигналы по last/mark.
"""

import asyncio
import logging
import time
from collections import deque
from itertools import combinations
from typing import Any

from .exchange_manager import manager
from .settings_store import EXCHANGES
from .telegram_bot import notifier, recommend_entry
from .ws_manager import ws_manager

log = logging.getLogger("scanner")

EX_LABELS = {"binance": "BINANCE", "bitget": "BITGET", "kucoin": "KUCOIN", "gateio": "GATE.IO"}
MKT_LABELS = {"futures": "FUT", "spot": "SPOT"}

# слишком широкий спред стакана = неликвид, пропускаем
MAX_BOOK_WIDTH_PCT = 1.5
# выше этого почти наверняка разные контракты / мёртвая монета
MAX_SPREAD_PCT = 8.0


class SpreadScanner:
    def __init__(self) -> None:
        self._settings: dict[str, Any] = {}
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.opportunities: list[dict] = []
        self.recent_alerts: deque[dict] = deque(maxlen=80)
        self.errors: dict[str, str] = {}
        self.last_scan_ts: int | None = None
        self.scanned_symbols: int = 0
        self.tick_ms: int = 0
        # монета -> активный колл, пока спред не сошёлся
        self._open: dict[str, dict] = {}

    def configure(self, settings: dict[str, Any]) -> None:
        self._settings = settings

    def cfg(self) -> dict:
        return self._settings.get("scanner") or {}

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop.clear()
            self._task = asyncio.create_task(self._run(), name="spread-scanner")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=8)
            except asyncio.TimeoutError:
                self._task.cancel()

    async def _run(self) -> None:
        log.info("spread scanner started")
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                if self.cfg().get("enabled", True):
                    await self._tick()
            except Exception:
                log.exception("scanner tick failed")
            interval = float(self.cfg().get("interval_sec", 12))
            wait = max(2.0, interval - (time.monotonic() - started))
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=wait)
            except asyncio.TimeoutError:
                pass
        log.info("spread scanner stopped")

    async def _tick(self) -> None:
        t0 = time.monotonic()
        quote = self.cfg().get("quote", "USDT")
        include_spot = bool(self.cfg().get("include_spot", True))
        markets = ["futures"] + (["spot"] if include_spot else [])
        enabled = [
            ex for ex in EXCHANGES
            if (self._settings.get("exchanges") or {}).get(ex, {}).get("enabled", True)
        ]

        books: dict[tuple[str, str], dict] = {}
        errors: dict[str, str] = {}

        async def load(ex: str, mkt: str):
            try:
                books[(ex, mkt)] = await manager.fetch_tickers_map(ex, mkt, quote)
            except Exception as e:
                errors[f"{ex}:{mkt}"] = str(e)[:180]
                log.warning("scanner %s %s: %s", ex, mkt, e)

        await asyncio.gather(*[load(ex, mkt) for ex in enabled for mkt in markets])
        self.errors = errors

        venues = [(ex, mkt) for (ex, mkt), data in books.items() if data]
        opps: list[dict] = []
        seen_bases: set[str] = set()

        for (ex_a, mkt_a), (ex_b, mkt_b) in combinations(venues, 2):
            # не сравниваем спот со спотом одной и той же биржи; спот↔спот разных бирж — ок, но приоритет фьючам
            if mkt_a == "spot" and mkt_b == "spot":
                continue
            data_a = books[(ex_a, mkt_a)]
            data_b = books[(ex_b, mkt_b)]
            common = set(data_a) & set(data_b)
            seen_bases.update(common)
            for base in common:
                a, b = data_a[base], data_b[base]
                if not self._sane(a) or not self._sane(b):
                    continue
                # long A / short B: покупаем ask A, продаём bid B
                spread_ab = (b["bid"] - a["ask"]) / a["ask"] * 100
                spread_ba = (a["bid"] - b["ask"]) / b["ask"] * 100
                if spread_ab >= spread_ba:
                    direction, spread = "ab", spread_ab
                    long_ex, long_mkt, long_px = ex_a, mkt_a, a["ask"]
                    short_ex, short_mkt, short_px = ex_b, mkt_b, b["bid"]
                    long_fr, short_fr = a.get("funding_rate"), b.get("funding_rate")
                    long_sym, short_sym = a["symbol"], b["symbol"]
                else:
                    direction, spread = "ba", spread_ba
                    long_ex, long_mkt, long_px = ex_b, mkt_b, b["ask"]
                    short_ex, short_mkt, short_px = ex_a, mkt_a, a["bid"]
                    long_fr, short_fr = b.get("funding_rate"), a.get("funding_rate")
                    long_sym, short_sym = b["symbol"], a["symbol"]
                if short_mkt == "spot":
                    continue  # шортить спот нельзя
                if spread > MAX_SPREAD_PCT:
                    continue
                rec = recommend_entry(spread, long_fr, short_fr, long_mkt, short_mkt)
                opps.append({
                    "symbol": base,
                    "quote": quote,
                    "spread": round(spread, 4),
                    "direction": direction,
                    "long": {
                        "exchange": long_ex, "label": EX_LABELS[long_ex],
                        "market": long_mkt, "price": long_px,
                        "funding_rate": long_fr, "ccxt_symbol": long_sym,
                    },
                    "short": {
                        "exchange": short_ex, "label": EX_LABELS[short_ex],
                        "market": short_mkt, "price": short_px,
                        "funding_rate": short_fr, "ccxt_symbol": short_sym,
                    },
                    "leverage": rec["leverage"],
                    "margin": rec["margin"],
                    "margin_short": rec["margin_short"],
                    "kind": "fut-fut" if long_mkt == "futures" and short_mkt == "futures" else "fut-spot",
                })

        opps.sort(key=lambda x: x["spread"], reverse=True)
        display_min = float(self.cfg().get("display_min_pct", 0.08))
        shown = [o for o in opps if o["spread"] >= display_min][:120]
        self.opportunities = shown
        self.scanned_symbols = len(seen_bases)
        self.last_scan_ts = int(time.time() * 1000)
        self.tick_ms = int((time.monotonic() - t0) * 1000)

        await ws_manager.broadcast({
            "type": "scanner",
            "ts": self.last_scan_ts,
            "scanned": self.scanned_symbols,
            "tick_ms": self.tick_ms,
            "errors": self.errors,
            "data": shown[:60],
        })

        await self._alert(opps)

    @staticmethod
    def _sane(tick: dict) -> bool:
        bid, ask = tick["bid"], tick["ask"]
        if bid <= 0 or ask <= 0 or ask < bid * 0.5:
            return False
        width = (ask - bid) / bid * 100
        return width <= MAX_BOOK_WIDTH_PCT

    async def _alert(self, opps: list[dict]) -> None:
        """Один колл на монету. Пока спред открыт — молчим.
        Следующий колл (и сообщение «сошёлся») — только когда спред вернулся к норме.
        """
        threshold = float(self.cfg().get("min_spread_pct", 2.0))
        reset_at = float(self.cfg().get("reset_spread_pct", 0.4))
        max_alerts = int(self.cfg().get("max_alerts_per_tick", 6))

        best: dict[str, dict] = {}
        for o in opps:
            prev = best.get(o["symbol"])
            if prev is None or o["spread"] > prev["spread"]:
                best[o["symbol"]] = o

        # 1) закрытые спреды — один колл «сошёлся», после этого монета снова свободна
        closed = []
        for symbol, state in list(self._open.items()):
            current = best.get(symbol)
            spread_now = current["spread"] if current else 0.0
            if spread_now <= reset_at:
                closed.append((symbol, state, spread_now, current))
                self._open.pop(symbol, None)

        for symbol, state, spread_now, current in closed:
            await self._send_close(symbol, state, spread_now, current)

        # 2) новые открытия — не больше одной монеты-колла, лучшая комбинация бирж
        sent = 0
        ranked = sorted(best.values(), key=lambda x: x["spread"], reverse=True)
        for opp in ranked:
            if sent >= max_alerts:
                break
            symbol = opp["symbol"]
            if symbol in self._open:
                continue
            if opp["spread"] < threshold:
                continue
            confirmed = await self._confirm(opp)
            if confirmed is None or confirmed["spread"] < threshold:
                continue
            if symbol in self._open:
                continue
            self._open[symbol] = {
                "spread": confirmed["spread"],
                "long": confirmed["long"],
                "short": confirmed["short"],
                "kind": confirmed["kind"],
                "ts": int(time.time() * 1000),
            }
            await self._send_call(confirmed)
            self.recent_alerts.appendleft({**confirmed, "ts": int(time.time() * 1000)})
            sent += 1

    async def _send_close(self, symbol: str, state: dict, spread_now: float, current: dict | None) -> None:
        long = state.get("long") or {}
        short = state.get("short") or {}
        text = (
            f"✅ <b>СПРЕД {symbol}/USDT сошёлся</b>  {spread_now:+.3f}%\n"
            f"Был колл {state.get('spread', 0):+.3f}%: "
            f"LONG {long.get('label', '')} → SHORT {short.get('label', '')}\n"
            f"Можно снова ждать расхождение."
        )
        await notifier.send(text)
        log.info("spread closed %s now=%.3f%% was=%.3f%%", symbol, spread_now, state.get("spread", 0))

    async def _confirm(self, opp: dict) -> dict | None:
        try:
            long, short = opp["long"], opp["short"]
            book_l, book_s = await asyncio.gather(
                manager.get_book_top(long["exchange"], long["market"], long["ccxt_symbol"]),
                manager.get_book_top(short["exchange"], short["market"], short["ccxt_symbol"]),
            )
            if not book_l.get("ask") or not book_s.get("bid"):
                return None
            spread = (book_s["bid"] - book_l["ask"]) / book_l["ask"] * 100
            out = dict(opp)
            out["spread"] = round(spread, 4)
            out["long"] = {**long, "price": book_l["ask"]}
            out["short"] = {**short, "price": book_s["bid"]}
            rec = recommend_entry(spread, long.get("funding_rate"), short.get("funding_rate"),
                                  long["market"], short["market"])
            out["leverage"] = rec["leverage"]
            out["margin"] = rec["margin"]
            out["margin_short"] = rec["margin_short"]
            return out
        except Exception as e:
            log.debug("confirm failed %s: %s", opp.get("symbol"), e)
            return None

    async def _send_call(self, opp: dict) -> None:
        long, short = opp["long"], opp["short"]

        def fr(x):
            return f"{x * 100:+.4f}%" if x is not None else "—"

        kind = "фьюч ↔ фьюч" if opp["kind"] == "fut-fut" else "фьюч ↔ спот"
        text = (
            f"🔔 <b>СПРЕД {opp['symbol']}/{opp['quote']}</b>  "
            f"<b>{opp['spread']:+.3f}%</b>  ({kind})\n\n"
            f"🟢 LONG {long['label']} {MKT_LABELS[long['market']]} @ {long['price']}\n"
            f"🔴 SHORT {short['label']} {MKT_LABELS[short['market']]} @ {short['price']}\n\n"
            f"Funding: long {fr(long.get('funding_rate'))} | "
            f"short {fr(short.get('funding_rate'))}\n\n"
            f"💡 Заходить: <b>{opp['margin_short']}</b>\n"
            f"💡 Плечо: <b>{opp['leverage']}x</b>\n"
            f"({opp['margin']})"
        )
        await notifier.send(text)
        log.info("telegram call %s %.3f%% %s/%s", opp["symbol"], opp["spread"],
                 long["exchange"], short["exchange"])

    def snapshot(self) -> dict:
        return {
            "ts": self.last_scan_ts,
            "scanned": self.scanned_symbols,
            "tick_ms": self.tick_ms,
            "errors": self.errors,
            "data": self.opportunities[:60],
            "alerts": list(self.recent_alerts)[:40],
            "enabled": self.cfg().get("enabled", True),
            "min_spread_pct": self.cfg().get("min_spread_pct", 2.0),
        }


scanner = SpreadScanner()
