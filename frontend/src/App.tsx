import { useEffect } from 'react'
import Header from './components/Header'
import Toasts from './components/Toasts'
import Account from './pages/Account'
import History from './pages/History'
import Main from './pages/Main'
import Settings from './pages/Settings'
import { useStore } from './store'

export default function App() {
  const { tab, loadCards, loadSettings, connectWS } = useStore()

  useEffect(() => {
    loadCards()
    loadSettings()
    connectWS()
  }, [])

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
