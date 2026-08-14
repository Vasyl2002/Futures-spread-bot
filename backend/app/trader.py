"""Открытие и закрытие спред-позиций.

Обе ноги исполняются одновременно (asyncio.gather). В режиме paper сделки
симулируются по текущим ценам стакана — можно тестировать без API-ключей.
"""

import asyncio
import logging

from sqlalchemy import select

from .database import SessionLocal
from .exchange_manager import manager
from .models import Card, Position, Trade, now_ms

log = logging.getLogger("trader")


class TradeError(Exception):
    pass


async def open_position(card: Card, quotes: dict, direction: str, mode: str) -> Position:
    """Открыть спред-позицию: long-нога покупается, short-нога продаётся.

    direction: 'ab' — лонг A / шорт B, 'ba' — лонг B / шорт A.
    quotes: {'a': {bid, ask}, 'b': {bid, ask}}
    """
    if direction == "ab":
        long_leg = ("a", card.exchange_a, card.market_a)
        short_leg = ("b", card.exchange_b, card.market_b)
    else:
        long_leg = ("b", card.exchange_b, card.market_b)
        short_leg = ("a", card.exchange_a, card.market_a)

    long_key, long_ex, long_mkt = long_leg
    short_key, short_ex, short_mkt = short_leg
    long_symbol = manager.unified_symbol(long_mkt, card.symbol, card.quote)
    short_symbol = manager.unified_symbol(short_mkt, card.symbol, card.quote)

    long_price = quotes[long_key]["ask"]
    short_price = quotes[short_key]["bid"]
    if not long_price or not short_price:
        raise TradeError("Нет цен в стакане, попробуйте ещё раз")
    if short_mkt == "spot":
        raise TradeError("Шорт-нога не может быть спотом (нечего продавать) — поменяйте направление")

    amount_long = card.size_usd / long_price
    amount_short = card.size_usd / short_price
    entry_spread = (short_price - long_price) / long_price * 100

    legs = [
        {"role": "long", "exchange": long_ex, "market": long_mkt, "symbol": long_symbol,
         "side": "buy", "amount": amount_long, "entry_price": long_price, "order_id": None,
         "fee_usd": card.size_usd * manager.taker_fee_pct(long_ex, long_mkt) / 100},
        {"role": "short", "exchange": short_ex, "market": short_mkt, "symbol": short_symbol,
         "side": "sell", "amount": amount_short, "entry_price": short_price, "order_id": None,
         "fee_usd": card.size_usd * manager.taker_fee_pct(short_ex, short_mkt) / 100},
    ]

    if mode == "live":
        for leg in legs:
            if not manager.has_keys(leg["exchange"]):
                raise TradeError(f"Нет API-ключей для {leg['exchange']}")
        # выставляем плечо на фьючерсных ногах
        for leg in legs:
            if leg["market"] == "futures":
                await manager.set_leverage(leg["exchange"], leg["symbol"], card.leverage)

        results = await asyncio.gather(
            *[
                manager.create_market_order(leg["exchange"], leg["market"], leg["symbol"],
                                            leg["side"], leg["amount"])
                for leg in legs
            ],
            return_exceptions=True,
        )
        errors = [r for r in results if isinstance(r, Exception)]
        if errors:
            # одна нога могла исполниться — сразу закрываем её, чтобы не остаться с голой позицией
            for leg, r in zip(legs, results):
                if not isinstance(r, Exception):
                    try:
                        await manager.create_market_order(
                            leg["exchange"], leg["market"], leg["symbol"],
                            "sell" if leg["side"] == "buy" else "buy",
                            r.get("filled") or leg["amount"], reduce_only=True)
                    except Exception as e:
                        log.error("emergency close failed: %s", e)
            raise TradeError(f"Ошибка исполнения: {errors[0]}")
        for leg, order in zip(legs, results):
            leg["order_id"] = order.get("id")
            if order.get("average"):
                leg["entry_price"] = order["average"]
            if order.get("fee") and order["fee"].get("cost"):
                leg["fee_usd"] = float(order["fee"]["cost"])

    position = Position(
        card_id=card.id, status="open", mode=mode,
        entry_spread=entry_spread, legs={"items": legs},
        notional_usd=card.size_usd, leverage=card.leverage,
    )
    async with SessionLocal() as session:
        session.add(position)
        await session.commit()
        await session.refresh(position)
    log.info("opened position %s for card %s spread=%.3f%%", position.id, card.id, entry_spread)
    return position


async def close_position(position: Position, card: Card, quotes_by_leg: dict) -> Trade:
    """Закрыть обе ноги позиции одновременно одной операцией."""
    legs = position.legs.get("items", [])
    exit_info = []
    for leg in legs:
        book = quotes_by_leg.get((leg["exchange"], leg["market"]))
        if not book:
            raise TradeError("Нет актуальных котировок для закрытия")
        exit_price = book["bid"] if leg["role"] == "long" else book["ask"]
        if not exit_price:
            raise TradeError("Пустой стакан, попробуйте ещё раз")
        exit_info.append(exit_price)

    if position.mode == "live":
        results = await asyncio.gather(
            *[
                manager.create_market_order(
                    leg["exchange"], leg["market"], leg["symbol"],
                    "sell" if leg["role"] == "long" else "buy",
                    leg["amount"], reduce_only=leg["market"] == "futures")
                for leg in legs
            ],
            return_exceptions=True,
        )
        errors = [r for r in results if isinstance(r, Exception)]
        if errors:
            raise TradeError(f"Ошибка закрытия: {errors[0]} — проверьте позиции на биржах!")
        for i, (leg, order) in enumerate(zip(legs, results)):
            if order.get("average"):
                exit_info[i] = order["average"]

    # PnL по ногам
    pnl_usd = 0.0
    fees = 0.0
    closed_legs = []
    for leg, exit_price in zip(legs, exit_info):
        entry, amount = leg["entry_price"], leg["amount"]
        leg_pnl = (exit_price - entry) * amount if leg["role"] == "long" else (entry - exit_price) * amount
        exit_fee = (amount * exit_price) * manager.taker_fee_pct(leg["exchange"], leg["market"]) / 100
        fees += leg.get("fee_usd", 0.0) + exit_fee
        pnl_usd += leg_pnl
        closed_legs.append({**leg, "exit_price": exit_price, "pnl_usd": round(leg_pnl, 4)})

    net_pnl = pnl_usd - fees
    long_leg = next(l for l in closed_legs if l["role"] == "long")
    short_leg = next(l for l in closed_legs if l["role"] == "short")
    exit_spread = (short_leg["exit_price"] - long_leg["exit_price"]) / long_leg["exit_price"] * 100

    trade = Trade(
        card_id=card.id, symbol=card.symbol, mode=position.mode,
        exchange_a=card.exchange_a, market_a=card.market_a,
        exchange_b=card.exchange_b, market_b=card.market_b,
        entry_spread=position.entry_spread, exit_spread=exit_spread,
        notional_usd=position.notional_usd,
        pnl_usd=round(net_pnl, 4),
        pnl_pct=round(net_pnl / position.notional_usd * 100, 4) if position.notional_usd else 0,
        fees_usd=round(fees, 4),
        legs={"items": closed_legs},
        opened_at=position.opened_at, closed_at=now_ms(),
    )
    async with SessionLocal() as session:
        db_pos = (await session.execute(select(Position).where(Position.id == position.id))).scalar_one()
        db_pos.status = "closed"
        session.add(trade)
        await session.commit()
        await session.refresh(trade)
    log.info("closed position %s pnl=%.4f USDT", position.id, net_pnl)
    return trade
