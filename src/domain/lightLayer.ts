/**
 * 빛 맞추기의 규칙 (빛 층 Patch, 2026-09-17). 순수 모듈 — 캔버스도 DOM도 모른다.
 *
 * ## 무엇을 하는가
 *
 * 사용자의 아이디어다: 누끼에서 제품의 모양·크기를 안다. 그 모양의 **무늬 없는 회색
 * 덩어리**를 제품 자리에 놓고 Klein에게 장면의 빛만 입히게 한 뒤, 그 **빛만 떼어**
 * 원본 제품 위에 얹는다. 제품 픽셀은 AI가 만든 것을 쓰지 않는다.
 *
 * 2026-09-17 실측 (REPORT §7~11):
 *  - Klein은 받은 그림 속 제품을 테두리를 씌워도 다시 그린다 (세부 상관 0.12~0.34)
 *  - 회색 덩어리에서 뗀 빛을 원본에 곱하면 세부가 지켜진다 (0.91~0.97)
 *  - Klein 편집 결과는 1.5~4% 작게 나온다 → 되돌려야 원본과 겹친다
 *  - 장면을 통째로 새로 그리면 윤곽선 분포의 상관이 0.2~0.4로 떨어진다 → 버린다
 *
 * ## 여기 있는 것
 *
 *  - 빛 배율의 인코딩 (PNG 한 장에 0~2배)
 *  - 빛 층을 제품 픽셀에 거는 식 (곱하기 + 스크린)
 *  - 제품 가장자리의 흰 매트 걷기 (`effects.edge`)
 *  - 결과의 크기 어긋남 찾기 (가로·세로 윤곽선 분포를 1차원으로 맞춘다)
 *  - 마스크 안에서만 흐리기 (빛 뽑기·배경 띠 메우기에 쓴다)
 */

/** Klein에게 줄 덩어리의 색. 가운데 회색이어야 밝아진 곳과 어두워진 곳을 둘 다 읽는다. */
export const PROBE_GREY = 128
/** 빛 층 PNG의 한 칸 = 배율 × 이 값. 128 근처가 "그대로"다. 배율 0..2. */
export const GAIN_SCALE = 127.5
export const GAIN_MIN = 0.25
export const GAIN_MAX = 1.6
/** 빛의 색은 이만큼까지만 받는다 — 배경색이 제품에 번지지 않게 (§11 v2: 빨간 띠). */
export const GAIN_CHROMA_MAX = 0.12
/** 스크린 쪽(밝게) 한계 — 배율이 1+이 값이면 스크린이 가득 찬다. */
export const SCREEN_SPAN = 0.6
export const SCREEN_MAX = 0.8

export function encodeGain(g: number): number {
  return Math.max(0, Math.min(255, Math.round(g * GAIN_SCALE)))
}

export function decodeGain(b: number): number {
  return b / GAIN_SCALE
}

/**
 * 빛 층을 제품 픽셀에 건다 (제자리). 두 버퍼는 같은 크기다.
 *
 * 1보다 작은 배율은 곱하기(그림자), 큰 배율은 스크린(빛)이다 — 흰 제품에 곱하기만
 * 하면 밝아질 수가 없다. 알파는 건드리지 않는다.
 */
export function applyLightLayer(product: Uint8ClampedArray, light: Uint8ClampedArray, strength: number): void {
  const s = Math.max(0, Math.min(1, strength))
  if (s === 0) return
  for (let i = 0; i < product.length; i += 4) {
    if ((product[i + 3] ?? 0) === 0) continue
    for (let c = 0; c < 3; c += 1) {
      const g = 1 + (decodeGain(light[i + c] ?? 128) - 1) * s
      const p = (product[i + c] ?? 0) / 255
      const mult = g < 1 ? g : 1
      const scr = g > 1 ? Math.min(1, (g - 1) / SCREEN_SPAN) * SCREEN_MAX : 0
      const out = 1 - (1 - p * mult) * (1 - scr)
      product[i + c] = Math.round(out * 255)
    }
  }
}

/** 빛 맞추기를 한 그때의 자리. 반올림한다 — 1px 흔들림으로 "옮겼다"고 하지 않게. */
export function lightKeyOf(rect: { x: number; y: number; width: number; height: number }, angle: number | undefined): string {
  const r = (v: number) => Math.round(v / 2) * 2
  return [r(rect.x), r(rect.y), r(rect.width), r(rect.height), Math.round(angle ?? 0)].join(',')
}

// ── 흰 매트 걷기 ────────────────────────────────────────────────────────────

/**
 * 누끼 가장자리의 반투명 픽셀에 섞인 바탕색(대개 흰색)을 안쪽 색으로 바꾼다.
 *
 * 흰 바탕에서 딴 누끼는 가장자리 색에 흰색이 묻어 있다 — 검은 제품의 가장자리
 * 평균 밝기가 198인데 바로 안쪽은 122였다 (2026-09-17). 어두운 배경에 얹으면
 * 밝은 테로 보인다. 포토샵의 "흰색 매트 제거"와 같은 일이다.
 *
 * 둘레 두 칸 안의 불투명 픽셀 평균으로 당긴다. 세기 0이면 손대지 않는다.
 */
export function defringe(data: Uint8ClampedArray, width: number, height: number, strength: number): void {
  const s = Math.max(0, Math.min(1, strength))
  if (s === 0) return
  const src = data.slice()
  const R = 2
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const a = src[i + 3] ?? 0
      if (a === 0 || a >= 250) continue
      let n = 0
      let sr = 0
      let sg = 0
      let sb = 0
      for (let dy = -R; dy <= R; dy += 1) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -R; dx <= R; dx += 1) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const j = (yy * width + xx) * 4
          if ((src[j + 3] ?? 0) < 250) continue
          sr += src[j] ?? 0
          sg += src[j + 1] ?? 0
          sb += src[j + 2] ?? 0
          n += 1
        }
      }
      if (n === 0) continue
      data[i] = Math.round((src[i] ?? 0) + (sr / n - (src[i] ?? 0)) * s)
      data[i + 1] = Math.round((src[i + 1] ?? 0) + (sg / n - (src[i + 1] ?? 0)) * s)
      data[i + 2] = Math.round((src[i + 2] ?? 0) + (sb / n - (src[i + 2] ?? 0)) * s)
    }
  }
}

// ── 마스크 안에서 흐리기 ────────────────────────────────────────────────────

function boxPass(values: Float32Array, weights: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const n = horizontal ? w : h
  const m = horizontal ? h : w
  const vs = new Float32Array(n)
  const ws = new Float32Array(n)
  for (let k = 0; k < m; k += 1) {
    for (let t = 0; t < n; t += 1) {
      const idx = horizontal ? k * w + t : t * w + k
      vs[t] = values[idx]!
      ws[t] = weights[idx]!
    }
    let sv = 0
    let sw = 0
    for (let t = -r; t <= r; t += 1) {
      const c = Math.min(n - 1, Math.max(0, t))
      sv += vs[c]!
      sw += ws[c]!
    }
    for (let t = 0; t < n; t += 1) {
      const idx = horizontal ? k * w + t : t * w + k
      values[idx] = sv
      weights[idx] = sw
      const out = Math.max(0, t - r)
      const inn = Math.min(n - 1, t + r + 1)
      sv += vs[inn]! - vs[out]!
      sw += ws[inn]! - ws[out]!
    }
  }
}

/**
 * `mask`가 1인 자리의 값만으로 흐린 평균을 낸다 (상자 흐림 3번 ≈ 가우스).
 * 마스크 밖도 채워진다 — 가장 가까운 안쪽 값들의 평균으로. 무게가 0인 곳은 `NaN`.
 */
export function blurMasked(values: Float32Array, mask: Float32Array, w: number, h: number, radius: number): Float32Array {
  const v = new Float32Array(values.length)
  const m = new Float32Array(mask.length)
  for (let i = 0; i < v.length; i += 1) {
    m[i] = mask[i]!
    v[i] = values[i]! * mask[i]!
  }
  const r = Math.max(1, Math.round(radius / 1.7))
  for (let pass = 0; pass < 3; pass += 1) {
    boxPass(v, m, w, h, r, true)
    boxPass(v, m, w, h, r, false)
  }
  const out = new Float32Array(v.length)
  for (let i = 0; i < out.length; i += 1) out[i] = m[i]! > 1e-6 ? v[i]! / m[i]! : Number.NaN
  return out
}

// ── 빛 뽑기 ────────────────────────────────────────────────────────────────

/**
 * Klein이 빛을 입힌 덩어리(제품 좌표로 옮겨 온 RGBA)에서 빛 층을 만든다.
 *
 * `alpha`는 제품 누끼의 알파다. 가장자리 `inset`px 안쪽에서만 읽고 바깥은 넓혀
 * 채운다 — Klein이 덩어리를 조금 작게 그리면 가장자리에 배경색이 섞이기 때문이다
 * (§11 v1의 빨간 띠). 가장 밝은 5%가 원래 밝기를 지키도록 맞춘다 — 명암의
 * **차이**만 옮긴다 (§11 v2, relative).
 */
export function lightLayerFrom(
  lit: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  options: { inset: number; blur: number },
): Uint8ClampedArray {
  const n = w * h
  const solid = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) solid[i] = (alpha[i] ?? 0) > 128 ? 1 : 0
  // 안쪽으로 깎기 — 거리 변환 대신 상자 흐림의 임계로 가늠한다.
  const sm = new Float32Array(n)
  for (let i = 0; i < n; i += 1) sm[i] = solid[i]!
  const ones = new Float32Array(n).fill(1)
  const eroded = blurMasked(sm, ones, w, h, options.inset)
  const core = new Float32Array(n)
  let coreCount = 0
  for (let i = 0; i < n; i += 1) {
    core[i] = eroded[i]! > 0.985 ? 1 : 0
    coreCount += core[i]!
  }
  if (coreCount < 16) for (let i = 0; i < n; i += 1) core[i] = solid[i]!

  const lum = new Float32Array(n)
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  for (let i = 0; i < n; i += 1) {
    const r = lit[i * 4] ?? 0
    const g = lit[i * 4 + 1] ?? 0
    const b = lit[i * 4 + 2] ?? 0
    lum[i] = (r + g + b) / 3
    ch[0]![i] = r
    ch[1]![i] = g
    ch[2]![i] = b
  }
  const L = blurMasked(lum, core, w, h, options.blur)
  const C = ch.map((c) => blurMasked(c, core, w, h, options.blur * 1.7))

  // 가장 밝은 5%
  const vals: number[] = []
  for (let i = 0; i < n; i += 1) if (core[i]! > 0 && Number.isFinite(L[i]!)) vals.push(L[i]!)
  vals.sort((a, b) => a - b)
  const p95 = vals.length === 0 ? PROBE_GREY : vals[Math.floor(vals.length * 0.95)]!
  const norm = Math.max(1, p95)

  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i += 1) {
    const base = Number.isFinite(L[i]!) ? L[i]! / norm : 1
    const g = Math.max(GAIN_MIN, Math.min(GAIN_MAX, base))
    const mean = ((C[0]![i] ?? 0) + (C[1]![i] ?? 0) + (C[2]![i] ?? 0)) / 3
    for (let c = 0; c < 3; c += 1) {
      const raw = Number.isFinite(C[c]![i]!) && mean > 1 ? C[c]![i]! / mean : 1
      const tint = 1 + Math.max(-GAIN_CHROMA_MAX, Math.min(GAIN_CHROMA_MAX, raw - 1))
      out[i * 4 + c] = encodeGain(g * tint)
    }
    out[i * 4 + 3] = 255
  }
  return out
}

// ── 크기 어긋남 찾기 ────────────────────────────────────────────────────────

/** 한 축의 윤곽선 분포 — 그 축을 따라 밝기 변화의 합. */
export function edgeProfile(gray: Float32Array, w: number, h: number, axis: 'x' | 'y'): Float32Array {
  if (axis === 'x') {
    const p = new Float32Array(w)
    for (let y = 0; y < h; y += 1) for (let x = 1; x < w; x += 1) p[x]! += Math.abs(gray[y * w + x]! - gray[y * w + x - 1]!)
    return p
  }
  const p = new Float32Array(h)
  for (let y = 1; y < h; y += 1) for (let x = 0; x < w; x += 1) p[y]! += Math.abs(gray[y * w + x]! - gray[(y - 1) * w + x]!)
  return p
}

function corr(a: number[], b: number[]): number {
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i += 1) {
    ma += a[i]!
    mb += b[i]!
  }
  ma /= n
  mb /= n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - ma
    const db = b[i]! - mb
    sab += da * db
    saa += da * da
    sbb += db * db
  }
  return saa === 0 || sbb === 0 ? 0 : sab / Math.sqrt(saa * sbb)
}

export interface AxisFit {
  /** 결과 좌표 = scale × 입력 좌표 + offset (분포의 칸 단위). */
  scale: number
  offset: number
  score: number
}

/** 입력 분포 `p`가 결과 분포 `r`에서 어디에 얼마나 늘어나 있는지 찾는다. */
export function fitAxis(p: Float32Array, r: Float32Array, range = 0.06): AxisFit {
  const L = p.length
  let best: AxisFit = { scale: 1, offset: 0, score: -2 }
  for (let s = 1 - range; s <= 1 + range + 1e-9; s += 0.002) {
    for (let o = -range * L; o <= range * L + 1e-9; o += 0.5) {
      const a: number[] = []
      const b: number[] = []
      for (let x = 0; x < L; x += 1) {
        const q = s * x + o
        if (q < 0 || q > r.length - 1) continue
        const q0 = Math.floor(q)
        const t = q - q0
        a.push(p[x]!)
        b.push(r[q0]! * (1 - t) + (r[Math.min(r.length - 1, q0 + 1)] ?? 0) * t)
      }
      if (a.length < L * 0.8) continue
      const c = corr(a, b)
      if (c > best.score) best = { scale: s, offset: o, score: c }
    }
  }
  return best
}

export interface ProbeFit {
  x: AxisFit
  y: AxisFit
  /** 믿을 만한가 — 아니면 Klein이 장면을 새로 그린 것이다. */
  ok: boolean
}

/**
 * 판정 기준 (2026-09-17, 7장): 되돌려 쓸 수 있었던 결과는 가로 상관 0.51~0.85·
 * 세로 0.81~0.96, 장면을 새로 만든 결과는 0.37·0.22였다. 0.51은 조명 컨셉을 줘서
 * 장면 밝기가 크게 바뀐 경우다 — 제품 자리는 제대로 맞았다.
 */
export const FIT_MIN_SCORE_X = 0.45
export const FIT_MIN_SCORE_Y = 0.6

export function fitProbe(probe: Float32Array, result: Float32Array, w: number, h: number): ProbeFit {
  const x = fitAxis(edgeProfile(probe, w, h, 'x'), edgeProfile(result, w, h, 'x'))
  const y = fitAxis(edgeProfile(probe, w, h, 'y'), edgeProfile(result, w, h, 'y'))
  return { x, y, ok: x.score >= FIT_MIN_SCORE_X && y.score >= FIT_MIN_SCORE_Y }
}
