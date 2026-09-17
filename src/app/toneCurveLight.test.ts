/**
 * 레벨·커브 (톤 곡선 Patch)와 빛 층의 규칙 (빛 층 Patch), 2026-09-17.
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
import {
  applyLightLayer,
  blurMasked,
  decodeGain,
  defringe,
  encodeGain,
  fitAxis,
  lightKeyOf,
  lightLayerFrom,
} from '../domain/lightLayer'
import { normalizeEffects } from '../domain/compositeEffects'

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

describe('빛 층', () => {
  it('배율 인코딩은 0..2', () => {
    expect(decodeGain(encodeGain(1))).toBeCloseTo(1, 1)
    expect(decodeGain(encodeGain(1.5))).toBeCloseTo(1.5, 1)
    expect(encodeGain(3)).toBe(255)
  })

  it('배율 1은 제품을 바꾸지 않고, 1보다 작으면 어둡게, 크면 밝게', () => {
    const product = new Uint8ClampedArray([100, 150, 200, 255, 100, 150, 200, 255, 100, 150, 200, 255])
    const light = new Uint8ClampedArray([
      encodeGain(1), encodeGain(1), encodeGain(1), 255,
      encodeGain(0.5), encodeGain(0.5), encodeGain(0.5), 255,
      encodeGain(1.4), encodeGain(1.4), encodeGain(1.4), 255,
    ])
    applyLightLayer(product, light, 1)
    expect(Math.abs(product[0]! - 100)).toBeLessThanOrEqual(1)
    expect(product[4]!).toBeLessThan(60)
    expect(product[8]!).toBeGreaterThan(100)
    expect(product[3]).toBe(255)
  })

  it('세기 0이면 손대지 않는다', () => {
    const product = new Uint8ClampedArray([100, 150, 200, 255])
    applyLightLayer(product, new Uint8ClampedArray([10, 10, 10, 255]), 0)
    expect([...product]).toEqual([100, 150, 200, 255])
  })

  it('덩어리의 가장 밝은 곳이 원래 밝기를 지키고(relative), 색은 조금만 받는다', () => {
    const w = 20
    const h = 20
    const lit = new Uint8ClampedArray(w * h * 4)
    const alpha = new Uint8ClampedArray(w * h).fill(255)
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4
        const v = x < 10 ? 200 : 100 // 왼쪽 밝고 오른쪽 어둡다
        lit[i] = v * 1.5 > 255 ? 255 : v * 1.5 // 붉은 기
        lit[i + 1] = v
        lit[i + 2] = v
        lit[i + 3] = 255
      }
    const layer = lightLayerFrom(lit, alpha, w, h, { inset: 1, blur: 1 })
    const gainAt = (x: number, c: number) => decodeGain(layer[(10 * w + x) * 4 + c]!)
    expect(gainAt(2, 1)).toBeGreaterThan(gainAt(17, 1))
    expect(gainAt(2, 1)).toBeLessThanOrEqual(1.2)
    // 붉은 기는 12%까지만
    expect(gainAt(17, 0) / gainAt(17, 1)).toBeLessThanOrEqual(1.12 / 0.88 + 0.02)
  })

  it('자리 열쇠는 1px 흔들림을 무시한다', () => {
    expect(lightKeyOf({ x: 10, y: 20, width: 100, height: 200 }, 0)).toBe(lightKeyOf({ x: 10.6, y: 20.4, width: 100, height: 200 }, 0))
    expect(lightKeyOf({ x: 10, y: 20, width: 100, height: 200 }, 0)).not.toBe(lightKeyOf({ x: 40, y: 20, width: 100, height: 200 }, 0))
  })

  it('빛 층은 그림이 있어야 켜진다 — 예전 파일은 꺼짐', () => {
    expect(normalizeEffects({ light: true }).light).toBe(false)
    const on = normalizeEffects({ light: true, lightAssetId: 'asset_l', lightKey: 'k', lightStrength: 3 })
    expect(on).toMatchObject({ light: true, lightAssetId: 'asset_l', lightKey: 'k', lightStrength: 1 })
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

describe('마스크 안에서 흐리기', () => {
  it('마스크 밖 값은 섞이지 않는다', () => {
    const w = 10
    const h = 1
    const v = new Float32Array([10, 10, 10, 10, 10, 999, 999, 999, 999, 999])
    const m = new Float32Array([1, 1, 1, 1, 1, 0, 0, 0, 0, 0])
    const out = blurMasked(v, m, w, h, 3)
    for (let i = 0; i < 10; i += 1) expect(out[i]!).toBeCloseTo(10, 3)
  })
})

describe('크기 어긋남 찾기', () => {
  it('2% 줄어든 분포를 찾는다', () => {
    const L = 200
    const p = new Float32Array(L)
    for (let i = 0; i < L; i += 1) p[i] = Math.sin(i / 7) * 10 + (i % 37 === 0 ? 40 : 0) + 50
    const r = new Float32Array(L)
    const s = 0.98
    const o = 3
    for (let x = 0; x < L; x += 1) {
      // r(s·x + o) = p(x)
      const q = Math.round(s * x + o)
      if (q >= 0 && q < L) r[q] = p[x]!
    }
    for (let i = 1; i < L; i += 1) if (r[i] === 0) r[i] = r[i - 1]!
    const fit = fitAxis(p, r)
    expect(fit.scale).toBeCloseTo(0.98, 2)
    expect(fit.offset).toBeCloseTo(3, 0)
    expect(fit.score).toBeGreaterThan(0.9)
  })
})
