import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { Trade } from '../types'
import { exLabel } from '../types'

function fmtDate(ms: number) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('ru-RU', {
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
  if (s < 3600) return `${Math.floor(s / 60)}м`
  return `${Math.floor(s / 3600)}ч ${Math.floor((s % 3600) / 60)}м`
}

export default function History() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [symbolFilter, setSymbolFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const q = symbolFilter ? `&symbol=${symbolFilter}` : ''
      setTrades(await api.get<Trade[]>(`/api/trades?limit=200${q}`))
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
      winRate: trades.length ? ((wins / trades.length) * 100).toFixed(0) : '—',
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
        <button onClick={load} className="btn-ghost !py-1 text-xs">
          ⟳ Обновить
        </button>
        <div className="ml-auto flex gap-2 text-xs">
          <span className="px-2.5 py-1 rounded bg-white/5 text-term-muted">
            Сделок: <b className="text-slate-200">{stats.count}</b>
          </span>
          <span className="px-2.5 py-1 rounded bg-white/5 text-term-muted">
            Winrate: <b className="text-slate-200">{stats.winRate}%</b>
          </span>
          <span className="px-2.5 py-1 rounded bg-white/5 text-term-muted">
            Комиссии: <b className="text-slate-200">{stats.fees.toFixed(2)}$</b>
          </span>
          <span
            className={`px-2.5 py-1 rounded font-bold ${
              stats.total >= 0 ? 'bg-term-green/15 text-term-green' : 'bg-term-red/15 text-term-red'
            }`}
          >
            Σ {stats.total >= 0 ? '+' : ''}
            {stats.total.toFixed(2)} USDT
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-term-muted">Загрузка…</div>
      ) : trades.length === 0 ? (
        <div className="text-center py-16 text-term-muted">Сделок пока нет</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-term-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-term-panel text-term-muted text-xs text-left">
                <th className="px-3 py-2">Монета</th>
                <th className="px-3 py-2">Ноги</th>
                <th className="px-3 py-2 text-right">Спред вход</th>
                <th className="px-3 py-2 text-right">Спред выход</th>
                <th className="px-3 py-2 text-right">Объём</th>
                <th className="px-3 py-2 text-right">PnL</th>
                <th className="px-3 py-2 text-right">Комиссии</th>
                <th className="px-3 py-2">Открыта</th>
                <th className="px-3 py-2">Длительность</th>
                <th className="px-3 py-2">Режим</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-t border-term-border/50 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-bold">{t.symbol}</td>
                  <td className="px-3 py-2 text-xs text-term-muted">
                    {exLabel(t.exchange_a)} ({t.market_a === 'futures' ? 'F' : 'S'}) ↔{' '}
                    {exLabel(t.exchange_b)} ({t.market_b === 'futures' ? 'F' : 'S'})
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {t.entry_spread >= 0 ? '+' : ''}
                    {t.entry_spread.toFixed(3)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {t.exit_spread >= 0 ? '+' : ''}
                    {t.exit_spread.toFixed(3)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{t.notional_usd.toFixed(0)}$</td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-bold ${
                      t.pnl_usd >= 0 ? 'text-term-green' : 'text-term-red'
                    }`}
                  >
                    {t.pnl_usd >= 0 ? '+' : ''}
                    {t.pnl_usd.toFixed(2)}$ ({t.pnl_pct >= 0 ? '+' : ''}
                    {t.pnl_pct.toFixed(2)}%)
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-term-muted">
                    {t.fees_usd.toFixed(2)}$
                  </td>
                  <td className="px-3 py-2 text-xs text-term-muted">{fmtDate(t.opened_at)}</td>
                  <td className="px-3 py-2 text-xs text-term-muted">
                    {duration(t.opened_at, t.closed_at)}
                  </td>
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
