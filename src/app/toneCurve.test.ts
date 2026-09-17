/**
 * 레벨·커브 (톤 곡선 Patch)와 가장자리 흰 매트 걷기, 2026-09-17.
 */

import { describe, expect, it } from 'vitest'
import {
  curveLut,
  histogramOf,
  levelsLut,
  normalizeCurve,
  normalizeCurves,
  normalizeToneLevels,
  toneLuts,
} from '../domain/toneCurve'
import { RESET_TONE, applyTone, normalizeTone, toneIsFlat } from '../domain/toneAdjust'
import { defringe } from '../domain/edgeMatte'

describe('커브', () => {
  it('양 끝만 있으면 그대로', () => {
    const lut = curveLut([
      [0, 0],
      [255, 255],
    ])
    for (let i = 0; i < 256; i += 17) expect(lut[i]).toBe(i)
  })

  it('가운데를 올리면 밝아지고, 점을 지나며, 넘치지 않는다 (단조)', () => {
    const lut = curveLut([
      [0, 0],
      [128, 180],
      [255, 255],
    ])
    expect(lut[128]).toBe(180)
    expect(lut[64]!).toBeGreaterThan(64)
    for (let i = 1; i < 256; i += 1) expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!)
  })

  it('점 정리 — 순서·중복·양 끝', () => {
    expect(normalizeCurve([[200, 10], [50, 60], [50, 70]])).toEqual([
      [0, 0],
      [50, 70],
      [200, 10],
      [255, 255],
    ])
    expect(normalizeCurve('x')).toEqual([
      [0, 0],
      [255, 255],
    ])
  })

  it('손대지 않은 채널은 저장하지 않는다', () => {
    expect(normalizeCurves({ rgb: [[0, 0], [255, 255]] })).toBeUndefined()
    expect(normalizeCurves({ r: [[0, 0], [128, 150], [255, 255]] })).toEqual({
      r: [
        [0, 0],
        [128, 150],
        [255, 255],
      ],
    })
  })
})

describe('레벨', () => {
  it('입력 검정·흰점이 대비를 넓힌다', () => {
    const lut = levelsLut({ inBlack: 50, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 })
    expect(lut[50]).toBe(0)
    expect(lut[200]).toBe(255)
    expect(lut[30]).toBe(0)
    expect(lut[125]).toBe(128)
  })

  it('중간톤 >1이면 밝아진다 (포토샵과 같은 방향)', () => {
    const lut = levelsLut({ inBlack: 0, inWhite: 255, gamma: 2, outBlack: 0, outWhite: 255 })
    expect(lut[64]!).toBeGreaterThan(64)
  })

  it('이상한 값은 걸러 내고, 손대지 않은 것은 저장하지 않는다', () => {
    expect(normalizeToneLevels({ rgb: { inBlack: 300, inWhite: -5 } })?.rgb?.inWhite).toBeGreaterThan(
      normalizeToneLevels({ rgb: { inBlack: 300, inWhite: -5 } })!.rgb!.inBlack,
    )
    expect(normalizeToneLevels({ rgb: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 } })).toBeUndefined()
  })

  it('채널 표는 레벨 → 커브 차례로 겹친다', () => {
    const luts = toneLuts(
      { rgb: [[0, 0], [128, 200], [255, 255]] },
      { r: { inBlack: 0, inWhite: 128, gamma: 1, outBlack: 0, outWhite: 255 } },
    )!
    // R: 64 → 레벨 128 → 커브 200
    expect(luts[0][64]).toBe(200)
    // G: 레벨 없음, 커브만
    expect(luts[1][128]).toBe(200)
    expect(toneLuts(undefined, undefined)).toBeNull()
  })
})

describe('톤 조절에 레벨·커브가 붙는다', () => {
  it('저장·되돌리기·평평함', () => {
    const t = normalizeTone({ brightness: 0, curves: { rgb: [[0, 0], [128, 160], [255, 255]] } })
    expect(toneIsFlat(t)).toBe(false)
    expect(toneIsFlat(normalizeTone({ ...t, ...RESET_TONE }))).toBe(true)
    // 예전 파일(칸 없음)은 평평하다
    expect(toneIsFlat(normalizeTone({ brightness: 0, contrast: 0, saturation: 0, temperature: 0 }))).toBe(true)
  })

  it('픽셀에 걸린다 — 투명한 픽셀은 지나친다', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 0])
    applyTone(data, normalizeTone({ curves: { rgb: [[0, 0], [128, 200], [255, 255]] } }))
    expect(Array.from(data.slice(0, 3))).toEqual([200, 200, 200])
    expect(Array.from(data.slice(4, 7))).toEqual([128, 128, 128])
  })

  it('히스토그램은 투명한 픽셀을 세지 않는다', () => {
    const h = histogramOf(new Uint8ClampedArray([10, 20, 30, 255, 200, 200, 200, 0]))
    expect(h.r[10]).toBe(1)
    expect(h.r[200]).toBe(0)
  })
})

describe('흰 매트 걷기', () => {
  it('반투명 가장자리의 흰색을 안쪽 색으로 당긴다', () => {
    // 3x1: [검정 불투명][흰색 반투명][투명]
    const data = new Uint8ClampedArray([20, 20, 20, 255, 230, 230, 230, 128, 255, 255, 255, 0])
    defringe(data, 3, 1, 1)
    expect(data[4]).toBe(20)
    expect(data[7]).toBe(128)
    // 불투명·투명은 그대로
    expect(data[0]).toBe(20)
    expect(data[8]).toBe(255)
  })
})
