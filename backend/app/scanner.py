"""Глобальный сканер спредов по всем монетам всех бирж.

Карточки не нужны: каждые N секунд тянем тикеры Binance / Bitget / KuCoin / Gate,
считаем спреды фьюч↔фьюч (приоритет) и фьюч↔спот, шлём колл в Telegram
как только спред выше порога. Перед коллом подтверждаем стаканом,
чтобы не слать ложные сигналы по last/mark.
"""

import asyncio
import json
import logging
import time
from collections import deque
from itertools import combinations
from typing import Any

from sqlalchemy import select

from .database import SessionLocal
from .exchange_manager import manager
from .models import KV
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
# история спреда: ~20 мин при интервале 12 с
HISTORY_LEN = 100
OPEN_KV_KEY = "scanner_open"


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
        self._history: dict[str, deque] = {}
        self._open_loaded = False

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
                if direction == "ab":
                    long_vol, short_vol = a.get("quote_volume") or 0, b.get("quote_volume") or 0
                else:
                    long_vol, short_vol = b.get("quote_volume") or 0, a.get("quote_volume") or 0
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
                        "quote_volume": long_vol,
                    },
                    "short": {
                        "exchange": short_ex, "label": EX_LABELS[short_ex],
                        "market": short_mkt, "price": short_px,
                        "funding_rate": short_fr, "ccxt_symbol": short_sym,
                        "quote_volume": short_vol,
                    },
                    "leverage": rec["leverage"],
                    "margin": rec["margin"],
                    "margin_short": rec["margin_short"],
                    "kind": "fut-fut" if long_mkt == "futures" and short_mkt == "futures" else "fut-spot",
                    "min_volume": min(long_vol, short_vol),
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

    async def _load_open(self) -> None:
        if self._open_loaded:
            return
        async with SessionLocal() as session:
            row = (await session.execute(select(KV).where(KV.key == OPEN_KV_KEY))).scalar_one_or_none()
        if row and row.value:
            try:
                self._open = json.loads(row.value) or {}
            except json.JSONDecodeError:
                self._open = {}
        self._open_loaded = True

    async def _save_open(self) -> None:
        payload = json.dumps(self._open)
        async with SessionLocal() as session:
            row = (await session.execute(select(KV).where(KV.key == OPEN_KV_KEY))).scalar_one_or_none()
            if row is None:
                session.add(KV(key=OPEN_KV_KEY, value=payload))
            else:
                row.value = payload
            await session.commit()

    def _record_history(self, best: dict[str, dict]) -> None:
        for symbol, opp in best.items():
            hist = self._history.setdefault(symbol, deque(maxlen=HISTORY_LEN))
            hist.append(opp["spread"])

    def _is_new_spike(self, symbol: str, spread: float, threshold: float, reset_at: float) -> bool:
        """Настоящий арбитраж появляется импульсом. Если спред часами висит на 3–7% —
        это мёртвый базис, он не сойдётся."""
        warmup = int(self.cfg().get("warmup_scans", 8))
        hist = list(self._history.get(symbol) or [])
        if len(hist) < warmup:
            return False
        # текущую точку не считаем «узкой»
        past = hist[:-1] if hist else []
        if not past:
            return False
        was_tight = min(past) <= max(reset_at, threshold * 0.25)
        # спред должен заметно вырасти относительно недавнего минимума
        jumped = spread - min(past) >= max(1.0, threshold * 0.5)
        return was_tight and jumped

    async def _alert(self, opps: list[dict]) -> None:
        await self._load_open()
        threshold = float(self.cfg().get("min_spread_pct", 2.0))
        reset_at = float(self.cfg().get("reset_spread_pct", 0.4))
        max_alerts = int(self.cfg().get("max_alerts_per_tick", 4))
        min_vol = float(self.cfg().get("min_volume_usd", 200000))
        telegram_spot = bool(self.cfg().get("telegram_spot", False))

        best: dict[str, dict] = {}
        for o in opps:
            prev = best.get(o["symbol"])
            if prev is None or o["spread"] > prev["spread"]:
                best[o["symbol"]] = o
        self._record_history(best)

        closed = []
        for symbol, state in list(self._open.items()):
            current = best.get(symbol)
            spread_now = current["spread"] if current else 0.0
            if spread_now <= reset_at:
                closed.append((symbol, state, spread_now))
                self._open.pop(symbol, None)
        if closed:
            await self._save_open()
        for symbol, state, spread_now in closed:
            await self._send_close(symbol, state, spread_now)

        sent = 0
        ranked = sorted(best.values(), key=lambda x: x["spread"], reverse=True)
        dirty = False
        for opp in ranked:
            if sent >= max_alerts:
                break
            symbol = opp["symbol"]
            if symbol in self._open:
                continue
            if opp["spread"] < threshold:
                continue
            if opp["kind"] != "fut-fut" and not telegram_spot:
                continue
            if (opp.get("min_volume") or 0) < min_vol:
                log.info("skip %s thin volume %.0f", symbol, opp.get("min_volume") or 0)
                continue
            if not self._is_new_spike(symbol, opp["spread"], threshold, reset_at):
                log.info("skip %s stuck/fake spread %.3f%%", symbol, opp["spread"])
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
            dirty = True
            await self._send_call(confirmed)
            self.recent_alerts.appendleft({**confirmed, "ts": int(time.time() * 1000)})
            sent += 1
        if dirty:
            await self._save_open()

    async def _send_close(self, symbol: str, state: dict, spread_now: float) -> None:
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
            min_book = float(self.cfg().get("min_book_usd", 400))
            book_l, book_s = await asyncio.gather(
                manager.get_book_top(long["exchange"], long["market"], long["ccxt_symbol"]),
                manager.get_book_top(short["exchange"], short["market"], short["ccxt_symbol"]),
            )
            if not book_l.get("ask") or not book_s.get("bid"):
                return None
            # ширина стакана: если сам рынок 0.5%+ — это не арбитраж, а дырка в книге
            for book, role in ((book_l, "long"), (book_s, "short")):
                if book["bid"] and book["ask"] and book["bid"] > 0:
                    width = (book["ask"] - book["bid"]) / book["bid"] * 100
                    if width > 0.45:
                        log.info("skip %s wide book %s %.2f%%", opp["symbol"], role, width)
                        return None
            if (book_l.get("ask_notional") or 0) < min_book or (book_s.get("bid_notional") or 0) < min_book:
                log.info("skip %s thin book L=%.0f S=%.0f", opp["symbol"],
                         book_l.get("ask_notional") or 0, book_s.get("bid_notional") or 0)
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
        vol = opp.get("min_volume") or 0
        vol_txt = f"{vol/1e6:.1f}M" if vol >= 1e6 else f"{vol/1e3:.0f}k"
        text = (
            f"🔔 <b>НОВЫЙ СПРЕД {opp['symbol']}/{opp['quote']}</b>  "
            f"<b>{opp['spread']:+.3f}%</b>  ({kind})\n"
            f"Импульс (раньше был узкий, не застрявший базис)\n\n"
            f"🟢 LONG {long['label']} {MKT_LABELS[long['market']]} @ {long['price']}\n"
            f"🔴 SHORT {short['label']} {MKT_LABELS[short['market']]} @ {short['price']}\n\n"
            f"Funding: long {fr(long.get('funding_rate'))} | "
            f"short {fr(short.get('funding_rate'))}\n"
            f"Объём 24ч ≥ {vol_txt} USDT\n\n"
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
