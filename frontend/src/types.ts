export type Exchange = 'binance' | 'bitget' | 'kucoin' | 'gateio'
export type MarketType = 'spot' | 'futures'

export interface Card {
  id: number
  symbol: string
  quote: string
  exchange_a: Exchange
  market_a: MarketType
  exchange_b: Exchange
  market_b: MarketType
  side_mode: 'auto' | 'a_long_b_short' | 'a_short_b_long'
  open_threshold: number
  close_threshold: number
  size_usd: number
  orders_count: number
  max_orders: number
  leverage: number
  status: 'stopped' | 'running'
  auto_enter: boolean
  favorite: boolean
  archived: boolean
  telegram_signals: boolean
  tags: string
  sort_order: number
  created_at: number
}

export interface LegState {
  exchange: string
  label: string
  market: MarketType
  bid: number | null
  ask: number | null
  funding_rate: number | null
  funding_next_ts: number | null
}

export interface PositionLeg {
  role: 'long' | 'short'
  exchange: string
  market: MarketType
  side: string
  amount: number
  entry_price: number
  mark: number | null
  pnl_usd: number | null
}

export interface PositionState {
  id: number
  mode: 'paper' | 'live'
  entry_spread: number
  notional_usd: number
  leverage: number
  opened_at: number
  pnl_usd: number
  pnl_pct: number
  legs: PositionLeg[]
}

export interface CardState {
  card_id: number
  symbol?: string
  a?: LegState
  b?: LegState
  spread_ab?: number | null
  spread_ba?: number | null
  direction?: 'ab' | 'ba'
  spread?: number | null
  min?: number | null
  max?: number | null
  positions?: PositionState[]
  signal?: boolean
  error?: string | null
}

export interface Trade {
  id: number
  card_id: number
  symbol: string
  mode: string
  exchange_a: string
  market_a: string
  exchange_b: string
  market_b: string
  entry_spread: number
  exit_spread: number
  notional_usd: number
  pnl_usd: number
  pnl_pct: number
  fees_usd: number
  legs: { items: any[] }
  opened_at: number
  closed_at: number
}

export const EXCHANGES: { id: Exchange; label: string }[] = [
  { id: 'binance', label: 'BINANCE' },
  { id: 'bitget', label: 'BITGET' },
  { id: 'kucoin', label: 'KUCOIN' },
  { id: 'gateio', label: 'GATE.IO' },
]

export const exLabel = (id: string) =>
  EXCHANGES.find((e) => e.id === id)?.label ?? id.toUpperCase()
