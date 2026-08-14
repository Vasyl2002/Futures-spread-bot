import { useState } from 'react'
import { useStore } from '../store'

export default function Login() {
  const { login, loadCards, loadSettings } = useStore()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(password)
      await Promise.all([loadCards(), loadSettings()])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="bg-term-panel border border-term-border rounded-xl p-6 w-full max-w-sm"
      >
        <div className="flex items-center gap-2 mb-5 justify-center">
          <span className="text-2xl">📊</span>
          <span className="font-bold text-xl">
            Spread<span className="text-term-accent">Desk</span>
          </span>
        </div>
        <label className="text-xs text-term-muted">Пароль</label>
        <input
          type="password"
          autoFocus
          className="input mt-1 mb-3 !py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="text-term-red text-sm mb-3">{error}</div>}
        <button type="submit" disabled={busy || !password} className="btn-blue w-full !py-2">
          {busy ? 'Вхожу…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
