import { useEffect, useState } from 'react'
import { api } from '../api'
import { EXCHANGES, exLabel } from '../types'

type Balances = Record<string, { spot: Record<string, number>; futures: Record<string, number>; error: string | null }>

export default function Account() {
  const [balances, setBalances] = useState<Balances | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setBalances(await api.get<Balances>('/api/balances'))
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
        <button onClick={load} disabled={loading} className="btn-ghost !py-1 text-xs">
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
                <div className="text-term-muted text-sm">Загрузка…</div>
              ) : b.error === 'no_keys' ? (
                <div className="text-term-muted text-sm">
                  Нет API-ключей.
                  <br />
                  Добавьте их в разделе «Настройки», чтобы видеть балансы и торговать.
                </div>
              ) : b.error ? (
                <div className="text-term-red text-xs break-words">⚠ {b.error}</div>
              ) : (
                <>
                  {(['spot', 'futures'] as const).map((mkt) => (
                    <div key={mkt} className="mb-3">
                      <div className="text-[10px] font-bold text-term-muted mb-1">
                        {mkt === 'spot' ? 'СПОТ' : 'ФЬЮЧЕРСЫ'}
                      </div>
                      {Object.keys(b[mkt]).length === 0 ? (
                        <div className="text-xs text-term-muted">пусто</div>
                      ) : (
                        <table className="w-full text-xs">
                          <tbody>
                            {Object.entries(b[mkt])
                              .sort(([, x], [, y]) => Number(y) - Number(x))
                              .slice(0, 12)
                              .map(([coin, amount]) => (
                                <tr key={coin}>
                                  <td className="py-0.5 text-term-muted">{coin}</td>
                                  <td className="py-0.5 text-right font-mono">
                                    {Number(amount).toLocaleString('ru-RU', {
                                      maximumFractionDigits: 6,
                                    })}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-term-muted mt-4 max-w-2xl">
        Балансы читаются напрямую с бирж по вашим API-ключам. Ключи хранятся только на вашем
        сервере (в базе SQLite) и никуда не передаются. Для {exLabel('binance')} из
        ограниченного региона укажите прокси в настройках биржи.
      </p>
    </div>
  )
}
