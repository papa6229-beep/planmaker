/**
 * "배경에 맞추기" 계산 (후보정 창 Patch, 2026-09-17).
 *
 * 제품 색을 뭉개지 않고 주변 쪽으로 **일부만** 당기는지 숫자로 본다.
 */

import { describe, expect, it } from 'vitest'
import { matchLevels, toneStatsOf, MATCH_LUM } from '../domain/toneMatch'
import { levelsLut } from '../domain/toneCurve'

function solid(w: number, h: number, rgb: [number, number, number], alpha = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
    data[i + 3] = alpha
  }
  return data
}

describe('통계', () => {
  it('투명한 곳과 빼라는 자리는 세지 않는다', () => {
    const data = solid(4, 1, [200, 200, 200])
    data[3] = 0 // 첫 칸 투명
    data[4] = 0 // 둘째 칸은 검정이지만 뺀다
    data[5] = 0
    data[6] = 0
    const s = toneStatsOf(data, 4, (x) => x === 1)
    expect(s.count).toBe(2)
    expect(s.lum).toBeCloseTo(200, 0)
    expect(toneStatsOf(solid(2, 2, [0, 0, 0], 0), 2).count).toBe(0)
  })
})

describe('레벨 채우기', () => {
  const bright = toneStatsOf(solid(8, 8, [220, 220, 220]), 8)
  const dark = toneStatsOf(solid(8, 8, [60, 60, 60]), 8)

  it('어두운 배경에서는 제품을 어둡게 — 다만 일부만', () => {
    const levels = matchLevels(bright, dark)!
    const lut = levelsLut(levels.rgb!)
    const after = lut[220]!
    expect(after).toBeLessThan(220)
    // 배경 밝기(60)까지 내려가지는 않는다.
    const target = 220 + (60 - 220) * MATCH_LUM
    expect(after).toBeGreaterThan(60)
    expect(Math.abs(after - target)).toBeLessThan(40)
    // 어두운 배경이라 흰점도 내려간다.
    expect(levels.rgb!.outWhite).toBeLessThan(255)
  })

  it('밝은 배경에서는 밝게', () => {
    const levels = matchLevels(dark, bright)!
    expect(levelsLut(levels.rgb!)[60]!).toBeGreaterThan(60)
  })

  it('배경의 색 기운을 조금 옮긴다 — 푸른 배경이면 파랑이 오르고 빨강이 내린다', () => {
    const grey = toneStatsOf(solid(8, 8, [150, 150, 150]), 8)
    const blue = toneStatsOf(solid(8, 8, [110, 140, 210]), 8)
    const levels = matchLevels(grey, blue)!
    expect(levels.b!.gamma).toBeGreaterThan(1)
    expect(levels.r!.gamma).toBeLessThan(1)
    // 감마는 좁은 범위에 갇힌다 — 제품 색을 뭉개지 않는다.
    for (const c of ['r', 'g', 'b'] as const) {
      const g = levels[c]?.gamma ?? 1
      expect(g).toBeGreaterThanOrEqual(0.8)
      expect(g).toBeLessThanOrEqual(1.25)
    }
  })

  it('잴 것이 없으면 아무것도 만들지 않는다', () => {
    const empty = toneStatsOf(solid(2, 2, [0, 0, 0], 0), 2)
    expect(matchLevels(empty, bright)).toBeNull()
    expect(matchLevels(bright, empty)).toBeNull()
  })
})
