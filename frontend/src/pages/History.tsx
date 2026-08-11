import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { exLabel, Trade } from '../types'

function fmtTime(ts: number) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function duration(a: number, b: number) {
  if (!a || !b) return '—'
  const s = Math.floor((b - a) / 1000)
  if (s < 60) return `${s}с`
  if (s < 3600) return `${Math.floor(s / 60)}м ${s % 60}с`
  return `${Math.floor(s / 3600)}ч ${Math.floor((s % 3600) / 60)}м`
}

export default function History() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [symbolFilter, setSymbolFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const toast = useStore((s) => s.toast)

  const load = async () => {
    setLoading(true)
    try {
      const q = symbolFilter ? `&symbol=${symbolFilter}` : ''
      setTrades(await api.get<Trade[]>(`/api/trades?limit=200${q}`))
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [symbolFilter])

  const stats = useMemo(() => {
    const total = trades.reduce((s, t) => s + t.pnl_usd, 0)
    const wins = trades.filter((t) => t.pnl_usd > 0).length
    return {
      total,
      count: trades.length,
      winrate: trades.length ? ((wins / trades.length) * 100).toFixed(0) : '—',
      fees: trades.reduce((s, t) => s + t.fees_usd, 0),
    }
  }, [trades])

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="font-bold text-lg">История сделок</h1>
        <input
          className="input !w-40"
          placeholder="Фильтр: BTC…"
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
        />
        <button onClick={load} className="btn-ghost !py-1">
          ⟳ Обновить
        </button>
        <div className="ml-auto flex gap-2 text-xs">
          <span className="px-2.5 py-1.5 rounded bg-white/5">
            Сделок: <b>{stats.count}</b>
          </span>
          <span className="px-2.5 py-1.5 rounded bg-white/5">
            Winrate: <b>{stats.winrate}%</b>
          </span>
          <span className="px-2.5 py-1.5 rounded bg-white/5">
            Комиссии: <b>{stats.fees.toFixed(2)}$</b>
          </span>
          <span
            className={`px-2.5 py-1.5 rounded font-bold ${
              stats.total >= 0 ? 'bg-term-green/15 text-term-green' : 'bg-term-red/15 text-term-red'
            }`}
          >
            Σ {stats.total >= 0 ? '+' : ''}
            {stats.total.toFixed(2)} USDT
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-term-muted py-16 text-center">Загрузка…</div>
      ) : trades.length === 0 ? (
        <div className="text-term-muted py-16 text-center">Пока нет закрытых сделок</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-term-border">
          <table className="w-full text-sm">
            <thead className="bg-term-panel text-term-muted text-xs">
              <tr>
                {['Закрыта', 'Монета', 'Ноги', 'Спред вход→выход', 'Объём', 'PnL', 'Комиссии', 'Время в сделке', 'Режим'].map(
                  (h) => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-t border-term-border/50 hover:bg-white/[0.03]">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {fmtTime(t.closed_at)}
                  </td>
                  <td className="px-3 py-2 font-bold">{t.symbol}</td>
                  <td className="px-3 py-2 text-xs text-term-muted whitespace-nowrap">
                    {exLabel(t.exchange_a)} ({t.market_a === 'futures' ? 'F' : 'S'}) ↔{' '}
                    {exLabel(t.exchange_b)} ({t.market_b === 'futures' ? 'F' : 'S'})
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {t.entry_spread >= 0 ? '+' : ''}
                    {t.entry_spread.toFixed(3)}% → {t.exit_spread >= 0 ? '+' : ''}
                    {t.exit_spread.toFixed(3)}%
                  </td>
                  <td className="px-3 py-2 font-mono">{t.notional_usd.toFixed(0)}$</td>
                  <td
                    className={`px-3 py-2 font-mono font-bold ${
                      t.pnl_usd >= 0 ? 'text-term-green' : 'text-term-red'
                    }`}
                  >
                    {t.pnl_usd >= 0 ? '+' : ''}
                    {t.pnl_usd.toFixed(2)}$ ({t.pnl_pct >= 0 ? '+' : ''}
                    {t.pnl_pct.toFixed(2)}%)
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{t.fees_usd.toFixed(2)}$</td>
                  <td className="px-3 py-2 text-xs">{duration(t.opened_at, t.closed_at)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        t.mode === 'live'
                          ? 'bg-term-red/15 text-term-red'
                          : 'bg-yellow-500/15 text-yellow-400'
                      }`}
                    >
                      {t.mode.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
