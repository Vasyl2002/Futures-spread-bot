import { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { EXCHANGES } from '../types'

type Balances = Record<string, { spot: Record<string, number>; futures: Record<string, number>; error: string | null }>

export default function Account() {
  const [balances, setBalances] = useState<Balances | null>(null)
  const [loading, setLoading] = useState(false)
  const toast = useStore((s) => s.toast)

  const load = async () => {
    setLoading(true)
    try {
      setBalances(await api.get<Balances>('/api/balances'))
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-bold text-lg">Аккаунт — балансы бирж</h1>
        <button onClick={load} disabled={loading} className="btn-ghost !py-1">
          {loading ? 'Загрузка…' : '⟳ Обновить'}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {EXCHANGES.map((ex) => {
          const b = balances?.[ex.id]
          return (
            <div key={ex.id} className="bg-term-card border border-term-border rounded-xl p-4">
              <div className="font-bold mb-3">{ex.label}</div>
              {!b ? (
                <div className="text-term-muted text-sm">…</div>
              ) : b.error === 'no_keys' ? (
                <div className="text-term-muted text-sm">
                  Нет API-ключей.
                  <br />
                  Добавьте их в «Настройки», чтобы видеть балансы и торговать.
                </div>
              ) : b.error ? (
                <div className="text-term-red text-xs break-words">⚠ {b.error}</div>
              ) : (
                <div className="space-y-3">
                  {(['futures', 'spot'] as const).map((market) => (
                    <div key={market}>
                      <div className="text-[10px] font-bold text-term-muted mb-1">
                        {market === 'futures' ? 'ФЬЮЧЕРСЫ' : 'СПОТ'}
                      </div>
                      {Object.keys(b[market]).length === 0 ? (
                        <div className="text-xs text-term-muted">пусто</div>
                      ) : (
                        <table className="w-full text-xs">
                          <tbody>
                            {Object.entries(b[market])
                              .sort(([, x], [, y]) => Number(y) - Number(x))
                              .slice(0, 8)
                              .map(([coin, amount]) => (
                                <tr key={coin}>
                                  <td className="text-term-muted py-0.5">{coin}</td>
                                  <td className="text-right font-mono">{Number(amount).toFixed(6)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
