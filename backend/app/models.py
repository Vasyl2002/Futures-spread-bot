import time

from sqlalchemy import JSON, Boolean, Float, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now_ms() -> int:
    return int(time.time() * 1000)


class Base(DeclarativeBase):
    pass


class Card(Base):
    """Спред-карточка: пара «нога A / нога B» на двух биржах."""

    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(32))  # базовая монета, например BTC
    quote: Mapped[str] = mapped_column(String(16), default="USDT")

    exchange_a: Mapped[str] = mapped_column(String(32))  # binance | bitget | kucoin | gateio
    market_a: Mapped[str] = mapped_column(String(16), default="futures")  # spot | futures
    exchange_b: Mapped[str] = mapped_column(String(32))
    market_b: Mapped[str] = mapped_column(String(16), default="futures")

    # a_long_b_short: покупаем на A, продаём на B; auto — движок сам выбирает выгодное направление
    side_mode: Mapped[str] = mapped_column(String(24), default="auto")
    open_threshold: Mapped[float] = mapped_column(Float, default=0.4)   # % спреда для входа
    close_threshold: Mapped[float] = mapped_column(Float, default=0.0)  # % спреда для выхода

    size_usd: Mapped[float] = mapped_column(Float, default=100.0)  # размер одной ноги в USDT
    orders_count: Mapped[int] = mapped_column(Integer, default=1)  # на сколько ордеров дробить вход
    max_orders: Mapped[int] = mapped_column(Integer, default=1)    # лимит одновременных входов
    leverage: Mapped[int] = mapped_column(Integer, default=3)

    status: Mapped[str] = mapped_column(String(16), default="stopped")  # stopped | running
    auto_enter: Mapped[bool] = mapped_column(Boolean, default=False)    # автоторговля по сигналу
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[str] = mapped_column(String(255), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    telegram_signals: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[int] = mapped_column(Integer, default=now_ms)


class Position(Base):
    """Открытая спред-позиция (две ноги)."""

    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_id: Mapped[int] = mapped_column(Integer, index=True)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | closed
    mode: Mapped[str] = mapped_column(String(16), default="paper")   # paper | live

    entry_spread: Mapped[float] = mapped_column(Float, default=0.0)
    opened_at: Mapped[int] = mapped_column(Integer, default=now_ms)

    # legs: [{exchange, market, symbol, side, amount, entry_price, order_id, fee_usd}]
    legs: Mapped[dict] = mapped_column(JSON, default=dict)
    notional_usd: Mapped[float] = mapped_column(Float, default=0.0)
    leverage: Mapped[int] = mapped_column(Integer, default=1)


class Trade(Base):
    """История закрытых спред-сделок."""

    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_id: Mapped[int] = mapped_column(Integer, index=True)
    symbol: Mapped[str] = mapped_column(String(32))
    mode: Mapped[str] = mapped_column(String(16), default="paper")

    exchange_a: Mapped[str] = mapped_column(String(32))
    market_a: Mapped[str] = mapped_column(String(16))
    exchange_b: Mapped[str] = mapped_column(String(32))
    market_b: Mapped[str] = mapped_column(String(16))

    entry_spread: Mapped[float] = mapped_column(Float, default=0.0)
    exit_spread: Mapped[float] = mapped_column(Float, default=0.0)
    notional_usd: Mapped[float] = mapped_column(Float, default=0.0)
    pnl_usd: Mapped[float] = mapped_column(Float, default=0.0)
    pnl_pct: Mapped[float] = mapped_column(Float, default=0.0)
    fees_usd: Mapped[float] = mapped_column(Float, default=0.0)

    legs: Mapped[dict] = mapped_column(JSON, default=dict)
    opened_at: Mapped[int] = mapped_column(Integer, default=0)
    closed_at: Mapped[int] = mapped_column(Integer, default=now_ms)


class KV(Base):
    """Настройки приложения (ключи бирж, прокси, telegram и т.д.)."""

    __tablename__ = "kv"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
