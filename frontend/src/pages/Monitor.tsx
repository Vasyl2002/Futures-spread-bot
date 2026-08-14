import { useMemo, useState } from 'react'
import { api } from '../api'
import { SpreadOpp, useStore } from '../store'

function fmtPrice(v: number) {
  if (v >= 1000) return v.toFixed(2)
  if (v >= 1) return v.toFixed(4)
  return v.toPrecision(5)
}

function vol(v?: number) {
  if (!v) return '—'
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`
  return v.toFixed(0)
}

function fr(v: number | null) {
  if (v == null) return '—'
  return `${(v * 100).toFixed(4)}%`
}

export default function Monitor() {
  const { scanner, scannerMeta, settings, setTab, loadCards, toast } = useStore()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'fut-fut' | 'fut-spot'>('all')
  const threshold = settings?.scanner?.min_spread_pct ?? 2

  const rows = useMemo(() => {
    return scanner.filter((o) => {
      if (kind !== 'all' && o.kind !== kind) return false
      if (q && !o.symbol.includes(q.toUpperCase())) return false
      return true
    })
  }, [scanner, q, kind])

  const makeCard = async (o: SpreadOpp) => {
    try {
      const card = await api.post<{ symbol: string }>(`/api/scanner/card`, o)
      await loadCards()
      toast(`Карточка ${card.symbol} создана — смотри во вкладке «Карточки»`)
      setTab('main')
    } catch (e: any) {
      toast(e.message, 'err')
    }
  }

  const errors = Object.entries(scannerMeta.errors || {})
  const ago = scannerMeta.ts ? Math.max(0, Math.round((Date.now() - scannerMeta.ts) / 1000)) : null

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1 className="font-bold text-lg">Монитор спредов</h1>
        <span className="text-xs text-term-muted">
          {scannerMeta.scanned} монет · скан {scannerMeta.tick_ms}мс
          {ago != null && ` · ${ago}с назад`}
        </span>
        <span className="text-xs px-2 py-0.5 rounded bg-term-accent/15 text-term-accent font-bold">
          колл ≥ {threshold}%
        </span>
        <input
          className="input !w-36 ml-auto"
          placeholder="Поиск монеты"
          value={q}
          onChange={(e) => setQ(e.target.value.toUpperCase())}
        />
        <div className="flex rounded overflow-hidden border border-term-border text-xs">
          {(
            [
              ['all', 'Все'],
              ['fut-fut', 'Фьюч↔фьюч'],
              ['fut-spot', 'Фьюч↔спот'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setKind(id)}
              className={`px-2.5 py-1 ${kind === id ? 'bg-term-accent text-white' : 'text-term-muted hover:bg-white/5'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mb-3 text-xs text-term-red bg-term-red/10 rounded-lg px-3 py-2">
          {errors.map(([k, v]) => (
            <div key={k}>
              {k}: {v}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-term-muted mb-3">
        Сканер показывает только живые спреды: есть объём и цена двигается. Стоячий базис
        (COTI/ONE часами на 5%) скрыт и в телегу не идёт.
      </p>

      {rows.length === 0 ? (
        <div className="text-center py-20 text-term-muted">
          {scannerMeta.ts
            ? 'Нет живых спредов: стоячие/без объёма отфильтрованы'
            : 'Первый скан ещё идёт, подожди ~15 секунд'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-term-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-term-panel text-term-muted text-xs text-left">
                <th className="px-3 py-2">Монета</th>
                <th className="px-3 py-2 text-right">Спред</th>
                <th className="px-3 py-2">🟢 LONG</th>
                <th className="px-3 py-2">🔴 SHORT</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2 text-right">Объём 24ч</th>
                <th className="px-3 py-2">Заход / плечо</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o, i) => {
                const hot = o.spread >= threshold
                return (
                  <tr
                    key={`${o.symbol}-${o.long.exchange}-${o.short.exchange}-${i}`}
                    className={`border-t border-term-border/50 ${hot ? 'bg-term-green/5' : 'hover:bg-white/[0.02]'}`}
                  >
                    <td className="px-3 py-2 font-bold">
                      {o.symbol}
                      <span className="text-term-muted font-normal text-xs">/{o.quote}</span>
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-bold ${
                        hot ? 'text-term-green' : 'text-slate-200'
                      }`}
                    >
                      {o.spread >= 0 ? '+' : ''}
                      {o.spread.toFixed(3)}%
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="text-term-green font-bold">{o.long.label}</span>{' '}
                      <span className="text-term-muted">
                        {o.long.market === 'futures' ? 'FUT' : 'SPOT'}
                      </span>
                      <div className="font-mono text-term-muted">{fmtPrice(o.long.price)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="text-term-red font-bold">{o.short.label}</span>{' '}
                      <span className="text-term-muted">
                        {o.short.market === 'futures' ? 'FUT' : 'SPOT'}
                      </span>
                      <div className="font-mono text-term-muted">{fmtPrice(o.short.price)}</div>
                    </td>
                    <td className="px-3 py-2 text-[10px] text-term-muted">
                      {o.kind === 'fut-fut' ? 'FUT↔FUT' : 'FUT↔SPOT'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-term-muted">
                      {vol(o.min_volume)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <b>{o.margin_short}</b> · {o.leverage}x
                      <div className="text-[10px] text-term-muted">
                        fr {fr(o.long.funding_rate)} / {fr(o.short.funding_rate)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => makeCard(o)} className="btn-ghost !py-1 text-xs">
                        В карточки
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
