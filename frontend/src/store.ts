import { create } from 'zustand'
import { api, getToken, setToken } from './api'
import type { Card, CardState } from './types'

export type Tab = 'main' | 'history' | 'account' | 'settings'
export type Filter = 'all' | 'active' | 'archive' | 'fav' | 'intrade'

interface Toast {
  id: number
  text: string
  kind: 'ok' | 'err'
}

export type AuthState = 'unknown' | 'ok' | 'need'

interface Store {
  tab: Tab
  filter: Filter
  cards: Card[]
  states: Record<number, CardState>
  settings: any
  wsConnected: boolean
  toasts: Toast[]
  auth: AuthState

  setTab: (t: Tab) => void
  setFilter: (f: Filter) => void
  checkAuth: () => Promise<boolean>
  login: (password: string) => Promise<void>
  loadCards: () => Promise<void>
  loadSettings: () => Promise<void>
  patchCard: (id: number, patch: Partial<Card>) => Promise<void>
  toast: (text: string, kind?: 'ok' | 'err') => void
  connectWS: () => void
}

let toastId = 0

export const useStore = create<Store>((set, get) => ({
  tab: 'main',
  filter: 'active',
  cards: [],
  states: {},
  settings: null,
  wsConnected: false,
  toasts: [],
  auth: 'unknown',

  setTab: (tab) => set({ tab }),
  setFilter: (filter) => set({ filter }),

  checkAuth: async () => {
    const info = await api.get<{ required: boolean }>('/api/auth-info')
    if (!info.required) {
      set({ auth: 'ok' })
      return true
    }
    if (!getToken()) {
      set({ auth: 'need' })
      return false
    }
    try {
      await api.get('/api/cards')
      set({ auth: 'ok' })
      return true
    } catch {
      setToken(null)
      set({ auth: 'need' })
      return false
    }
  },

  login: async (password) => {
    const r = await api.post<{ token: string | null }>('/api/login', { password })
    setToken(r.token)
    set({ auth: 'ok' })
  },

  loadCards: async () => {
    const cards = await api.get<Card[]>('/api/cards')
    set({ cards })
  },

  loadSettings: async () => {
    const settings = await api.get('/api/settings')
    set({ settings })
  },

  patchCard: async (id, patch) => {
    const updated = await api.patch<Card>(`/api/cards/${id}`, patch)
    set({ cards: get().cards.map((c) => (c.id === id ? updated : c)) })
  },

  toast: (text, kind = 'ok') => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, kind }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4500)
  },

  connectWS: () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const connect = () => {
      if (get().auth !== 'ok') {
        setTimeout(connect, 1000)
        return
      }
      const token = getToken()
      const ws = new WebSocket(
        `${proto}://${location.host}/api/ws${token ? `?token=${token}` : ''}`,
      )
      ws.onopen = () => {
        set({ wsConnected: true })
        const ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping')
          else clearInterval(ping)
        }, 15000)
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'cards_state') {
            const states: Record<number, CardState> = {}
            for (const s of msg.data) states[s.card_id] = s
            set({ states })
          }
        } catch {}
      }
      ws.onclose = () => {
        set({ wsConnected: false })
        setTimeout(connect, 2000)
      }
    }
    connect()
  },
}))
