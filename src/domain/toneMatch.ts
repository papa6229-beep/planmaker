/**
 * "배경에 맞추기" — 제품의 레벨 값을 주변 배경에서 채운다 (후보정 창 Patch, 2026-09-17).
 *
 * 사용자는 빛 맞추기를 버리고 레벨·커브로 제품을 배경에 맞춘다. 매번 0에서
 * 맞추는 수고를 줄이려고, **주변 배경의 밝기·색·대비를 재서 레벨 숫자만** 채운다.
 * 그림을 새로 그리지 않으므로(빛 층과 다르다) 둥근 제품에 네모 자국이 생길 일이
 * 없고, 채운 값은 레벨 그래프에서 그대로 다듬는다. AI 호출은 없다.
 *
 * 제품 색을 뭉개지 않는 것이 먼저다. 그래서 배경 쪽으로 **일부만** 당긴다:
 * 밝기는 60%, 색 기운은 35%. 감마는 좁은 범위에 가둔다.
 */

import type { ChannelLevels, ToneLevels } from './toneCurve'

export interface ToneStats {
  /** 채널 평균 0..255 (r, g, b). */
  mean: [number, number, number]
  /** 밝기 평균 0..255. */
  lum: number
  /** 밝기 5·95 백분위 0..255. */
  low: number
  high: number
  /** 잰 픽셀 수. 0이면 잴 것이 없었다. */
  count: number
}

const lumOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * RGBA 픽셀에서 잰다. 반투명 가장자리는 덜 센다(알파 가중). `skip`이 참인 자리는
 * 세지 않는다 — 배경을 잴 때 제품 자리를 빼려고.
 */
export function toneStatsOf(
  data: Uint8ClampedArray,
  width: number,
  skip?: (x: number, y: number) => boolean,
): ToneStats {
  const hist = new Float64Array(256)
  let r = 0
  let g = 0
  let b = 0
  let w = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255
    if (a < 0.5) continue
    if (skip !== undefined) {
      const p = i / 4
      if (skip(p % width, Math.floor(p / width))) continue
    }
    r += data[i]! * a
    g += data[i + 1]! * a
    b += data[i + 2]! * a
    w += a
    hist[Math.round(lumOf(data[i]!, data[i + 1]!, data[i + 2]!))]! += a
  }
  if (w === 0) return { mean: [0, 0, 0], lum: 0, low: 0, high: 0, count: 0 }
  const pct = (q: number) => {
    let acc = 0
    for (let v = 0; v < 256; v += 1) {
      acc += hist[v]!
      if (acc >= q * w) return v
    }
    return 255
  }
  const mean: [number, number, number] = [r / w, g / w, b / w]
  return { mean, lum: lumOf(...mean), low: pct(0.05), high: pct(0.95), count: Math.round(w) }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round2 = (v: number) => Math.round(v * 100) / 100

/** 평균 `from`이 `to`가 되는 레벨 감마 (`out = in^(1/gamma)`). */
function gammaFor(from: number, to: number, lo: number, hi: number): number {
  const f = clamp(from / 255, 0.02, 0.98)
  const t = clamp(to / 255, 0.02, 0.98)
  return round2(clamp(Math.log(f) / Math.log(t), lo, hi))
}

export const MATCH_LUM = 0.6
export const MATCH_TINT = 0.35

/**
 * 제품 통계와 주변 배경 통계로 레벨 값을 만든다. 잴 것이 없으면 `null`.
 *
 * - **rgb 채널**: 감마로 밝기를 배경 쪽으로. 배경이 어둡게 눌려 있으면 흰점을
 *   낮추고, 뿌옇게 떠 있으면 검정점을 올린다 — 제품만 쨍하게 떠 보이지 않게.
 * - **r·g·b 채널**: 배경의 색 기운(밝기 대비 채널 비)을 조금 옮긴다.
 */
export function matchLevels(object: ToneStats, around: ToneStats): ToneLevels | null {
  if (object.count === 0 || around.count === 0) return null

  const targetLum = object.lum + (around.lum - object.lum) * MATCH_LUM
  const outWhite = Math.round(clamp(255 - (255 - around.high) * 0.4, 190, 255))
  const outBlack = Math.round(clamp((around.low - object.low) * 0.4, 0, 50))
  const rgb: ChannelLevels = {
    inBlack: 0,
    inWhite: 255,
    gamma: gammaFor(object.lum, targetLum, 0.55, 1.8),
    outBlack,
    outWhite,
  }

  const levels: ToneLevels = { rgb }
  const names = ['r', 'g', 'b'] as const
  names.forEach((name, i) => {
    const objRatio = object.mean[i]! / Math.max(1, object.lum)
    const bgRatio = around.mean[i]! / Math.max(1, around.lum)
    const to = object.mean[i]! * (1 + (bgRatio - objRatio) * MATCH_TINT)
    const gamma = gammaFor(object.mean[i]!, to, 0.8, 1.25)
    if (gamma !== 1) levels[name] = { inBlack: 0, inWhite: 255, gamma, outBlack: 0, outWhite: 255 }
  })
  return levels
}
