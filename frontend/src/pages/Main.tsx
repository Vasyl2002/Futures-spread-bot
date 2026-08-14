import { useMemo, useState } from 'react'
import CardModal from '../components/CardModal'
import SpreadCard from '../components/SpreadCard'
import { Filter, useStore } from '../store'
import type { Card } from '../types'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'ВСЕ' },
  { id: 'active', label: 'АКТИВНЫЕ' },
  { id: 'archive', label: 'АРХИВ' },
  { id: 'fav', label: '★ FAV' },
  { id: 'intrade', label: 'В СДЕЛКЕ' },
]

export default function Main() {
  const { cards, states, filter, setFilter } = useStore()
  const [editCard, setEditCard] = useState<Card | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const counts = useMemo(() => {
    const inTrade = cards.filter((c) => (states[c.id]?.positions?.length ?? 0) > 0)
    return {
      all: cards.length,
      active: cards.filter((c) => !c.archived).length,
      archive: cards.filter((c) => c.archived).length,
      fav: cards.filter((c) => c.favorite && !c.archived).length,
      intrade: inTrade.length,
      positions: cards.reduce((n, c) => n + (states[c.id]?.positions?.length ?? 0), 0),
    }
  }, [cards, states])

  const visible = useMemo(() => {
    switch (filter) {
      case 'all':
        return cards
      case 'active':
        return cards.filter((c) => !c.archived)
      case 'archive':
        return cards.filter((c) => c.archived)
      case 'fav':
        return cards.filter((c) => c.favorite && !c.archived)
      case 'intrade':
        return cards.filter((c) => (states[c.id]?.positions?.length ?? 0) > 0)
    }
  }, [cards, states, filter])

  const totalPnl = useMemo(
    () =>
      Object.values(states).reduce(
        (sum, s) => sum + (s.positions ?? []).reduce((x, p) => x + (p.pnl_usd ?? 0), 0),
        0,
      ),
    [states],
  )

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="text-xs font-bold text-term-muted mr-1">CARDS</span>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
              filter === f.id
                ? 'bg-term-accent text-white'
                : 'bg-white/5 text-term-muted hover:bg-white/10'
            }`}
          >
            {f.label}{' '}
            <span className="opacity-70">{counts[f.id as keyof typeof counts]}</span>
          </button>
        ))}
        <span className="px-2.5 py-1 rounded text-xs font-semibold bg-white/5 text-term-muted">
          POSITIONS {counts.positions}
        </span>
        {counts.positions > 0 && (
          <span
            className={`px-2.5 py-1 rounded text-xs font-bold ${
              totalPnl >= 0 ? 'bg-term-green/15 text-term-green' : 'bg-term-red/15 text-term-red'
            }`}
          >
            Σ PnL {totalPnl >= 0 ? '+' : ''}
            {totalPnl.toFixed(2)} USDT
          </span>
        )}
        <button onClick={() => setShowCreate(true)} className="btn-blue ml-auto">
          + CREATE CARD
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-24 text-term-muted">
          <div className="text-4xl mb-3">🃏</div>
          <div className="mb-4">Нет карточек в этом фильтре</div>
          <button onClick={() => setShowCreate(true)} className="btn-blue">
            Создать первую карточку
          </button>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((card) => (
            <SpreadCard key={card.id} card={card} onEdit={() => setEditCard(card)} />
          ))}
        </div>
      )}

      {(showCreate || editCard) && (
        <CardModal
          card={editCard}
          onClose={() => {
            setShowCreate(false)
            setEditCard(null)
          }}
        />
      )}
    </div>
  )
}
