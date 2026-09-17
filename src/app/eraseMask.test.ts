/** 지우개의 규칙 (지우개 Patch, 2026-09-17). 화면 흐름은 textLayers §26. */
import { describe, expect, it } from 'vitest'
import {
  clampEraser,
  dabsBetween,
  localPoint,
  maskSizeFor,
  readEraseMasks,
  brushProfile,
  brushStops,
  stepEraserSize,
  DEFAULT_ERASER,
} from '../domain/eraseMask'
import { compositeAssetIds, compositeMaskIds, planLocalComposite } from '../domain/composite'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'

describe('§E1 조각 안의 자리', () => {
  it('maps page points into the piece box, undoing rotation around its centre', () => {
    const rect = { x: 100, y: 100, width: 200, height: 100 }
    expect(localPoint(rect, 0, { x: 100, y: 100 })).toEqual({ u: 0, v: 0 })
    expect(localPoint(rect, 0, { x: 300, y: 150 })).toEqual({ u: 1, v: 0.5 })
    // 90° 돌린 조각: 화면의 오른쪽 아래로 간 점이 조각의 오른쪽 위 구석이다.
    const p = localPoint(rect, 90, { x: 250, y: 250 })
    expect(p.u).toBeCloseTo(1)
    expect(p.v).toBeCloseTo(0)
  })

  it('sizes the mask to the box aspect, longest side 1024', () => {
    expect(maskSizeFor({ width: 200, height: 100 })).toEqual({ width: 1024, height: 512 })
    expect(maskSizeFor({ width: 10, height: 400 })).toEqual({ width: 26, height: 1024 })
  })
})

describe('§E2 붓', () => {
  it('clamps settings and steps sizes like [ ]', () => {
    expect(clampEraser({ size: 1000, hardness: 2, strength: 0 })).toEqual({ size: 400, hardness: 1, strength: 0.05, restore: false })
    expect(clampEraser({ size: Number.NaN }, DEFAULT_ERASER).size).toBe(DEFAULT_ERASER.size)
    expect(stepEraserSize(40, 1)).toBe(45)
    expect(stepEraserSize(5, -1)).toBe(4)
    expect(stepEraserSize(2, -1)).toBe(2)
    expect(stepEraserSize(400, 1)).toBe(400)
  })

  it('spaces dabs at a quarter of the diameter', () => {
    const dabs = dabsBetween({ x: 0, y: 0 }, { x: 100, y: 0 }, 40)
    expect(dabs).toHaveLength(10)
    expect(dabs.at(-1)).toEqual({ x: 100, y: 0 })
  })

  it('reads only string masks from a file', () => {
    expect(readEraseMasks({ a: 'm1', b: 3, c: '' })).toEqual({ a: 'm1' })
    expect(readEraseMasks(null)).toEqual({})
  })
})

describe('§E3 합치기 계획', () => {
  it('carries masks for image layers and text pieces and asks to load them', () => {
    const doc = createEmptyDocument(createEmptyProject('지우개'))
    const page = doc.pages[0]!
    page.blocks = [createBlock('main_product_image', { id: 'img', position: { x: 0, y: 0, width: 100, height: 100 } })]
    const plan = planLocalComposite({
      page,
      background: { assetId: 'bg', source: 'ai' },
      textObjects: [{ assetId: 'txt', rect: { x: 0, y: 0, width: 10, height: 10 }, order: 1, maskAssetId: 'm_txt' }],
      productImages: { img: 'photo' },
      effects: {},
      grain: 0,
      eraseMasks: { img: 'm_img' },
      includeTexts: false,
    })
    expect(plan.layers[0]!.maskAssetId).toBe('m_img')
    expect(compositeMaskIds(plan).toSorted()).toEqual(['m_img', 'm_txt'])
    expect(compositeAssetIds(plan)).toEqual(expect.arrayContaining(['photo', 'bg', 'txt', 'm_img', 'm_txt']))
  })
})

describe('§E4 부드러운 가장자리', () => {
  it('stays full inside the hardness and fades smoothly, long and faint towards the rim', () => {
    expect(brushProfile(0, 0)).toBe(1)
    expect(brushProfile(1, 0)).toBe(0)
    expect(brushProfile(0.3, 0.5)).toBe(1)
    // 경도 0: 반지름의 절반에서 절반 아래, 바깥 1/4은 옅게 남는다 — 직선(0.5, 0.25)보다 은은하다.
    expect(brushProfile(0.5, 0)).toBeLessThan(0.5)
    expect(brushProfile(0.75, 0)).toBeLessThan(0.2)
    expect(brushProfile(0.75, 0)).toBeGreaterThan(0.05)
    // 한가운데에서 멀어질수록 줄기만 한다.
    let prev = 1
    for (let t = 0; t <= 1; t += 0.05) {
      const v = brushProfile(t, 0.2)
      expect(v).toBeLessThanOrEqual(prev + 1e-9)
      prev = v
    }
  })

  it('lays gradient stops from centre to rim', () => {
    const stops = brushStops(0.4)
    expect(stops[0]).toEqual({ at: 0, value: 1 })
    expect(stops[1]).toEqual({ at: 0.4, value: 1 })
    expect(stops.at(-1)).toEqual({ at: 1, value: 0 })
    expect(stops.every((s, i) => i === 0 || s.at >= stops[i - 1]!.at)).toBe(true)
  })
})
