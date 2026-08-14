import { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import type { Card, CardState, LegState, PositionState } from '../types'
import ChartModal from './ChartModal'

function fmtPct(v: number | null | undefined, digits = 3) {
  if (v === null || v === undefined) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}

function fmtPrice(v: number | null | undefined) {
  if (!v) return '—'
  if (v >= 1000) return v.toFixed(2)
  if (v >= 1) return v.toFixed(4)
  return v.toPrecision(5)
}

function fundingCountdown(ts: number | null | undefined) {
  if (!ts) return '—'
  const diff = ts - Date.now()
  if (diff <= 0) return '00:00'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function NumInput({
  value,
  onCommit,
  step = 0.1,
  className = '',
}: {
  value: number
  onCommit: (v: number) => void
  step?: number
  className?: string
}) {
  const [local, setLocal] = useState<string | null>(null)
  return (
    <input
      type="number"
      step={step}
      className={`input font-mono ${className}`}
      value={local ?? value}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== null && local !== '' && Number(local) !== value) onCommit(Number(local))
        setLocal(null)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function LegColumn({ leg, role }: { leg?: LegState; role: 'long' | 'short' | null }) {
  if (!leg) return <div className="flex-1 text-term-muted text-xs">нет данных</div>
  const fr = leg.funding_rate
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-bold text-xs truncate">{leg.label}</span>
        <span className="text-[9px] px-1 rounded bg-white/10 text-term-muted">
          {leg.market === 'futures' ? 'FUT' : 'SPOT'}
        </span>
        {role && (
          <span
            className={`text-[9px] font-bold px-1 rounded ${
              role === 'long' ? 'bg-term-green/20 text-term-green' : 'bg-term-red/20 text-term-red'
            }`}
          >
            {role.toUpperCase()}
          </span>
        )}
      </div>
      <table className="w-full text-[11px] leading-5">
        <tbody>
          <tr>
            <td className="text-term-muted">Funding</td>
            <td
              className={`text-right font-mono ${
                fr == null ? 'text-term-muted' : fr >= 0 ? 'text-term-green' : 'text-term-red'
              }`}
            >
              {fr == null ? '—' : `${(fr * 100).toFixed(4)}%`}
            </td>
          </tr>
          <tr>
            <td className="text-term-muted">Next</td>
            <td className="text-right font-mono text-slate-300">
              {fundingCountdown(leg.funding_next_ts)}
            </td>
          </tr>
          <tr>
            <td className="text-term-muted">Bid</td>
            <td className="text-right font-mono">{fmtPrice(leg.bid)}</td>
          </tr>
          <tr>
            <td className="text-term-muted">Ask</td>
            <td className="text-right font-mono">{fmtPrice(leg.ask)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function PositionRow({ pos, onClosed }: { pos: PositionState; onClosed: () => void }) {
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const closeBoth = async () => {
    if (!confirm('Закрыть обе ноги позиции по маркету?')) return
    setBusy(true)
    try {
      const r = await api.post<{ pnl_usd: number }>(`/api/positions/${pos.id}/close`)
      toast(`Позиция закрыта, PnL ${r.pnl_usd >= 0 ? '+' : ''}${r.pnl_usd.toFixed(2)} USDT`)
      onClosed()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  const pnlColor = pos.pnl_usd >= 0 ? 'text-term-green' : 'text-term-red'
  return (
    <div className="bg-black/25 rounded-md p-2 border border-term-border/60">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-term-muted">
          #{pos.id} · вход {fmtPct(pos.entry_spread)} · {pos.leverage}x ·{' '}
          {pos.mode === 'paper' ? 'PAPER' : 'LIVE'}
        </span>
        <span className={`font-mono font-bold text-sm ${pnlColor}`}>
          {pos.pnl_usd >= 0 ? '+' : ''}
          {pos.pnl_usd.toFixed(2)}$ ({fmtPct(pos.pnl_pct, 2)})
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[10px] mb-1.5">
        {pos.legs.map((l, i) => (
          <div key={i} className="flex items-center gap-1">
            <span
              className={`font-bold ${l.role === 'long' ? 'text-term-green' : 'text-term-red'}`}
            >
              {l.role === 'long' ? '▲' : '▼'}
            </span>
            <span className="text-term-muted truncate">
              {l.exchange.toUpperCase()} {fmtPrice(l.entry_price)} → {fmtPrice(l.mark)}
            </span>
            <span
              className={`ml-auto font-mono ${
                (l.pnl_usd ?? 0) >= 0 ? 'text-term-green' : 'text-term-red'
              }`}
            >
              {l.pnl_usd == null ? '—' : `${l.pnl_usd >= 0 ? '+' : ''}${l.pnl_usd.toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>
      <button onClick={closeBoth} disabled={busy} className="btn-red w-full !py-1 text-xs">
        {busy ? 'Закрываю…' : '✕ Закрыть обе позы'}
      </button>
    </div>
  )
}

export default function SpreadCard({ card, onEdit }: { card: Card; onEdit: () => void }) {
  const { states, patchCard, loadCards, toast } = useStore()
  const state: CardState | undefined = states[card.id]
  const [showChart, setShowChart] = useState(false)
  const [entering, setEntering] = useState(false)

  const spread = state?.spread ?? null
  const positions = state?.positions ?? []
  const inTrade = positions.length > 0
  const signal = state?.signal ?? false
  const running = card.status === 'running'

  const direction = state?.direction ?? 'ab'
  const roleA = direction === 'ab' ? 'long' : 'short'
  const roleB = direction === 'ab' ? 'short' : 'long'

  const toggleRun = () => patchCard(card.id, { status: running ? 'stopped' : 'running' })

  const copy = async () => {
    await api.post(`/api/cards/${card.id}/copy`)
    await loadCards()
    toast('Карточка скопирована')
  }

  const enter = async () => {
    setEntering(true)
    try {
      await api.post(`/api/cards/${card.id}/enter`)
      toast(`Вход выполнен: ${card.symbol}`)
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setEntering(false)
    }
  }

  const spreadColor =
    spread == null
      ? 'text-term-muted'
      : spread >= card.open_threshold
        ? 'text-term-green'
        : spread >= 0
          ? 'text-emerald-200'
          : 'text-term-red'

  return (
    <div
      className={`bg-term-card rounded-xl border p-3 flex flex-col gap-2.5 transition-shadow ${
        signal
          ? 'border-term-green shadow-[0_0_18px_rgba(22,199,132,0.25)]'
          : inTrade
            ? 'border-term-accent/60'
            : 'border-term-border'
      }`}
    >
      {/* header */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            running ? 'bg-term-green animate-pulse' : 'bg-slate-600'
          }`}
        />
        <span className="font-bold text-base">{card.symbol}</span>
        <button
          onClick={() => patchCard(card.id, { favorite: !card.favorite })}
          className={card.favorite ? 'text-yellow-400' : 'text-slate-600 hover:text-slate-400'}
          title="Избранное"
        >
          ★
        </button>
        <button onClick={onEdit} className="text-slate-500 hover:text-slate-300" title="Изменить">
          ✎
        </button>
        <div className="ml-auto flex items-center gap-1 text-[11px] font-bold">
          <span className={roleA === 'long' ? 'text-term-green' : 'text-term-red'}>
            {state?.a?.label ?? card.exchange_a.toUpperCase()} {roleA === 'long' ? '↑' : '↓'}
          </span>
          <span className="text-term-muted">·</span>
          <span className={roleB === 'long' ? 'text-term-green' : 'text-term-red'}>
            {state?.b?.label ?? card.exchange_b.toUpperCase()} {roleB === 'long' ? '↑' : '↓'}
          </span>
        </div>
      </div>

      {state?.error && (
        <div className="text-[11px] text-term-red bg-term-red/10 rounded px-2 py-1 break-words">
          ⚠ {state.error}
        </div>
      )}

      {/* side + auto */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-term-muted">Side:</span>
        <select
          className="input !w-auto !py-0.5 text-xs"
          value={card.side_mode}
          onChange={(e) => patchCard(card.id, { side_mode: e.target.value as Card['side_mode'] })}
        >
          <option value="auto">AUTO</option>
          <option value="a_long_b_short">LONG A / SHORT B</option>
          <option value="a_short_b_long">SHORT A / LONG B</option>
        </select>
        <label className="flex items-center gap-1.5 ml-auto text-term-muted cursor-pointer">
          <input
            type="checkbox"
            checked={card.auto_enter}
            onChange={(e) => patchCard(card.id, { auto_enter: e.target.checked })}
            className="accent-blue-500"
          />
          авто-вход
        </label>
      </div>

      {/* thresholds & size */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div>
          <div className="text-term-muted mb-0.5">Open %</div>
          <NumInput value={card.open_threshold} onCommit={(v) => patchCard(card.id, { open_threshold: v })} />
        </div>
        <div>
          <div className="text-term-muted mb-0.5">Close %</div>
          <NumInput value={card.close_threshold} onCommit={(v) => patchCard(card.id, { close_threshold: v })} />
        </div>
        <div>
          <div className="text-term-muted mb-0.5">Size $</div>
          <NumInput value={card.size_usd} step={10} onCommit={(v) => patchCard(card.id, { size_usd: v })} />
        </div>
        <div>
          <div className="text-term-muted mb-0.5">Плечо</div>
          <select
            className="input !py-1"
            value={card.leverage}
            onChange={(e) => patchCard(card.id, { leverage: Number(e.target.value) })}
          >
            {[1, 2, 3, 5, 7, 10, 15, 20].map((x) => (
              <option key={x} value={x}>
                {x}x
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-term-muted">
        <span>
          Позиции: <b className="text-slate-300">{positions.length} / {card.max_orders}</b>
        </span>
        <span>
          Ноги: {card.market_a === 'futures' ? 'FUT' : 'SPOT'} ↔{' '}
          {card.market_b === 'futures' ? 'FUT' : 'SPOT'}
        </span>
      </div>

      {/* controls */}
      <div className="flex items-center gap-1.5">
        <span
          className={`text-[10px] font-bold px-2 py-1 rounded ${
            running ? 'bg-term-green/15 text-term-green' : 'bg-white/5 text-term-muted'
          }`}
        >
          {running ? '● RUNNING' : '○ STOPPED'}
        </span>
        <button
          onClick={toggleRun}
          className={`${running ? 'btn-red' : 'btn-green'} !py-1 text-xs ml-auto`}
        >
          {running ? 'Stop' : 'Start'}
        </button>
        <button onClick={copy} className="btn-ghost !py-1 text-xs">
          Copy
        </button>
        <button
          onClick={() => patchCard(card.id, { archived: !card.archived })}
          className="btn-ghost !py-1 text-xs"
          title={card.archived ? 'Вернуть из архива' : 'В архив'}
        >
          {card.archived ? '⤴' : '🗄'}
        </button>
      </div>

      {/* legs info */}
      <div className="flex gap-3 bg-black/20 rounded-lg p-2">
        <LegColumn leg={state?.a} role={roleA} />
        <div className="w-px bg-term-border" />
        <LegColumn leg={state?.b} role={roleB} />
      </div>

      {/* positions */}
      {positions.map((p) => (
        <PositionRow key={p.id} pos={p} onClosed={() => {}} />
      ))}

      {/* footer: spread */}
      <div className="flex items-end justify-between mt-auto pt-1 border-t border-term-border/60">
        <div>
          <div className="text-[10px] text-term-muted">
            Спред {direction === 'ab' ? 'A→B' : 'B→A'}
          </div>
          <div className={`font-mono font-bold text-xl ${spreadColor}`}>{fmtPct(spread)}</div>
          <div className="text-[10px] text-term-muted font-mono">
            min {fmtPct(state?.min)} · max {fmtPct(state?.max)}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 items-end">
          <button onClick={() => setShowChart(true)} className="btn-ghost !py-1 text-xs">
            📈 График
          </button>
          <button
            onClick={enter}
            disabled={entering || positions.length >= card.max_orders}
            className="btn-blue !py-1 text-xs"
          >
            {entering ? 'Вхожу…' : '⚡ Войти в сделку'}
          </button>
        </div>
      </div>

      {showChart && <ChartModal card={card} onClose={() => setShowChart(false)} />}
    </div>
  )
}
