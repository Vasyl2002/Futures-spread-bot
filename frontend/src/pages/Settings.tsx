import { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { EXCHANGES } from '../types'

export default function Settings() {
  const { settings, loadSettings, toast } = useStore()
  const [form, setForm] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (settings) {
      const next = JSON.parse(JSON.stringify(settings))
      next.scanner = {
        enabled: true,
        interval_sec: 12,
        min_spread_pct: 2.0,
        display_min_pct: 0.08,
        include_spot: true,
        max_alerts_per_tick: 6,
        cooldown_sec: 300,
        reset_spread_pct: 0.4,
        telegram_spot: false,
        quote: 'USDT',
        ...(next.scanner || {}),
      }
      setForm(next)
    }
  }, [settings])

  if (!form) return <div className="text-term-muted py-16 text-center">Загрузка…</div>

  const setPath = (path: string[], value: unknown) => {
    setForm((f: any) => {
      const next = JSON.parse(JSON.stringify(f))
      let obj = next
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]]
      obj[path[path.length - 1]] = value
      return next
    })
  }

  const save = async () => {
    setBusy(true)
    try {
      await api.put('/api/settings', form)
      await loadSettings()
      toast('Настройки сохранены и применены')
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const testTelegram = async () => {
    try {
      await api.put('/api/settings', form)
      await api.post('/api/telegram/test')
      toast('Тестовое сообщение отправлено ✓')
    } catch (e: any) {
      toast(e.message, 'err')
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="font-bold text-lg mb-4">Настройки</h1>

      {/* режим торговли */}
      <section className="bg-term-card border border-term-border rounded-xl p-4 mb-4">
        <h2 className="font-bold text-sm mb-3">Режим торговли</h2>
        <div className="flex gap-2">
          {(['paper', 'live'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPath(['trading_mode'], m)}
              className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
                form.trading_mode === m
                  ? m === 'live'
                    ? 'bg-term-red/15 border-term-red text-term-red'
                    : 'bg-yellow-500/10 border-yellow-500 text-yellow-400'
                  : 'border-term-border text-term-muted hover:bg-white/5'
              }`}
            >
              {m === 'paper' ? '📝 PAPER (симуляция)' : '🔴 LIVE (реальные ордера)'}
            </button>
          ))}
        </div>
        <p className="text-xs text-term-muted mt-2">
          Paper-режим симулирует входы по текущим ценам стакана — можно тестировать стратегию без
          риска и без ключей. Live отправляет реальные маркет-ордера на биржи.
        </p>
      </section>

      {/* telegram */}
      <section className="bg-term-card border border-term-border rounded-xl p-4 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-bold text-sm">Telegram</h2>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form.telegram.enabled}
              onChange={(e) => setPath(['telegram', 'enabled'], e.target.checked)}
              className="accent-blue-500"
            />
            включено
          </label>
          <button onClick={testTelegram} className="btn-ghost !py-1 text-xs ml-auto">
            Отправить тест
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-term-muted">Bot token (@BotFather)</label>
            <input
              className="input mt-1"
              value={form.telegram.bot_token}
              onChange={(e) => setPath(['telegram', 'bot_token'], e.target.value)}
              placeholder="123456:ABC-DEF…"
            />
          </div>
          <div>
            <label className="text-xs text-term-muted">Chat ID (@userinfobot)</label>
            <input
              className="input mt-1"
              value={form.telegram.chat_id}
              onChange={(e) => setPath(['telegram', 'chat_id'], e.target.value)}
              placeholder="-100123456789 или 123456789"
            />
          </div>
          <div>
            <label className="text-xs text-term-muted">Антиспам сигналов, сек</label>
            <input
              type="number"
              className="input mt-1"
              value={form.telegram.signal_cooldown_sec}
              onChange={(e) => setPath(['telegram', 'signal_cooldown_sec'], Number(e.target.value))}
            />
          </div>
          <label className="flex items-end gap-2 text-sm pb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.telegram.notify_trades}
              onChange={(e) => setPath(['telegram', 'notify_trades'], e.target.checked)}
              className="accent-blue-500"
            />
            Уведомлять об открытии/закрытии позиций
          </label>
        </div>
      </section>

      {/* биржи */}
      <section className="bg-term-card border border-term-border rounded-xl p-4 mb-4">
        <h2 className="font-bold text-sm mb-1">Биржи — API-ключи и прокси</h2>
        <p className="text-xs text-term-muted mb-3">
          Прокси решает проблему IP-ограничений (например, фьючерсы Binance из запрещённого
          региона): каждая биржа может ходить через свой прокси. Формат:{' '}
          <code className="text-slate-300">http://user:pass@host:port</code> или{' '}
          <code className="text-slate-300">socks5://host:port</code>.
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          {EXCHANGES.map((ex) => (
            <div key={ex.id} className="bg-black/20 rounded-lg p-3">
              <div className="font-bold text-xs mb-2">{ex.label}</div>
              <input
                className="input mb-2"
                placeholder="API Key"
                value={form.exchanges[ex.id].api_key}
                onChange={(e) => setPath(['exchanges', ex.id, 'api_key'], e.target.value)}
              />
              <input
                className="input mb-2"
                placeholder="API Secret"
                type="password"
                value={form.exchanges[ex.id].api_secret}
                onChange={(e) => setPath(['exchanges', ex.id, 'api_secret'], e.target.value)}
              />
              {(ex.id === 'kucoin' || ex.id === 'bitget') && (
                <input
                  className="input mb-2"
                  placeholder="Passphrase"
                  type="password"
                  value={form.exchanges[ex.id].api_password}
                  onChange={(e) => setPath(['exchanges', ex.id, 'api_password'], e.target.value)}
                />
              )}
              <input
                className="input"
                placeholder="Прокси: http://user:pass@host:port (пусто = не нужен)"
                value={form.exchanges[ex.id].proxy}
                onChange={(e) => setPath(['exchanges', ex.id, 'proxy'], e.target.value)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* сканер */}
      <section className="bg-term-card border border-term-border rounded-xl p-4 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-bold text-sm">Сканер спредов → Telegram</h2>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form.scanner?.enabled ?? true}
              onChange={(e) => setPath(['scanner', 'enabled'], e.target.checked)}
              className="accent-blue-500"
            />
            включён
          </label>
        </div>
        <p className="text-xs text-term-muted mb-3">
          В Telegram уходит только <b>новый импульс</b> по монете: спред недавно был узкий и
          резко разошёлся. Застрявший базис (ONE/COTI часами на 3–7%) отсекается. Один колл на
          монету, пока спред не сойдётся. По умолчанию в телегу только фьюч↔фьюч.
        </p>
        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-term-muted">Порог колла, %</label>
            <input
              type="number"
              step="0.05"
              className="input mt-1"
              value={form.scanner?.min_spread_pct ?? 2}
              onChange={(e) => setPath(['scanner', 'min_spread_pct'], Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs text-term-muted">Интервал скана, сек</label>
            <input
              type="number"
              className="input mt-1"
              value={form.scanner?.interval_sec ?? 12}
              onChange={(e) => setPath(['scanner', 'interval_sec'], Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs text-term-muted">Сошёлся, если спред ниже %</label>
            <input
              type="number"
              step="0.05"
              className="input mt-1"
              value={form.scanner?.reset_spread_pct ?? 0.4}
              onChange={(e) => setPath(['scanner', 'reset_spread_pct'], Number(e.target.value))}
            />
          </div>
          <label className="flex items-end gap-2 text-sm pb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.scanner?.include_spot ?? true}
              onChange={(e) => setPath(['scanner', 'include_spot'], e.target.checked)}
              className="accent-blue-500"
            />
            Сканировать фьюч↔спот в мониторе
          </label>
          <label className="flex items-end gap-2 text-sm pb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.scanner?.telegram_spot ?? false}
              onChange={(e) => setPath(['scanner', 'telegram_spot'], e.target.checked)}
              className="accent-blue-500"
            />
            Слать фьюч↔спот в Telegram
          </label>
        </div>
      </section>

      <button onClick={save} disabled={busy} className="btn-blue w-full !py-2.5">
        {busy ? 'Сохраняю…' : 'Сохранить настройки'}
      </button>
    </div>
  )
}
