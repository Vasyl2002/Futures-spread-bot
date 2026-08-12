import asyncio

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import desc, select

from . import auth, schemas, trader
from .database import SessionLocal
from .exchange_manager import manager
from .models import Card, Position, Trade
from .settings_store import (EXCHANGES, load_settings, mask_secrets,
                             save_settings, unmask_patch)
from .spread_engine import engine
from .telegram_bot import notifier
from .ws_manager import ws_manager

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------- auth

class LoginRequest(BaseModel):
    password: str


@router.get("/auth-info")
async def auth_info():
    return {"required": auth.required()}


@router.post("/login")
async def login(payload: LoginRequest):
    if not auth.required():
        return {"token": None}
    if not auth.check_password(payload.password):
        raise HTTPException(401, "Неверный пароль")
    return {"token": auth.make_token()}


def card_to_dict(card: Card) -> dict:
    return {c.name: getattr(card, c.name) for c in Card.__table__.columns}


async def _get_card(card_id: int) -> Card:
    async with SessionLocal() as session:
        card = (await session.execute(select(Card).where(Card.id == card_id))).scalar_one_or_none()
    if card is None:
        raise HTTPException(404, "Карточка не найдена")
    return card


# ---------------------------------------------------------------------- cards

@router.get("/cards")
async def list_cards():
    async with SessionLocal() as session:
        cards = list((await session.execute(
            select(Card).order_by(Card.sort_order, Card.id)
        )).scalars())
    return [card_to_dict(c) for c in cards]


@router.post("/cards")
async def create_card(payload: schemas.CardCreate):
    if payload.exchange_a not in EXCHANGES or payload.exchange_b not in EXCHANGES:
        raise HTTPException(400, "Неизвестная биржа")
    if payload.exchange_a == payload.exchange_b and payload.market_a == payload.market_b:
        raise HTTPException(400, "Ноги карточки должны отличаться (биржа или тип рынка)")
    card = Card(**payload.model_dump())
    card.symbol = card.symbol.upper()
    async with SessionLocal() as session:
        session.add(card)
        await session.commit()
        await session.refresh(card)
    return card_to_dict(card)


@router.patch("/cards/{card_id}")
async def update_card(card_id: int, payload: schemas.CardUpdate):
    async with SessionLocal() as session:
        card = (await session.execute(select(Card).where(Card.id == card_id))).scalar_one_or_none()
        if card is None:
            raise HTTPException(404, "Карточка не найдена")
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(card, field, value)
        if payload.symbol:
            card.symbol = card.symbol.upper()
        await session.commit()
        await session.refresh(card)
    return card_to_dict(card)


@router.delete("/cards/{card_id}")
async def delete_card(card_id: int):
    async with SessionLocal() as session:
        card = (await session.execute(select(Card).where(Card.id == card_id))).scalar_one_or_none()
        if card is None:
            raise HTTPException(404, "Карточка не найдена")
        open_pos = (await session.execute(
            select(Position).where(Position.card_id == card_id, Position.status == "open")
        )).scalars().first()
        if open_pos:
            raise HTTPException(400, "Сначала закройте открытые позиции карточки")
        await session.delete(card)
        await session.commit()
    return {"ok": True}


@router.post("/cards/{card_id}/copy")
async def copy_card(card_id: int):
    src = await _get_card(card_id)
    data = card_to_dict(src)
    for drop in ("id", "created_at", "status", "favorite", "archived"):
        data.pop(drop, None)
    card = Card(**data)
    async with SessionLocal() as session:
        session.add(card)
        await session.commit()
        await session.refresh(card)
    return card_to_dict(card)


@router.get("/cards/{card_id}/history")
async def card_history(card_id: int):
    return {"card_id": card_id, "series": engine.get_history(card_id)}


@router.post("/cards/{card_id}/reset-stats")
async def reset_stats(card_id: int):
    engine.reset_session_stats(card_id)
    return {"ok": True}


# ---------------------------------------------------------------------- trading

@router.post("/cards/{card_id}/enter")
async def enter_trade(card_id: int, direction: str | None = None):
    """Открыть спред-позицию прямо из веб-приложения."""
    card = await _get_card(card_id)
    state = engine.get_state(card_id)
    if not state or state.get("spread") is None:
        raise HTTPException(409, "Нет актуальных котировок — подождите пару секунд")
    async with SessionLocal() as session:
        open_count = len(list((await session.execute(
            select(Position).where(Position.card_id == card_id, Position.status == "open")
        )).scalars()))
    if open_count >= max(1, card.max_orders):
        raise HTTPException(409, f"Достигнут лимит позиций ({card.max_orders})")

    use_direction = direction or state["direction"]
    settings = await load_settings()
    try:
        position = await trader.open_position(
            card, {"a": state["a"], "b": state["b"]}, use_direction,
            settings.get("trading_mode", "paper"))
    except trader.TradeError as e:
        raise HTTPException(400, str(e))
    await engine._notify_trade_opened(card, position)
    return {"ok": True, "position_id": position.id}


@router.post("/positions/{position_id}/close")
async def close_trade(position_id: int):
    """Закрыть обе ноги позиции одной кнопкой."""
    async with SessionLocal() as session:
        position = (await session.execute(
            select(Position).where(Position.id == position_id, Position.status == "open")
        )).scalar_one_or_none()
    if position is None:
        raise HTTPException(404, "Открытая позиция не найдена")
    card = await _get_card(position.card_id)

    # свежие котировки обеих ног
    quotes_by_leg = {}
    for leg in position.legs.get("items", []):
        key = (leg["exchange"], leg["market"])
        if key not in quotes_by_leg:
            quotes_by_leg[key] = await manager.get_book_top(leg["exchange"], leg["market"], leg["symbol"])
    try:
        trade = await trader.close_position(position, card, quotes_by_leg)
    except trader.TradeError as e:
        raise HTTPException(400, str(e))
    await engine._notify_trade_closed(card, trade)
    return {"ok": True, "trade_id": trade.id, "pnl_usd": trade.pnl_usd}


@router.get("/positions")
async def list_positions():
    async with SessionLocal() as session:
        positions = list((await session.execute(
            select(Position).where(Position.status == "open").order_by(desc(Position.opened_at))
        )).scalars())
    return [{c.name: getattr(p, c.name) for c in Position.__table__.columns} for p in positions]


# ---------------------------------------------------------------------- history

@router.get("/trades")
async def list_trades(limit: int = 100, offset: int = 0, symbol: str | None = None):
    async with SessionLocal() as session:
        q = select(Trade).order_by(desc(Trade.closed_at)).limit(limit).offset(offset)
        if symbol:
            q = q.where(Trade.symbol == symbol.upper())
        trades = list((await session.execute(q)).scalars())
    return [{c.name: getattr(t, c.name) for c in Trade.__table__.columns} for t in trades]


# ---------------------------------------------------------------------- market data

@router.get("/symbols")
async def list_symbols(exchange: str, market: str = "futures", quote: str = "USDT"):
    if exchange not in EXCHANGES:
        raise HTTPException(400, "Неизвестная биржа")
    try:
        return {"symbols": await manager.list_symbols(exchange, market, quote)}
    except Exception as e:
        raise HTTPException(502, f"Не удалось получить список пар: {e}")


@router.get("/klines")
async def klines(exchange: str, market: str, symbol: str, quote: str = "USDT",
                 timeframe: str = "5m", limit: int = 200):
    unified = manager.unified_symbol(market, symbol.upper(), quote)
    try:
        data = await manager.get_ohlcv(exchange, market, unified, timeframe, limit)
    except Exception as e:
        raise HTTPException(502, f"Не удалось получить свечи: {e}")
    return {"candles": data}


@router.get("/balances")
async def balances():
    results = await asyncio.gather(*[manager.fetch_balances(ex) for ex in EXCHANGES])
    return dict(zip(EXCHANGES, results))


# ---------------------------------------------------------------------- settings

@router.get("/settings")
async def get_settings():
    return mask_secrets(await load_settings())


@router.put("/settings")
async def put_settings(patch: dict):
    current = await load_settings()
    cleaned = unmask_patch(patch, current)
    merged = await save_settings(cleaned)
    # переконфигурируем компоненты на лету
    manager.configure(merged)
    await manager.reset()
    notifier.configure(merged)
    engine.configure(merged)
    return mask_secrets(merged)


@router.post("/telegram/test")
async def telegram_test():
    settings = await load_settings()
    notifier.configure(settings)
    if not notifier.enabled:
        raise HTTPException(400, "Заполните token и chat_id и включите Telegram")
    ok = await notifier.send("✅ SpreadDesk: тестовое сообщение. Связь работает!")
    if not ok:
        raise HTTPException(502, "Telegram не принял сообщение — проверьте token/chat_id")
    return {"ok": True}


# ---------------------------------------------------------------------- websocket

@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    if not auth.check_token(ws.query_params.get("token")):
        await ws.close(code=4401)
        return
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # ping от клиента
    except WebSocketDisconnect:
        await ws_manager.disconnect(ws)
    except Exception:
        await ws_manager.disconnect(ws)
