import { create } from 'zustand'
import { api } from './api'
import type { Card, CardState } from './types'

export type Tab = 'main' | 'history' | 'account' | 'settings'
export type Filter = 'all' | 'active' | 'archive' | 'fav' | 'intrade'

interface Toast {
  id: number
  text: string
  kind: 'ok' | 'err'
}

interface Store {
  tab: Tab
  filter: Filter
  cards: Card[]
  states: Record<number, CardState>
  settings: any
  wsConnected: boolean
  toasts: Toast[]

  setTab: (t: Tab) => void
  setFilter: (f: Filter) => void
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

  setTab: (tab) => set({ tab }),
  setFilter: (filter) => set({ filter }),

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
      const ws = new WebSocket(`${proto}://${location.host}/api/ws`)
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
