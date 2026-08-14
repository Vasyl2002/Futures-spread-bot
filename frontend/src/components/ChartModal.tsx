import { ColorType, createChart, IChartApi } from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Card } from '../types'

type Mode = 'spread' | 'price'

export default function ChartModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('spread')
  const [priceLeg, setPriceLeg] = useState<'a' | 'b'>('a')
  const [timeframe, setTimeframe] = useState('5m')
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#12161f' },
        textColor: '#7c8598',
      },
      grid: {
        vertLines: { color: '#1c2230' },
        horzLines: { color: '#1c2230' },
      },
      width: containerRef.current.clientWidth,
      height: 420,
      timeScale: { timeVisible: true, secondsVisible: mode === 'spread' },
    })
    chartRef.current = chart
    setError(null)

    const load = async () => {
      try {
        if (mode === 'spread') {
          const r = await api.get<{ series: [number, number][] }>(
            `/api/cards/${card.id}/history`,
          )
          if (!r.series.length) {
            setError('Пока нет данных спреда — движок только начал собирать историю')
            return
          }
          const series = chart.addAreaSeries({
            lineColor: '#3b82f6',
            topColor: 'rgba(59,130,246,0.35)',
            bottomColor: 'rgba(59,130,246,0.02)',
            priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(3)}%` },
          })
          // дедупликация по секунде (lightweight-charts требует уникальное время)
          const seen = new Set<number>()
          const data = r.series
            .map(([ts, v]) => ({ time: Math.floor(ts / 1000) as any, value: v }))
            .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
          series.setData(data)
          const open = chart.addLineSeries({
            color: '#16c784',
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
          })
          open.setData(data.map((d) => ({ time: d.time, value: card.open_threshold })))
        } else {
          const ex = priceLeg === 'a' ? card.exchange_a : card.exchange_b
          const mkt = priceLeg === 'a' ? card.market_a : card.market_b
          const r = await api.get<{ candles: number[][] }>(
            `/api/klines?exchange=${ex}&market=${mkt}&symbol=${card.symbol}&quote=${card.quote}&timeframe=${timeframe}&limit=300`,
          )
          const series = chart.addCandlestickSeries({
            upColor: '#16c784',
            downColor: '#ea3943',
            wickUpColor: '#16c784',
            wickDownColor: '#ea3943',
            borderVisible: false,
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
        setError(e.message)
      }
    }
    load()

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
      chartRef.current = null
    }
  }, [mode, priceLeg, timeframe, card])

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
          <div className="flex rounded overflow-hidden border border-term-border text-xs">
            <button
              onClick={() => setMode('spread')}
              className={`px-3 py-1 ${mode === 'spread' ? 'bg-term-accent text-white' : 'text-term-muted hover:bg-white/5'}`}
            >
              Спред
            </button>
            <button
              onClick={() => setMode('price')}
              className={`px-3 py-1 ${mode === 'price' ? 'bg-term-accent text-white' : 'text-term-muted hover:bg-white/5'}`}
            >
              Цена монеты
            </button>
          </div>
          {mode === 'price' && (
            <>
              <select
                className="input !w-auto !py-0.5 text-xs"
                value={priceLeg}
                onChange={(e) => setPriceLeg(e.target.value as 'a' | 'b')}
              >
                <option value="a">
                  {card.exchange_a.toUpperCase()} ({card.market_a})
                </option>
                <option value="b">
                  {card.exchange_b.toUpperCase()} ({card.market_b})
                </option>
              </select>
              <select
                className="input !w-auto !py-0.5 text-xs"
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
              >
                {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </>
          )}
          <button onClick={onClose} className="btn-ghost !py-1 ml-auto text-xs">
            ✕ Закрыть
          </button>
        </div>
        {error ? (
          <div className="h-[420px] flex items-center justify-center text-term-muted text-sm px-8 text-center">
            {error}
          </div>
        ) : (
          <div ref={containerRef} />
        )}
      </div>
    </div>
  )
}
