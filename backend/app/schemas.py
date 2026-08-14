from pydantic import BaseModel, Field


class CardCreate(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    quote: str = "USDT"
    exchange_a: str
    market_a: str = "futures"
    exchange_b: str
    market_b: str = "futures"
    side_mode: str = "auto"
    open_threshold: float = 0.4
    close_threshold: float = 0.0
    size_usd: float = 100.0
    orders_count: int = 1
    max_orders: int = 1
    leverage: int = 3
    auto_enter: bool = False
    telegram_signals: bool = True
    tags: str = ""


class CardUpdate(BaseModel):
    symbol: str | None = None
    quote: str | None = None
    exchange_a: str | None = None
    market_a: str | None = None
    exchange_b: str | None = None
    market_b: str | None = None
    side_mode: str | None = None
    open_threshold: float | None = None
    close_threshold: float | None = None
    size_usd: float | None = None
    orders_count: int | None = None
    max_orders: int | None = None
    leverage: int | None = None
    status: str | None = None
    auto_enter: bool | None = None
    favorite: bool | None = None
    archived: bool | None = None
    telegram_signals: bool | None = None
    tags: str | None = None
    sort_order: int | None = None


class SettingsPatch(BaseModel):
    model_config = {"extra": "allow"}
