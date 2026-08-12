import { useEffect } from 'react'
import Header from './components/Header'
import Login from './components/Login'
import Toasts from './components/Toasts'
import Account from './pages/Account'
import History from './pages/History'
import Main from './pages/Main'
import Settings from './pages/Settings'
import { useStore } from './store'

export default function App() {
  const { tab, auth, checkAuth, loadCards, loadSettings, connectWS } = useStore()

  useEffect(() => {
    const boot = async () => {
      const ok = await checkAuth()
      if (ok) {
        loadCards()
        loadSettings()
      }
      connectWS()
    }
    boot()
    const onUnauthorized = () => useStore.setState({ auth: 'need' })
    window.addEventListener('sd-unauthorized', onUnauthorized)
    return () => window.removeEventListener('sd-unauthorized', onUnauthorized)
  }, [])

  if (auth === 'unknown') {
    return <div className="min-h-screen flex items-center justify-center text-term-muted">Загрузка…</div>
  }
  if (auth === 'need') {
    return (
      <>
        <Login />
        <Toasts />
      </>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 px-4 py-3 max-w-[1800px] w-full mx-auto">
        {tab === 'main' && <Main />}
        {tab === 'history' && <History />}
        {tab === 'account' && <Account />}
        {tab === 'settings' && <Settings />}
      </main>
      <Toasts />
    </div>
  )
}
