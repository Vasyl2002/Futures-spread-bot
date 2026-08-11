import { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Card, EXCHANGES, MarketType } from '../types'

const MARKETS: { id: MarketType; label: string }[] = [
  { id: 'futures', label: 'Фьючерсы' },
  { id: 'spot', label: 'Спот' },
]

export default function CardModal({ card, onClose }: { card: Card | null; onClose: () => void }) {
  const { loadCards, toast } = useStore()
  const isEdit = !!card
  const [form, setForm] = useState({
    symbol: card?.symbol ?? '',
    quote: card?.quote ?? 'USDT',
    exchange_a: card?.exchange_a ?? 'bitget',
    market_a: card?.market_a ?? 'futures',
    exchange_b: card?.exchange_b ?? 'gateio',
    market_b: card?.market_b ?? 'futures',
    side_mode: card?.side_mode ?? 'auto',
    open_threshold: card?.open_threshold ?? 0.4,
    close_threshold: card?.close_threshold ?? 0.0,
    size_usd: card?.size_usd ?? 100,
    max_orders: card?.max_orders ?? 1,
    leverage: card?.leverage ?? 3,
    auto_enter: card?.auto_enter ?? false,
    telegram_signals: card?.telegram_signals ?? true,
  })
  const [symbols, setSymbols] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    // подсказка по доступным монетам ноги A
    api
      .get<{ symbols: string[] }>(
        `/api/symbols?exchange=${form.exchange_a}&market=${form.market_a}`,
      )
      .then((r) => setSymbols(r.symbols))
      .catch(() => setSymbols([]))
  }, [form.exchange_a, form.market_a])

  const save = async () => {
    if (!form.symbol.trim()) {
      toast('Укажите монету', 'err')
      return
    }
    setBusy(true)
    try {
      if (isEdit) {
        await api.patch(`/api/cards/${card!.id}`, form)
        toast('Карточка обновлена')
      } else {
        await api.post('/api/cards', form)
        toast('Карточка создана')
      }
      await loadCards()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Удалить карточку?')) return
    try {
      await api.delete(`/api/cards/${card!.id}`)
      await loadCards()
      toast('Карточка удалена')
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    }
  }

  const LegSelect = ({ prefix, title }: { prefix: 'a' | 'b'; title: string }) => (
    <div className="bg-black/20 rounded-lg p-3">
      <div className="text-xs font-bold text-term-muted mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        <select
          className="input"
          value={form[`exchange_${prefix}`]}
          onChange={(e) => set(`exchange_${prefix}`, e.target.value)}
        >
          {EXCHANGES.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={form[`market_${prefix}`]}
          onChange={(e) => set(`market_${prefix}`, e.target.value)}
        >
          {MARKETS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-term-panel border border-term-border rounded-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-bold text-lg mb-4">
          {isEdit ? `Карточка ${card!.symbol}` : 'Новая карточка'}
        </h2>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-term-muted">Монета</label>
            <input
              className="input mt-1 uppercase"
              list="symbols-list"
              placeholder="BTC"
              value={form.symbol}
              onChange={(e) => set('symbol', e.target.value.toUpperCase())}
            />
            <datalist id="symbols-list">
              {symbols.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-term-muted">Котировка</label>
            <input
              className="input mt-1"
              value={form.quote}
              onChange={(e) => set('quote', e.target.value.toUpperCase())}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <LegSelect prefix="a" title="НОГА A" />
          <LegSelect prefix="b" title="НОГА B" />
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="text-xs text-term-muted">Спред входа, %</label>
            <input
              type="number"
              step="0.05"
              className="input mt-1"
              value={form.open_threshold}
              onChange={(e) => set('open_threshold', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs text-term-muted">Спред выхода, %</label>
            <input
              type="number"
              step="0.05"
              className="input mt-1"
              value={form.close_threshold}
              onChange={(e) => set('close_threshold', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs text-term-muted">Размер ноги, $</label>
            <input
              type="number"
              step="10"
              className="input mt-1"
              value={form.size_usd}
              onChange={(e) => set('size_usd', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="text-xs text-term-muted">Направление</label>
            <select
              className="input mt-1"
              value={form.side_mode}
              onChange={(e) => set('side_mode', e.target.value)}
            >
              <option value="auto">AUTO</option>
              <option value="a_long_b_short">LONG A / SHORT B</option>
              <option value="a_short_b_long">SHORT A / LONG B</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-term-muted">Макс. позиций</label>
            <input
              type="number"
              className="input mt-1"
              value={form.max_orders}
              onChange={(e) => set('max_orders', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs text-term-muted">Плечо</label>
            <select
              className="input mt-1"
              value={form.leverage}
              onChange={(e) => set('leverage', Number(e.target.value))}
            >
              {[1, 2, 3, 5, 7, 10, 15, 20].map((x) => (
                <option key={x} value={x}>
                  {x}x
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-4 mb-5 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.telegram_signals}
              onChange={(e) => set('telegram_signals', e.target.checked)}
              className="accent-blue-500"
            />
            Сигналы в Telegram
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.auto_enter}
              onChange={(e) => set('auto_enter', e.target.checked)}
              className="accent-blue-500"
            />
            Авто-вход/выход по порогам
          </label>
        </div>

        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="btn-blue flex-1">
            {busy ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Создать'}
          </button>
          {isEdit && (
            <button onClick={remove} className="btn-red">
              Удалить
            </button>
          )}
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
