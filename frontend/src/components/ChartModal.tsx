import {
  ColorType,
  createChart,
  IChartApi,
  LineStyle,
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import type { Card } from '../types'

type Mode = 'spread' | 'price_a' | 'price_b'

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h']

export default function ChartModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const [mode, setMode] = useState<Mode>('spread')
  const [timeframe, setTimeframe] = useState('5m')
  const [loading, setLoading] = useState(false)
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: '#0d1119' },
        textColor: '#7c8598',
      },
      grid: {
        vertLines: { color: '#1a2030' },
        horzLines: { color: '#1a2030' },
      },
      timeScale: { timeVisible: true, secondsVisible: mode === 'spread' },
    })
    chartRef.current = chart

    const load = async () => {
      setLoading(true)
      try {
        if (mode === 'spread') {
          const r = await api.get<{ series: [number, number][] }>(
            `/api/cards/${card.id}/history`,
          )
          const series = chart.addLineSeries({
            color: '#3b82f6',
            lineWidth: 2,
            priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(3)}%` },
          })
          // дедупликация по секундам (lightweight-charts требует уникальное время)
          const seen = new Set<number>()
          const points = r.series
            .map(([ts, v]) => ({ time: Math.floor(ts / 1000) as any, value: v }))
            .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
          series.setData(points)

          // линии порогов входа/выхода
          series.createPriceLine({
            price: card.open_threshold,
            color: '#16c784',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'вход',
          })
          series.createPriceLine({
            price: card.close_threshold,
            color: '#ea3943',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'выход',
          })
        } else {
          const leg = mode === 'price_a' ? 'a' : 'b'
          const exchange = leg === 'a' ? card.exchange_a : card.exchange_b
          const market = leg === 'a' ? card.market_a : card.market_b
          const r = await api.get<{ candles: number[][] }>(
            `/api/klines?exchange=${exchange}&market=${market}&symbol=${card.symbol}&quote=${card.quote}&timeframe=${timeframe}&limit=200`,
          )
          const series = chart.addCandlestickSeries({
            upColor: '#16c784',
            downColor: '#ea3943',
            borderVisible: false,
            wickUpColor: '#16c784',
            wickDownColor: '#ea3943',
          })
          series.setData(
            r.candles.map((c) => ({
              time: Math.floor(c[0] / 1000) as any,
              open: c[1],
              high: c[2],
              low: c[3],
              close: c[4],
            })),
          )
        }
        chart.timeScale().fitContent()
      } catch (e: any) {
        toast(`График: ${e.message}`, 'err')
      } finally {
        setLoading(false)
      }
    }
    load()

    const onResize = () => {
      if (containerRef.current)
        chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
      chartRef.current = null
    }
  }, [mode, timeframe, card.id])

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-term-panel border border-term-border rounded-xl w-full max-w-3xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <h2 className="font-bold">
            {card.symbol}/{card.quote}
          </h2>
          <div className="flex gap-1 ml-3">
            {(
              [
                ['spread', 'Спред'],
                ['price_a', `Цена ${card.exchange_a.toUpperCase()}`],
                ['price_b', `Цена ${card.exchange_b.toUpperCase()}`],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 rounded text-xs font-semibold ${
                  mode === m ? 'bg-term-accent text-white' : 'bg-white/5 text-term-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode !== 'spread' && (
            <div className="flex gap-1">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2 py-1 rounded text-xs ${
                    timeframe === tf ? 'bg-white/15 text-white' : 'bg-white/5 text-term-muted'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          )}
          {loading && <span className="text-xs text-term-muted">загрузка…</span>}
          <button onClick={onClose} className="btn-ghost ml-auto !py-1">
            ✕
          </button>
        </div>
        <div ref={containerRef} className="rounded-lg overflow-hidden" />
        {mode === 'spread' && (
          <div className="text-[11px] text-term-muted mt-2">
            История спреда копится с момента запуска сервера (интервал ~2 c). Зелёная линия —
            порог входа, красная — порог выхода.
          </div>
        )}
      </div>
    </div>
  )
}
