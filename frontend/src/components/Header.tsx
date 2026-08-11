import { Tab, useStore } from '../store'

const TABS: { id: Tab; label: string }[] = [
  { id: 'main', label: 'Главная' },
  { id: 'history', label: 'История' },
  { id: 'account', label: 'Аккаунт' },
  { id: 'settings', label: 'Настройки' },
]

export default function Header() {
  const { tab, setTab, wsConnected, settings } = useStore()
  const mode = settings?.trading_mode ?? 'paper'

  return (
    <header className="bg-term-panel border-b border-term-border px-4 py-2 flex items-center gap-6 sticky top-0 z-40">
      <div className="flex items-center gap-2">
        <span className="text-xl">📊</span>
        <span className="font-bold text-lg tracking-tight">
          Spread<span className="text-term-accent">Desk</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${
            wsConnected ? 'bg-term-green animate-pulse' : 'bg-term-red'
          }`}
        />
        <span className="text-xs font-semibold text-term-muted">
          {wsConnected ? 'LIVE' : 'OFFLINE'}
        </span>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
            mode === 'live' ? 'bg-term-red/20 text-term-red' : 'bg-yellow-500/15 text-yellow-400'
          }`}
        >
          {mode === 'live' ? 'LIVE TRADING' : 'PAPER'}
        </span>
      </div>

      <nav className="flex items-center gap-1 ml-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              tab === t.id
                ? 'bg-term-accent/15 text-term-accent font-semibold'
                : 'text-term-muted hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  )
}
