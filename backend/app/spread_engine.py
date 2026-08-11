"""Движок мониторинга спредов.

Каждые N секунд: котировки обеих ног всех карточек, спреды в обе стороны,
funding, PnL открытых позиций, сигналы в Telegram, авто-вход/выход,
трансляция состояния на фронтенд по WebSocket.
"""

import asyncio
import logging
import time
from collections import deque
from typing import Any

from sqlalchemy import select

from . import trader
from .database import SessionLocal
from .exchange_manager import manager
from .models import Card, Position
from .telegram_bot import notifier, recommend_entry
from .ws_manager import ws_manager

log = logging.getLogger("engine")

HISTORY_MAXLEN = 4000  # ~2 часа при интервале 2 c

EX_LABELS = {"binance": "BINANCE", "bitget": "BITGET", "kucoin": "KUCOIN", "gateio": "GATE.IO"}


class CardRuntime:
    def __init__(self) -> None:
        self.history: deque[tuple[int, float]] = deque(maxlen=HISTORY_MAXLEN)
        self.min_spread: float | None = None
        self.max_spread: float | None = None
        self.last_error: str | None = None


class SpreadEngine:
    def __init__(self) -> None:
        self.runtimes: dict[int, CardRuntime] = {}
        self.states: dict[int, dict] = {}
        self._task: asyncio.Task | None = None
        self._settings: dict[str, Any] = {}
        self._stop = asyncio.Event()

    def configure(self, settings: dict[str, Any]) -> None:
        self._settings = settings

    @property
    def trading_mode(self) -> str:
        return self._settings.get("trading_mode", "paper")

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop.clear()
            self._task = asyncio.create_task(self._run(), name="spread-engine")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except asyncio.TimeoutError:
                self._task.cancel()

    async def _run(self) -> None:
        log.info("spread engine started")
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                await self._tick()
            except Exception:
                log.exception("engine tick failed")
            interval = float(self._settings.get("poll_interval_sec", 2.0))
            elapsed = time.monotonic() - started
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=max(0.2, interval - elapsed))
            except asyncio.TimeoutError:
                pass
        log.info("spread engine stopped")

    async def _tick(self) -> None:
        async with SessionLocal() as session:
            cards = list((await session.execute(
                select(Card).where(Card.archived == False)  # noqa: E712
            )).scalars())
            positions = list((await session.execute(
                select(Position).where(Position.status == "open")
            )).scalars())

        pos_by_card: dict[int, list[Position]] = {}
        for p in positions:
            pos_by_card.setdefault(p.card_id, []).append(p)

        results = await asyncio.gather(
            *[self._process_card(card, pos_by_card.get(card.id, [])) for card in cards],
            return_exceptions=True,
        )
        states = []
        for card, res in zip(cards, results):
            if isinstance(res, Exception):
                log.warning("card %s failed: %s", card.id, res)
                rt = self.runtimes.setdefault(card.id, CardRuntime())
                rt.last_error = str(res)[:200]
                state = self.states.get(card.id) or {"card_id": card.id}
                state["error"] = rt.last_error
                states.append(state)
            else:
                states.append(res)

        # чистим состояния удалённых карточек
        alive = {c.id for c in cards}
        for cid in list(self.states):
            if cid not in alive:
                self.states.pop(cid, None)
                self.runtimes.pop(cid, None)

        await ws_manager.broadcast({"type": "cards_state", "ts": int(time.time() * 1000), "data": states})

    async def _process_card(self, card: Card, open_positions: list[Position]) -> dict:
        rt = self.runtimes.setdefault(card.id, CardRuntime())
        symbol_a = manager.unified_symbol(card.market_a, card.symbol, card.quote)
        symbol_b = manager.unified_symbol(card.market_b, card.symbol, card.quote)

        book_a, book_b = await asyncio.gather(
            manager.get_book_top(card.exchange_a, card.market_a, symbol_a),
            manager.get_book_top(card.exchange_b, card.market_b, symbol_b),
        )

        funding_a = funding_b = {"rate": None, "next_ts": None}
        tasks = {}
        if card.market_a == "futures":
            tasks["a"] = manager.get_funding(card.exchange_a, symbol_a)
        if card.market_b == "futures":
            tasks["b"] = manager.get_funding(card.exchange_b, symbol_b)
        if tasks:
            done = await asyncio.gather(*tasks.values(), return_exceptions=True)
            for key, val in zip(tasks.keys(), done):
                if not isinstance(val, Exception):
                    if key == "a":
                        funding_a = val
                    else:
                        funding_b = val

        spread_ab = spread_ba = None
        if book_a["ask"] and book_b["bid"]:
            spread_ab = (book_b["bid"] - book_a["ask"]) / book_a["ask"] * 100  # лонг A / шорт B
        if book_b["ask"] and book_a["bid"]:
            spread_ba = (book_a["bid"] - book_b["ask"]) / book_b["ask"] * 100  # лонг B / шорт A

        # активное направление
        if card.side_mode == "a_long_b_short":
            direction, spread = "ab", spread_ab
        elif card.side_mode == "a_short_b_long":
            direction, spread = "ba", spread_ba
        else:  # auto
            if spread_ab is not None and (spread_ba is None or spread_ab >= spread_ba):
                direction, spread = "ab", spread_ab
            else:
                direction, spread = "ba", spread_ba

        now = int(time.time() * 1000)
        if spread is not None:
            rt.history.append((now, round(spread, 5)))
            rt.min_spread = spread if rt.min_spread is None else min(rt.min_spread, spread)
            rt.max_spread = spread if rt.max_spread is None else max(rt.max_spread, spread)
        rt.last_error = None

        # PnL открытых позиций
        quotes_by_leg = {
            (card.exchange_a, card.market_a): book_a,
            (card.exchange_b, card.market_b): book_b,
        }
        pos_states = [self._position_state(p, quotes_by_leg) for p in open_positions]

        state = {
            "card_id": card.id,
            "symbol": card.symbol,
            "a": {"exchange": card.exchange_a, "label": EX_LABELS.get(card.exchange_a, card.exchange_a.upper()),
                  "market": card.market_a, "bid": book_a["bid"], "ask": book_a["ask"],
                  "funding_rate": funding_a["rate"], "funding_next_ts": funding_a["next_ts"]},
            "b": {"exchange": card.exchange_b, "label": EX_LABELS.get(card.exchange_b, card.exchange_b.upper()),
                  "market": card.market_b, "bid": book_b["bid"], "ask": book_b["ask"],
                  "funding_rate": funding_b["rate"], "funding_next_ts": funding_b["next_ts"]},
            "spread_ab": round(spread_ab, 5) if spread_ab is not None else None,
            "spread_ba": round(spread_ba, 5) if spread_ba is not None else None,
            "direction": direction,
            "spread": round(spread, 5) if spread is not None else None,
            "min": round(rt.min_spread, 5) if rt.min_spread is not None else None,
            "max": round(rt.max_spread, 5) if rt.max_spread is not None else None,
            "positions": pos_states,
            "signal": False,
            "error": None,
        }

        if card.status == "running" and spread is not None:
            await self._handle_signals(card, state, open_positions, quotes_by_leg)

        self.states[card.id] = state
        return state

    def _position_state(self, position: Position, quotes_by_leg: dict) -> dict:
        legs_out = []
        pnl_total = 0.0
        fees = 0.0
        for leg in position.legs.get("items", []):
            book = quotes_by_leg.get((leg["exchange"], leg["market"])) or {}
            mark = book.get("bid") if leg["role"] == "long" else book.get("ask")
            leg_pnl = None
            if mark:
                leg_pnl = ((mark - leg["entry_price"]) if leg["role"] == "long"
                           else (leg["entry_price"] - mark)) * leg["amount"]
                pnl_total += leg_pnl
            fees += leg.get("fee_usd", 0.0)
            legs_out.append({
                "role": leg["role"], "exchange": leg["exchange"], "market": leg["market"],
                "side": leg["side"], "amount": leg["amount"],
                "entry_price": leg["entry_price"], "mark": mark,
                "pnl_usd": round(leg_pnl, 4) if leg_pnl is not None else None,
            })
        net = pnl_total - fees
        return {
            "id": position.id,
            "mode": position.mode,
            "entry_spread": round(position.entry_spread, 5),
            "notional_usd": position.notional_usd,
            "leverage": position.leverage,
            "opened_at": position.opened_at,
            "pnl_usd": round(net, 4),
            "pnl_pct": round(net / position.notional_usd * 100, 4) if position.notional_usd else 0,
            "legs": legs_out,
        }

    async def _handle_signals(self, card: Card, state: dict,
                              open_positions: list[Position], quotes_by_leg: dict) -> None:
        spread = state["spread"]

        # -------- вход
        can_enter = len(open_positions) < max(1, card.max_orders)
        if can_enter and spread >= card.open_threshold:
            state["signal"] = True
            if card.telegram_signals and notifier.signal_allowed(card.id):
                notifier.mark_signal(card.id)
                await self._send_entry_signal(card, state)
            if card.auto_enter:
                try:
                    quotes = {"a": state["a"], "b": state["b"]}
                    position = await trader.open_position(card, quotes, state["direction"], self.trading_mode)
                    await self._notify_trade_opened(card, position)
                except Exception as e:
                    log.warning("auto-enter failed card %s: %s", card.id, e)

        # -------- выход: спред схлопнулся до close_threshold
        for position in open_positions:
            close_spread = self._position_close_spread(position, quotes_by_leg)
            if close_spread is None:
                continue
            if close_spread <= card.close_threshold and card.auto_enter:
                try:
                    trade = await trader.close_position(position, card, quotes_by_leg)
                    await self._notify_trade_closed(card, trade)
                except Exception as e:
                    log.warning("auto-close failed pos %s: %s", position.id, e)

    @staticmethod
    def _position_close_spread(position: Position, quotes_by_leg: dict) -> float | None:
        legs = position.legs.get("items", [])
        long_leg = next((l for l in legs if l["role"] == "long"), None)
        short_leg = next((l for l in legs if l["role"] == "short"), None)
        if not long_leg or not short_leg:
            return None
        long_book = quotes_by_leg.get((long_leg["exchange"], long_leg["market"])) or {}
        short_book = quotes_by_leg.get((short_leg["exchange"], short_leg["market"])) or {}
        if not long_book.get("bid") or not short_book.get("ask"):
            return None
        # закрытие: продаём лонг по bid, откупаем шорт по ask
        return (short_book["ask"] - long_book["bid"]) / long_book["bid"] * 100

    async def _send_entry_signal(self, card: Card, state: dict) -> None:
        direction = state["direction"]
        long_side = state["a"] if direction == "ab" else state["b"]
        short_side = state["b"] if direction == "ab" else state["a"]
        funding_long = long_side.get("funding_rate")
        funding_short = short_side.get("funding_rate")
        rec = recommend_entry(state["spread"], funding_long, funding_short,
                              card.market_a, card.market_b)

        def fr(x):
            return f"{x * 100:+.4f}%" if x is not None else "—"

        text = (
            f"🔔 <b>СИГНАЛ: {card.symbol}/{card.quote}</b>\n"
            f"Спред: <b>{state['spread']:+.3f}%</b> (порог {card.open_threshold}%)\n\n"
            f"🟢 LONG {long_side['label']} ({'фьюч' if long_side['market'] == 'futures' else 'спот'}) "
            f"по ~{long_side['ask']}\n"
            f"🔴 SHORT {short_side['label']} ({'фьюч' if short_side['market'] == 'futures' else 'спот'}) "
            f"по ~{short_side['bid']}\n\n"
            f"Funding: long {fr(funding_long)} | short {fr(funding_short)} "
            f"(edge {rec['funding_edge_pct']:+.4f}%/8ч)\n\n"
            f"💡 <b>Рекомендация:</b>\n"
            f"• Заход: {rec['margin']}\n"
            f"• Плечо: <b>{rec['leverage']}x</b>\n"
            f"• Размер ноги: {card.size_usd:.0f} USDT"
        )
        await notifier.send(text)

    async def _notify_trade_opened(self, card: Card, position: Position) -> None:
        if not (self._settings.get("telegram") or {}).get("notify_trades", True):
            return
        legs = position.legs.get("items", [])
        lines = [
            f"✅ <b>ОТКРЫТА ПОЗИЦИЯ: {card.symbol}</b> "
            f"({'PAPER' if position.mode == 'paper' else 'LIVE'})",
            f"Спред входа: {position.entry_spread:+.3f}%",
        ]
        for leg in legs:
            emoji = "🟢" if leg["role"] == "long" else "🔴"
            lines.append(f"{emoji} {leg['role'].upper()} {EX_LABELS.get(leg['exchange'], leg['exchange'])} "
                         f"{leg['amount']:.6g} @ {leg['entry_price']}")
        await notifier.send("\n".join(lines))

    async def _notify_trade_closed(self, card: Card, trade) -> None:
        if not (self._settings.get("telegram") or {}).get("notify_trades", True):
            return
        emoji = "🟢" if trade.pnl_usd >= 0 else "🔴"
        await notifier.send(
            f"{emoji} <b>ЗАКРЫТА ПОЗИЦИЯ: {card.symbol}</b>\n"
            f"PnL: <b>{trade.pnl_usd:+.2f} USDT ({trade.pnl_pct:+.3f}%)</b>\n"
            f"Спред: вход {trade.entry_spread:+.3f}% → выход {trade.exit_spread:+.3f}%\n"
            f"Комиссии: {trade.fees_usd:.2f} USDT"
        )

    # ---------------------------------------------------------------- helpers для API

    def get_history(self, card_id: int) -> list[tuple[int, float]]:
        rt = self.runtimes.get(card_id)
        return list(rt.history) if rt else []

    def get_state(self, card_id: int) -> dict | None:
        return self.states.get(card_id)

    def reset_session_stats(self, card_id: int) -> None:
        rt = self.runtimes.get(card_id)
        if rt:
            rt.min_spread = None
            rt.max_spread = None


engine = SpreadEngine()
