/**
 * 문구의 겉모양 (살아 있는 문구 Patch, 2026-09-17).
 *
 * 사용자: "텍스트의 기본값은 없어야지." 고르지 않은 것은 꾸밈 없는 검정 글자이고,
 * 캔버스(CSS)와 완성본(판)이 같은 값을 쓴다.
 */

import { describe, expect, it } from 'vitest'
import { cssLookOf, DEFAULT_TEXT_LOOK, lookIsPlain, normalizeTextLook, plateStyleOf } from '../domain/textLook'
import { liveInputOf } from '../features/studio/LiveTextSync'
import { liveKeyOf } from '../features/studio/liveText'
import { createStudioJob } from '../domain/studioJob'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'

describe('기본값은 꾸밈 없음', () => {
  it('아무것도 없으면 검정 단색, 테두리·그림자 꺼짐', () => {
    const look = normalizeTextLook(undefined)
    expect(look).toEqual(DEFAULT_TEXT_LOOK)
    expect(look.color).toBe('#111111')
    expect(lookIsPlain(look)).toBe(true)
    const plate = plateStyleOf(look)
    expect(plate.strokeRatio).toBe(0)
    expect(plate.shadowRatio).toBe(0)
    expect(plate.fills).toEqual(['#111111'])
  })

  it('이상한 값은 좁힌다', () => {
    const look = normalizeTextLook({ color: 'red', outline: 'yes', outlineWidth: 9, shadowDistance: -1, fill: 'rainbow' })
    expect(look.color).toBe('#111111')
    expect(look.outline).toBe(false)
    expect(look.outlineWidth).toBe(0.2)
    expect(look.shadowDistance).toBe(0.01)
    expect(look.fill).toBe('solid')
  })
})

describe('캔버스와 판이 같은 값을 쓴다', () => {
  const look = normalizeTextLook({
    fill: 'gradient', color: '#FF0000', color2: '#0000ff',
    outline: true, outlineColor: '#ffffff', outlineWidth: 0.1,
    shadow: true, shadowColor: '#000000', shadowDistance: 0.05,
  })

  it('판: 두께·거리는 글자 크기 비율 그대로, 그라데이션은 두 색', () => {
    const plate = plateStyleOf(look)
    expect(plate.fill).toBe('gradient')
    expect(plate.fills).toEqual(['#ff0000', '#0000ff'])
    expect(plate.strokeRatio).toBe(0.1)
    expect(plate.shadowRatio).toBe(0.05)
  })

  it('CSS: 그라데이션이면 테두리·그림자를 밑 겹에 그린다', () => {
    const css = cssLookOf(look, 40)
    expect(css.text.backgroundImage).toContain('#ff0000')
    expect(css.text.textShadow).toBeUndefined()
    expect(css.under?.textShadow).toContain('#ffffff')
    expect(css.under?.textShadow).toContain('#000000')
    // 테두리 반지름 = 40 × 0.1 = 4px
    expect(css.under?.textShadow).toContain('4.00px 0.00px 0 #ffffff')
  })

  it('CSS: 단색이면 한 겹이고, 꾸밈이 없으면 그림자도 없다', () => {
    const solid = cssLookOf({ ...look, fill: 'solid' }, 40)
    expect(solid.under).toBeNull()
    expect(solid.text.textShadow).toContain('#ffffff')
    const plain = cssLookOf(DEFAULT_TEXT_LOOK, 40)
    expect(plain.text).toEqual({ color: '#111111' })
  })
})

describe('다시 그릴 재료', () => {
  const doc = createEmptyDocument(createEmptyProject('시험'))
  doc.pages[0]!.blocks = [
    createBlock('free_text', { id: 'blk_a', content: '여름 세일', position: { x: 0, y: 0, width: 300, height: 80 } }),
  ]
  const base = createStudioJob(doc, 1, 'job')
  const job = { ...base, blockOrders: { blk_a: { fontFamily: '글꼴A' }, blk_banner: { fontFamily: '글꼴B' } } }
  const object = { blockId: 'blk_a', assetId: 'x', rect: { x: 0, y: 0, width: 10, height: 10 }, layer: 0 }

  it('기획서 블록이 있으면 그 문구, 없으면(배너 조각) 그릴 때 적어 둔 문구', () => {
    expect(liveInputOf(object, job, doc)?.text).toBe('여름 세일')
    const banner = { ...object, blockId: 'blk_banner', text: '배너 문구', lines: ['배너 문구'] }
    expect(liveInputOf(banner, job, doc)).toMatchObject({ text: '배너 문구', lines: ['배너 문구'], family: '글꼴B' })
  })

  it('글꼴이 없으면 그리지 않는다', () => {
    // 검사 준비가 모든 블록에 시험 글꼴을 고른 것으로 둔다 — 여기서는 끈다.
    const G = globalThis as { __noTestFont?: boolean }
    G.__noTestFont = true
    try {
      expect(liveInputOf({ ...object, blockId: 'blk_none', text: '글' }, job, doc)).toBeNull()
    } finally {
      G.__noTestFont = false
    }
  })

  it('지문은 꾸밈이 바뀌면 달라지고, 같은 값이면 같다', () => {
    const input = liveInputOf(object, job, doc)!
    expect(liveKeyOf(input)).toBe(liveKeyOf({ ...input }))
    expect(liveKeyOf(input)).not.toBe(liveKeyOf({ ...input, look: { ...DEFAULT_TEXT_LOOK, outline: true } }))
    expect(liveKeyOf(input)).not.toBe(liveKeyOf({ ...input, weight: 900 }))
    // 꾸밈 없음과 기본 꾸밈은 같은 그림이다.
    expect(liveKeyOf(input)).toBe(liveKeyOf({ ...input, look: DEFAULT_TEXT_LOOK }))
  })
})
