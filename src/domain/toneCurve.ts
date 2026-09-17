/**
 * 레벨·커브 (톤 곡선 Patch, 2026-09-17).
 *
 * 사용자: "밝기·채도를 단독으로 조절하는 건 실무에서 잘 쓰이지 않는다. 레벨값·커브값
 * 조절만으로 어지간한 환경톤은 맞출 수 있다." 처음 톤 조절을 만들 때는 그래프 화면이
 * 크다는 이유로 미뤘다 (`toneAdjust.ts` 머리말). 이제 넣는다.
 *
 * 둘 다 결국 **0~255 입력을 어떤 출력으로 바꿀지 적은 표(LUT)** 한 장이다. 채널마다
 * 한 장씩, 전체(RGB)에 한 장. 픽셀을 훑는 자리는 이미 있으므로 표를 한 번 더 거치게
 * 하면 된다.
 *
 * 차례는 포토샵에서 흔히 쌓는 순서를 따른다: 레벨(채널 → 전체) → 커브(채널 → 전체).
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

export type ToneChannel = 'rgb' | 'r' | 'g' | 'b'
export const TONE_CHANNELS: readonly { channel: ToneChannel; label: string }[] = [
  { channel: 'rgb', label: 'RGB' },
  { channel: 'r', label: 'R' },
  { channel: 'g', label: 'G' },
  { channel: 'b', label: 'B' },
]

/** 커브의 점 하나 — [입력, 출력], 둘 다 0..255. */
export type CurvePoint = readonly [number, number]
export type ToneCurves = Partial<Record<ToneChannel, readonly CurvePoint[]>>

export interface ChannelLevels {
  /** 입력 검정점 0..253 */
  inBlack: number
  /** 입력 흰점 2..255 */
  inWhite: number
  /** 중간톤 0.1..9.99 — 1이 그대로, 크면 밝아진다 (포토샵과 같은 방향) */
  gamma: number
  /** 출력 검정 0..255 */
  outBlack: number
  /** 출력 흰색 0..255 */
  outWhite: number
}
export type ToneLevels = Partial<Record<ToneChannel, ChannelLevels>>

export const FLAT_LEVELS: ChannelLevels = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 }
export const FLAT_CURVE: readonly CurvePoint[] = [
  [0, 0],
  [255, 255],
]
/** 한 채널에 둘 수 있는 점의 수. 포토샵도 이 정도에서 끊는다. */
export const MAX_CURVE_POINTS = 14

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(hi, Math.max(lo, v))
}

// ── 정규화 ─────────────────────────────────────────────────────────────────

/** 점을 입력 순서로 세우고, 같은 입력은 하나만, 양 끝은 반드시 둔다. */
export function normalizeCurve(raw: unknown): CurvePoint[] {
  if (!Array.isArray(raw)) return [...FLAT_CURVE]
  const pts: CurvePoint[] = []
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue
    const x = Math.round(num(p[0], 0, 255, -1))
    const y = Math.round(num(p[1], 0, 255, -1))
    if (x < 0 || y < 0) continue
    const at = pts.findIndex((q) => q[0] === x)
    if (at >= 0) pts[at] = [x, y]
    else pts.push([x, y])
  }
  pts.sort((a, b) => a[0] - b[0])
  if (pts.length === 0 || pts[0]![0] !== 0) pts.unshift([0, 0])
  if (pts[pts.length - 1]![0] !== 255) pts.push([255, 255])
  // 넘치면 가운데 점부터 버린다 — 양 끝은 남긴다.
  while (pts.length > MAX_CURVE_POINTS) pts.splice(pts.length - 2, 1)
  return pts
}

export function curveIsFlat(points: readonly CurvePoint[] | undefined): boolean {
  if (points === undefined) return true
  return points.every(([x, y]) => x === y)
}

export function normalizeLevels(raw: unknown): ChannelLevels {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  let inBlack = Math.round(num(r.inBlack, 0, 253, 0))
  let inWhite = Math.round(num(r.inWhite, 2, 255, 255))
  if (inWhite - inBlack < 2) inWhite = Math.min(255, inBlack + 2)
  if (inWhite - inBlack < 2) inBlack = inWhite - 2
  return {
    inBlack,
    inWhite,
    gamma: Math.round(num(r.gamma, 0.1, 9.99, 1) * 100) / 100,
    outBlack: Math.round(num(r.outBlack, 0, 255, 0)),
    outWhite: Math.round(num(r.outWhite, 0, 255, 255)),
  }
}

export function levelsIsFlat(levels: ChannelLevels | undefined): boolean {
  if (levels === undefined) return true
  return (
    levels.inBlack === 0 &&
    levels.inWhite === 255 &&
    levels.gamma === 1 &&
    levels.outBlack === 0 &&
    levels.outWhite === 255
  )
}

/** 손대지 않은 채널은 아예 적지 않는다 — 저장 파일이 작고, "손댔나"가 한눈에 보인다. */
export function normalizeCurves(raw: unknown): ToneCurves | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const out: ToneCurves = {}
  for (const { channel } of TONE_CHANNELS) {
    const pts = normalizeCurve((raw as Record<string, unknown>)[channel])
    if (!curveIsFlat(pts)) out[channel] = pts
  }
  return Object.keys(out).length === 0 ? undefined : out
}

export function normalizeToneLevels(raw: unknown): ToneLevels | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const out: ToneLevels = {}
  for (const { channel } of TONE_CHANNELS) {
    const v = (raw as Record<string, unknown>)[channel]
    if (v === undefined) continue
    const l = normalizeLevels(v)
    if (!levelsIsFlat(l)) out[channel] = l
  }
  return Object.keys(out).length === 0 ? undefined : out
}

// ── 표 만들기 ──────────────────────────────────────────────────────────────

/**
 * 점들을 지나는 부드러운 곡선 (단조 3차 보간, Fritsch–Carlson).
 *
 * 그냥 3차 스플라인은 점 사이에서 위아래로 넘친다 — 점을 올렸는데 옆이 내려가는
 * 곡선은 작업자가 예상하지 못한다. 단조 보간은 점 사이에서 방향을 바꾸지 않는다.
 */
export function curveLut(points: readonly CurvePoint[]): Uint8Array {
  const pts = normalizeCurve(points)
  const lut = new Uint8Array(256)
  const n = pts.length
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const d: number[] = []
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1]! - ys[i]!) / Math.max(1, xs[i + 1]! - xs[i]!))
  const m: number[] = Array.from({ length: n }, () => 0)
  m[0] = d[0] ?? 0
  m[n - 1] = d[n - 2] ?? 0
  for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i]! / d[i]!
    const b = m[i + 1]! / d[i]!
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]!
      m[i + 1] = t * b * d[i]!
    }
  }
  let k = 0
  for (let x = 0; x < 256; x += 1) {
    while (k < n - 2 && x > xs[k + 1]!) k += 1
    const x0 = xs[k]!
    const x1 = xs[k + 1] ?? 255
    const h = Math.max(1, x1 - x0)
    const t = Math.min(1, Math.max(0, (x - x0) / h))
    const t2 = t * t
    const t3 = t2 * t
    const y =
      (2 * t3 - 3 * t2 + 1) * ys[k]! +
      (t3 - 2 * t2 + t) * h * m[k]! +
      (-2 * t3 + 3 * t2) * (ys[k + 1] ?? 255) +
      (t3 - t2) * h * (m[k + 1] ?? 0)
    lut[x] = Math.max(0, Math.min(255, Math.round(y)))
  }
  return lut
}

export function levelsLut(levels: ChannelLevels): Uint8Array {
  const l = normalizeLevels(levels)
  const lut = new Uint8Array(256)
  const span = l.inWhite - l.inBlack
  for (let x = 0; x < 256; x += 1) {
    const t = Math.min(1, Math.max(0, (x - l.inBlack) / span))
    const g = Math.pow(t, 1 / l.gamma)
    lut[x] = Math.round(l.outBlack + (l.outWhite - l.outBlack) * g)
  }
  return lut
}

function compose(first: Uint8Array | null, then: Uint8Array | null): Uint8Array | null {
  if (first === null) return then
  if (then === null) return first
  const out = new Uint8Array(256)
  for (let i = 0; i < 256; i += 1) out[i] = then[first[i]!]!
  return out
}

/** 채널 셋의 최종 표. 전부 손대지 않았으면 `null` — 픽셀을 훑을 이유가 없다. */
export function toneLuts(curves: ToneCurves | undefined, levels: ToneLevels | undefined): [Uint8Array, Uint8Array, Uint8Array] | null {
  const lv = (c: ToneChannel) => (levels?.[c] === undefined || levelsIsFlat(levels[c]) ? null : levelsLut(levels[c]))
  const cv = (c: ToneChannel) => (curves?.[c] === undefined || curveIsFlat(curves[c]) ? null : curveLut(curves[c]))
  const all = [lv('rgb'), cv('rgb')]
  if (all.every((x) => x === null) && (['r', 'g', 'b'] as const).every((c) => lv(c) === null && cv(c) === null)) return null
  const one = (c: 'r' | 'g' | 'b') => {
    // 레벨(채널 → 전체) → 커브(채널 → 전체)
    let t = compose(lv(c), lv('rgb'))
    t = compose(t, cv(c))
    t = compose(t, cv('rgb'))
    if (t !== null) return t
    const id = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) id[i] = i
    return id
  }
  return [one('r'), one('g'), one('b')]
}

/** 표를 픽셀에 건다 (제자리). 투명한 픽셀은 지나친다. */
export function applyLuts(data: Uint8ClampedArray, luts: [Uint8Array, Uint8Array, Uint8Array]): void {
  const [lr, lg, lb] = luts
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) === 0) continue
    data[i] = lr[data[i]!]!
    data[i + 1] = lg[data[i + 1]!]!
    data[i + 2] = lb[data[i + 2]!]!
  }
}

// ── 히스토그램 ─────────────────────────────────────────────────────────────

export interface Histogram {
  rgb: Uint32Array
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
}

/** 그래프 뒤에 까는 분포. 투명한 픽셀은 세지 않는다 (제품 누끼의 바깥). */
export function histogramOf(data: Uint8ClampedArray, step = 1): Histogram {
  const h: Histogram = { rgb: new Uint32Array(256), r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256) }
  const stride = 4 * Math.max(1, Math.floor(step))
  for (let i = 0; i < data.length; i += stride) {
    if ((data[i + 3] ?? 0) < 8) continue
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    h.r[r]! += 1
    h.g[g]! += 1
    h.b[b]! += 1
    h.rgb[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]! += 1
  }
  return h
}
