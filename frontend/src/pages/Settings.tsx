import { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { EXCHANGES } from '../types'

export default function Settings() {
  const { settings, loadSettings, toast } = useStore()
  const [form, setForm] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (settings) setForm(JSON.parse(JSON.stringify(settings)))
  }, [settings])

  if (!form) return <div className="text-term-muted py-16 text-center">Загрузка…</div>

  const setEx = (ex: string, key: string, value: unknown) =>
    setForm((f: any) => ({
      ...f,
      exchanges: { ...f.exchanges, [ex]: { ...f.exchanges[ex], [key]: value } },
    }))

  const setTg = (key: string, value: unknown) =>
    setForm((f: any) => ({ ...f, telegram: { ...f.telegram, [key]: value } }))

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
    <div className="max-w-3xl space-y-4">
      <h1 className="font-bold text-lg">Настройки</h1>

      {/* режим торговли */}
      <div className="bg-term-card border border-term-border rounded-xl p-4">
        <div className="font-bold mb-2">Режим торговли</div>
        <div className="flex gap-2">
          {(
            [
              ['paper', 'PAPER — виртуальные сделки (безопасно, без ключей)'],
              ['live', 'LIVE — реальные ордера на биржах'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setForm({ ...form, trading_mode: mode })}
              className={`px-3 py-2 rounded-lg text-sm text-left flex-1 border transition-colors ${
                form.trading_mode === mode
                  ? mode === 'live'
                    ? 'border-term-red bg-term-red/10 text-term-red font-semibold'
                    : 'border-yellow-500 bg-yellow-500/10 text-yellow-400 font-semibold'
                  : 'border-term-border text-term-muted hover:bg-white/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {form.trading_mode === 'live' && (
          <div className="text-xs text-term-red mt-2">
            ⚠ В режиме LIVE кнопки «Войти в сделку» и авто-вход выставляют реальные маркет-ордера.
          </div>
        )}
      </div>

      {/* биржи */}
      <div className="bg-term-card border border-term-border rounded-xl p-4">
        <div className="font-bold mb-1">API-ключи и прокси бирж</div>
        <div className="text-xs text-term-muted mb-3">
          Прокси — обход IP-ограничений (например, для фьючерсов Binance из запрещённого региона).
          Формат: <code className="text-slate-300">http://user:pass@host:port</code> или{' '}
          <code className="text-slate-300">socks5://host:port</code>. Ключи нужны только для
          торговли и балансов; мониторинг спредов работает без них.
        </div>
        <div className="space-y-3">
          {EXCHANGES.map((ex) => {
            const cfg = form.exchanges[ex.id] ?? {}
            return (
              <div key={ex.id} className="bg-black/20 rounded-lg p-3">
                <div className="text-sm font-bold mb-2">{ex.label}</div>
                <div className="grid md:grid-cols-2 gap-2">
                  <input
                    className="input"
                    placeholder="API Key"
                    value={cfg.api_key ?? ''}
                    onChange={(e) => setEx(ex.id, 'api_key', e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="API Secret"
                    type="password"
                    value={cfg.api_secret ?? ''}
                    onChange={(e) => setEx(ex.id, 'api_secret', e.target.value)}
                  />
                  {(ex.id === 'kucoin' || ex.id === 'bitget') && (
                    <input
                      className="input"
                      placeholder="Passphrase"
                      type="password"
                      value={cfg.api_password ?? ''}
                      onChange={(e) => setEx(ex.id, 'api_password', e.target.value)}
                    />
                  )}
                  <input
                    className="input"
                    placeholder="Прокси (опционально): socks5://host:port"
                    value={cfg.proxy ?? ''}
                    onChange={(e) => setEx(ex.id, 'proxy', e.target.value)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* telegram */}
      <div className="bg-term-card border border-term-border rounded-xl p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="font-bold">Telegram</div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.telegram.enabled}
              onChange={(e) => setTg('enabled', e.target.checked)}
              className="accent-blue-500"
            />
            включён
          </label>
        </div>
        <div className="text-xs text-term-muted mb-3">
          Создайте бота через{' '}
          <a href="https://t.me/BotFather" target="_blank" className="text-term-accent underline">
            @BotFather
          </a>
          , получите token. Chat ID можно узнать через{' '}
          <a href="https://t.me/userinfobot" target="_blank" className="text-term-accent underline">
            @userinfobot
          </a>
          . В сигналах бот присылает спред, цены ног, funding и рекомендацию: чем заходить
          (монета/USDT) и с каким плечом.
        </div>
        <div className="grid md:grid-cols-2 gap-2 mb-2">
          <input
            className="input"
            placeholder="Bot token"
            value={form.telegram.bot_token ?? ''}
            onChange={(e) => setTg('bot_token', e.target.value)}
          />
          <input
            className="input"
            placeholder="Chat ID"
            value={form.telegram.chat_id ?? ''}
            onChange={(e) => setTg('chat_id', e.target.value)}
          />
          <label className="text-xs text-term-muted flex items-center gap-2">
            Пауза между сигналами одной карточки, сек:
            <input
              type="number"
              className="input !w-24"
              value={form.telegram.signal_cooldown_sec}
              onChange={(e) => setTg('signal_cooldown_sec', Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.telegram.notify_trades}
              onChange={(e) => setTg('notify_trades', e.target.checked)}
              className="accent-blue-500"
            />
            уведомления об открытии/закрытии позиций
          </label>
        </div>
        <button onClick={testTelegram} className="btn-ghost !py-1 text-xs">
          ✈ Отправить тест
        </button>
      </div>

      {/* engine */}
      <div className="bg-term-card border border-term-border rounded-xl p-4">
        <div className="font-bold mb-2">Движок</div>
        <label className="text-sm text-term-muted flex items-center gap-2">
          Интервал опроса бирж, сек:
          <input
            type="number"
            step="0.5"
            min="1"
            className="input !w-24"
            value={form.poll_interval_sec}
            onChange={(e) => setForm({ ...form, poll_interval_sec: Number(e.target.value) })}
          />
        </label>
      </div>

      <button onClick={save} disabled={busy} className="btn-blue w-full !py-2.5">
        {busy ? 'Сохраняю…' : 'Сохранить настройки'}
      </button>
    </div>
  )
}
