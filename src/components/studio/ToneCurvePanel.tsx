/**
 * 레벨·커브 (톤 곡선 Patch, 2026-09-17).
 *
 * 포토샵의 두 도구를 옮긴다. 사용자: "레벨값·커브값 조절만으로 어지간한 환경톤은
 * 맞출 수 있다."
 *
 *  - **커브**: 그래프를 클릭하면 점이 생기고, 끌면 움직이고, 두 번 누르면 지워진다.
 *    양 끝 점은 지워지지 않는다. 채널(RGB·R·G·B)마다 따로.
 *  - **레벨**: 입력 검정·중간톤·흰점, 출력 검정·흰색. 채널마다 따로.
 *
 * 뒤에는 그 그림의 밝기 분포를 깐다. 값은 끄는 동안 저장되고, 손을 떼면 한 번
 * 다시 합친다 — 다른 슬라이더와 같은 규칙이다. AI 호출은 없다.
 */

import { useEffect, useRef, useState } from 'react'
import {
  FLAT_CURVE,
  FLAT_LEVELS,
  MAX_CURVE_POINTS,
  TONE_CHANNELS,
  curveLut,
  normalizeCurve,
  normalizeLevels,
  type ChannelLevels,
  type CurvePoint,
  type Histogram,
  type ToneChannel,
  type ToneCurves,
  type ToneLevels,
} from '../../domain/toneCurve'
import { histogramOfBlob } from '../../services/imageHistogram'
import { getAsset } from '../../services/assetStore'

const SIZE = 200
const HIT = 8
const CHANNEL_COLOR: Record<ToneChannel, string> = {
  rgb: 'var(--color-text, #171923)',
  r: '#e0443c',
  g: '#2fae5b',
  b: '#2f6fe0',
}

function useHistogram(assetId: string | undefined): Histogram | null {
  const [hist, setHist] = useState<Histogram | null>(null)
  useEffect(() => {
    let alive = true
    setHist(null)
    if (assetId === undefined) return
    void (async () => {
      const asset = await getAsset(assetId)
      const h = asset === undefined ? null : await histogramOfBlob(asset.blob)
      if (alive) setHist(h)
    })()
    return () => {
      alive = false
    }
  }, [assetId])
  return hist
}

function histogramPath(hist: Histogram | null, channel: ToneChannel): string {
  if (hist === null) return ''
  const bins = hist[channel]
  let max = 1
  // 가장 큰 칸 하나가 전부를 눌러 버리지 않게, 두 번째로 큰 값에 맞춘다.
  const sorted = [...bins].toSorted((a, b) => b - a)
  max = Math.max(1, sorted[1] ?? sorted[0] ?? 1)
  let d = `M0 ${SIZE}`
  for (let i = 0; i < 256; i += 1) {
    const h = Math.min(1, (bins[i] ?? 0) / max) * SIZE
    d += ` L${((i / 255) * SIZE).toFixed(1)} ${(SIZE - h).toFixed(1)}`
  }
  return `${d} L${SIZE} ${SIZE} Z`
}

export function ToneCurvePanel({
  label,
  curves,
  levels,
  assetId,
  busy,
  onChange,
  onStart,
  onCommit,
}: {
  label: string
  curves: ToneCurves | undefined
  levels: ToneLevels | undefined
  /** 분포를 읽을 그림. 없으면 분포 없이 그린다. */
  assetId: string | undefined
  busy: boolean
  onChange: (patch: { curves?: ToneCurves; levels?: ToneLevels }) => void
  /** 조작을 시작할 때 — 되돌리기 한 칸을 찍는다. */
  onStart: () => void
  /** 손을 뗐을 때 — 다시 합친다. */
  onCommit: () => void
}) {
  const [mode, setMode] = useState<'curve' | 'levels'>('curve')
  const [channel, setChannel] = useState<ToneChannel>('rgb')
  const hist = useHistogram(assetId)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<number | null>(null)

  const points = normalizeCurve(curves?.[channel] ?? FLAT_CURVE)
  const level = normalizeLevels(levels?.[channel] ?? FLAT_LEVELS)
  const lut = curveLut(points)

  const setPoints = (next: CurvePoint[]) => onChange({ curves: { ...curves, [channel]: normalizeCurve(next) } })
  const setLevel = (patch: Partial<ChannelLevels>) =>
    onChange({ levels: { ...levels, [channel]: normalizeLevels({ ...level, ...patch }) } })

  const toValue = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = svgRef.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return [0, 0]
    const x = Math.round(Math.min(255, Math.max(0, ((e.clientX - box.left) / box.width) * 255)))
    const y = Math.round(Math.min(255, Math.max(0, (1 - (e.clientY - box.top) / box.height) * 255)))
    return [x, y]
  }
  const nearest = (x: number, y: number): number => {
    let best = -1
    let dist = Infinity
    points.forEach(([px, py], i) => {
      const d = Math.hypot(((px - x) / 255) * SIZE, ((py - y) / 255) * SIZE)
      if (d < dist) {
        dist = d
        best = i
      }
    })
    return dist <= HIT ? best : -1
  }

  const curvePath = Array.from(lut, (y, x) => `${x === 0 ? 'M' : 'L'}${((x / 255) * SIZE).toFixed(1)} ${(SIZE - (y / 255) * SIZE).toFixed(1)}`).join(' ')
  const touched = (curves !== undefined && Object.keys(curves).length > 0) || (levels !== undefined && Object.keys(levels).length > 0)

  return (
    <div className="curve" aria-label={`${label} 레벨·커브`}>
      <div className="curve__head">
        <div className="curve__tabs" role="tablist">
          {(['curve', 'levels'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`btn curve__tab${mode === m ? ' is-on' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'curve' ? '커브' : '레벨'}
            </button>
          ))}
        </div>
        <div className="curve__channels" role="group" aria-label="채널">
          {TONE_CHANNELS.map((c) => (
            <button
              key={c.channel}
              type="button"
              aria-pressed={channel === c.channel}
              className={`btn curve__channel${channel === c.channel ? ' is-on' : ''}`}
              style={{ color: CHANNEL_COLOR[c.channel] }}
              onClick={() => setChannel(c.channel)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <svg
        ref={svgRef}
        className="curve__graph"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${label} ${mode === 'curve' ? '커브' : '레벨'} 그래프`}
        onPointerDown={(e) => {
          if (busy || mode !== 'curve') return
          const [x, y] = toValue(e)
          let at = nearest(x, y)
          onStart()
          if (at < 0) {
            if (points.length >= MAX_CURVE_POINTS) return
            const next = normalizeCurve([...points, [x, y]])
            at = next.findIndex((p) => p[0] === x)
            setPoints(next)
          }
          dragRef.current = at
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const at = dragRef.current
          if (at === null || busy) return
          const [x, y] = toValue(e)
          const next = points.map((p) => [p[0], p[1]] as [number, number])
          const last = next.length - 1
          // 양 끝은 옆으로 가지 않는다. 가운데 점은 이웃을 넘지 못한다.
          const lo = at === 0 ? 0 : next[at - 1]![0] + 1
          const hi = at === last ? 255 : next[at + 1]![0] - 1
          next[at] = [at === 0 || at === last ? next[at]![0] : Math.min(hi, Math.max(lo, x)), y]
          setPoints(next)
        }}
        onPointerUp={() => {
          if (dragRef.current === null) return
          dragRef.current = null
          onCommit()
        }}
        onDoubleClick={(e) => {
          if (busy || mode !== 'curve') return
          const [x, y] = toValue(e)
          const at = nearest(x, y)
          if (at <= 0 || at >= points.length - 1) return
          onStart()
          setPoints(points.filter((_, i) => i !== at))
          onCommit()
        }}
      >
        <rect x={0} y={0} width={SIZE} height={SIZE} className="curve__bg" />
        {hist !== null && <path d={histogramPath(hist, channel)} className="curve__hist" />}
        {[1, 2, 3].map((i) => (
          <g key={i} className="curve__grid">
            <line x1={(SIZE * i) / 4} y1={0} x2={(SIZE * i) / 4} y2={SIZE} />
            <line x1={0} y1={(SIZE * i) / 4} x2={SIZE} y2={(SIZE * i) / 4} />
          </g>
        ))}
        <line x1={0} y1={SIZE} x2={SIZE} y2={0} className="curve__diag" />
        {mode === 'curve' ? (
          <>
            <path d={curvePath} className="curve__line" style={{ stroke: CHANNEL_COLOR[channel] }} />
            {points.map(([x, y], i) => (
              <circle
                key={`${String(i)}-${String(x)}`}
                cx={(x / 255) * SIZE}
                cy={SIZE - (y / 255) * SIZE}
                r={4}
                className="curve__point"
              />
            ))}
          </>
        ) : (
          <>
            <line x1={(level.inBlack / 255) * SIZE} y1={0} x2={(level.inBlack / 255) * SIZE} y2={SIZE} className="curve__marker" />
            <line x1={(level.inWhite / 255) * SIZE} y1={0} x2={(level.inWhite / 255) * SIZE} y2={SIZE} className="curve__marker" />
          </>
        )}
      </svg>

      {mode === 'curve' ? (
        <p className="curve__hint">클릭해서 점 추가 · 끌어서 조절 · 두 번 눌러 삭제</p>
      ) : (
        <div className="tone__sliders">
          {(
            [
              { key: 'inBlack', label: '입력 검정', min: 0, max: 253, step: 1 },
              { key: 'gamma', label: '중간톤', min: 0.1, max: 3, step: 0.01 },
              { key: 'inWhite', label: '입력 흰점', min: 2, max: 255, step: 1 },
              { key: 'outBlack', label: '출력 검정', min: 0, max: 255, step: 1 },
              { key: 'outWhite', label: '출력 흰색', min: 0, max: 255, step: 1 },
            ] as const
          ).map((f) => (
            <label key={f.key} className="tone__slider">
              <span className="tone__slider-label">
                {f.label} · {f.key === 'gamma' ? level.gamma.toFixed(2) : level[f.key]}
              </span>
              <input
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={level[f.key]}
                aria-label={`${label} 레벨 ${f.label}`}
                disabled={busy}
                onPointerDown={onStart}
                onKeyDown={onStart}
                onChange={(e) => setLevel({ [f.key]: Number(e.target.value) })}
                onPointerUp={onCommit}
                onKeyUp={onCommit}
              />
            </label>
          ))}
        </div>
      )}

      <div className="curve__actions">
        <button
          type="button"
          className="btn tone__reset"
          disabled={busy || (mode === 'curve' ? curves?.[channel] === undefined : levels?.[channel] === undefined)}
          onClick={() => {
            onStart()
            if (mode === 'curve') {
              const { [channel]: _drop, ...rest } = curves ?? {}
              onChange({ curves: rest })
            } else {
              const { [channel]: _drop, ...rest } = levels ?? {}
              onChange({ levels: rest })
            }
            onCommit()
          }}
        >
          이 채널 되돌리기
        </button>
        {touched && <span className="curve__touched">손댄 값 있음</span>}
      </div>
    </div>
  )
}
