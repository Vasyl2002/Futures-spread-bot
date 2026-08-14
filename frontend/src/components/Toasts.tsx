import { useStore } from '../store'

export default function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-2.5 rounded-lg shadow-lg text-sm border ${
            t.kind === 'ok'
              ? 'bg-term-panel border-term-green/40 text-term-green'
              : 'bg-term-panel border-term-red/40 text-term-red'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
