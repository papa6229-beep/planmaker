/**
 * 문구의 겉모양과 문자 도구의 규칙 (살아 있는 문구 · 문자 도구 Patch, 2026-09-17).
 *
 * 사용자: "텍스트의 기본값은 없어야지." 고르지 않은 것은 꾸밈 없는 검정 가로 글자다.
 * 글자별 색·크기, 세로쓰기, 원호, 이중 테두리는 모두 순수 규칙으로 여기서 잰다.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_LOOK, lookIsPlain, normalizeTextLook, outlineReach, shadowOffset } from '../domain/textLook'
import {
  applyCharStyle,
  fitTextArtSize,
  layoutTextArt,
  mapLinesToContent,
  normalizeCharStyles,
  realignCharStyles,
  type MeasureGlyph,
} from '../domain/textArt'
import { liveInputOf } from '../features/studio/LiveTextSync'
import { liveKeyOf, placeInFrame, type LiveTextInput } from '../features/studio/liveText'
import { createStudioJob } from '../domain/studioJob'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'

/** 모든 글자가 크기만큼 넓은 가짜 자. */
const square: MeasureGlyph = (ch, font) => ({
  width: ch === ' ' ? font.size / 2 : font.size,
  ascent: font.size * 0.8,
  descent: font.size * 0.2,
})
const base = { family: 'A', weight: 700 }
const rowsOf = (text: string, lines = [text]) => mapLinesToContent(text, lines)

describe('기본값은 꾸밈 없음', () => {
  it('아무것도 없으면 검정 단색 가로쓰기, 테두리·그림자·휘기 없음', () => {
    const look = normalizeTextLook(undefined)
    expect(look).toEqual(DEFAULT_TEXT_LOOK)
    expect(look.color).toBe('#111111')
    expect(lookIsPlain(look)).toBe(true)
    expect(outlineReach(look)).toBe(0)
    expect(shadowOffset(look)).toEqual({ dx: 0, dy: 0 })
  })

  it('이상한 값은 좁힌다 — 예전(1판) 값도 그대로 읽힌다', () => {
    const look = normalizeTextLook({ color: 'red', outline: 'yes', outlineWidth: 9, arc: 5, lineHeight: 0, shadowAngle: -90 })
    expect(look.color).toBe('#111111')
    expect(look.outline).toBe(false)
    expect(look.outlineWidth).toBe(0.3)
    expect(look.arc).toBe(1)
    expect(look.lineHeight).toBe(0.7)
    expect(look.shadowAngle).toBe(270)
    const old = normalizeTextLook({ fill: 'gradient', color: '#FF0000', outline: true, shadow: true, shadowDistance: 0.05 })
    expect(old.fill).toBe('gradient')
    expect(old.color).toBe('#ff0000')
    expect(old.shadowAngle).toBe(45)
  })

  it('그림자는 각도대로 민다', () => {
    const right = shadowOffset(normalizeTextLook({ shadow: true, shadowAngle: 0, shadowDistance: 0.1 }))
    expect(right.dx).toBeCloseTo(0.1)
    expect(right.dy).toBeCloseTo(0)
    const down = shadowOffset(normalizeTextLook({ shadow: true, shadowAngle: 90, shadowDistance: 0.1 }))
    expect(down.dy).toBeCloseTo(0.1)
  })
})

describe('글자별 모양', () => {
  it('고른 글자에만 들어가고, null은 걷는다', () => {
    let styles = applyCharStyle(undefined, 5, 1, 3, { color: '#FF0000', scale: 1.5 })
    expect(styles).toEqual([null, { color: '#ff0000', scale: 1.5 }, { color: '#ff0000', scale: 1.5 }])
    styles = applyCharStyle(styles, 5, 2, 3, { color: null })
    expect(styles?.[2]).toEqual({ scale: 1.5 })
    // 크기 1은 모양이 아니다.
    expect(applyCharStyle(styles, 5, 0, 5, { scale: 1, color: null })).toBeUndefined()
  })

  it('문구가 바뀌면 앞뒤 같은 부분은 제 모양, 새 글자는 앞 글자의 모양', () => {
    const styles = normalizeCharStyles([{ color: '#ff0000' }, null, { color: '#0000ff' }])
    // "가나다" → "가X나다"
    expect(realignCharStyles('가나다', '가X나다', styles)).toEqual([
      { color: '#ff0000' },
      { color: '#ff0000' },
      null,
      { color: '#0000ff' },
    ])
    // 지우면 따라 줄어든다.
    expect(realignCharStyles('가나다', '가다', styles)).toEqual([{ color: '#ff0000' }, { color: '#0000ff' }])
    expect(realignCharStyles('가나다', '', styles)).toBeUndefined()
  })

  it('줄마다 문구의 몇 번째 글자인지 맞춘다 — 끊긴 빈칸은 건너뛴다', () => {
    const rows = mapLinesToContent('여름 세일\n특가', ['여름', '세일', '특가'])
    expect(rows.map((r) => r.map((c) => c.index))).toEqual([[0, 1], [3, 4], [6, 7]])
  })
})

describe('자리 잡기', () => {
  const look = normalizeTextLook(undefined)

  it('가로쓰기 — 크기 배수는 그 글자만 크게, 자간은 글자 사이만', () => {
    const plain = layoutTextArt({ rows: rowsOf('abc'), base, look, align: 'left', size: 100, measure: square })
    expect(plain.glyphs.map((g) => g.x)).toEqual([0, 100, 200])
    const styled = layoutTextArt({
      rows: rowsOf('abc'),
      base,
      chars: [null, { scale: 2 }],
      look: { ...look, letterSpacing: 0.1 },
      align: 'left',
      size: 100,
      measure: square,
    })
    expect(styled.glyphs.map((g) => g.x)).toEqual([0, 110, 320])
    expect(styled.glyphs[1]!.font.size).toBe(200)
    // 큰 글자에 맞춰 기준선이 내려온다.
    expect(styled.glyphs[0]!.y).toBe(160)
  })

  it('정렬은 줄마다 기댄다', () => {
    const center = layoutTextArt({ rows: rowsOf('ab\nabcd', ['ab', 'abcd']), base, look, align: 'center', size: 100, measure: square })
    expect(center.glyphs[0]!.x).toBe(-100)
    expect(center.glyphs[2]!.x).toBe(-200)
  })

  it('세로쓰기 — 위에서 아래로, 두 번째 줄은 왼쪽 열', () => {
    const v = layoutTextArt({
      rows: rowsOf('가나\n다', ['가나', '다']),
      base,
      look: { ...look, vertical: true },
      align: 'left',
      size: 100,
      measure: square,
    })
    const [a, b, c] = v.glyphs
    expect(a!.x).toBe(b!.x)
    expect(b!.y).toBeGreaterThan(a!.y)
    expect(c!.x).toBeLessThan(a!.x)
    expect(a!.rotate).toBe(0)
  })

  it('세로쓰기에서 영문을 눕히면 90도 돌고, 세우면 그대로', () => {
    const lying = layoutTextArt({
      rows: rowsOf('A'),
      base,
      look: { ...look, vertical: true, latinUpright: false },
      align: 'left',
      size: 100,
      measure: square,
    })
    expect(lying.glyphs[0]!.rotate).toBeCloseTo(Math.PI / 2)
    const upright = layoutTextArt({
      rows: rowsOf('A'),
      base,
      look: { ...look, vertical: true, latinUpright: true },
      align: 'left',
      size: 100,
      measure: square,
    })
    expect(upright.glyphs[0]!.rotate).toBe(0)
    // 장음은 세로쓰기에서 언제나 눕는다.
    const dash = layoutTextArt({ rows: rowsOf('ー'), base, look: { ...look, vertical: true }, align: 'left', size: 100, measure: square })
    expect(dash.glyphs[0]!.rotate).toBeCloseTo(Math.PI / 2)
  })

  it('원호 — 위로 볼록이면 가운데 글자가 가장 높고, 양 끝은 바깥으로 기운다', () => {
    const arc = layoutTextArt({ rows: rowsOf('abcde'), base, look: { ...look, arc: 0.5 }, align: 'center', size: 100, measure: square })
    const ys = arc.glyphs.map((g) => g.y)
    expect(ys[2]).toBe(Math.min(...ys))
    expect(arc.glyphs[0]!.rotate).toBeLessThan(0)
    expect(arc.glyphs[4]!.rotate).toBeGreaterThan(0)
    const down = layoutTextArt({ rows: rowsOf('abcde'), base, look: { ...look, arc: -0.5 }, align: 'center', size: 100, measure: square })
    const dys = down.glyphs.map((g) => g.y)
    expect(dys[2]).toBe(Math.max(...dys))
  })

  it('테두리·그림자는 여백으로 잡히고, 크기 맞춤은 그것까지 담는다', () => {
    const decorated = { ...look, outline: true, outlineWidth: 0.1, outline2: true, outline2Width: 0.1, shadow: true, shadowAngle: 0, shadowDistance: 0.2 }
    const at = layoutTextArt({ rows: rowsOf('ab'), base, look: decorated, align: 'left', size: 100, measure: square })
    expect(at.pad.left).toBeCloseTo(22)
    expect(at.pad.right).toBeCloseTo(42)
    const size = fitTextArtSize({ rows: rowsOf('ab'), base, look: decorated, align: 'left', measure: square }, { width: 500, height: 500 })
    const fitted = layoutTextArt({ rows: rowsOf('ab'), base, look: decorated, align: 'left', size, measure: square })
    const w = fitted.bounds.x1 - fitted.bounds.x0 + fitted.pad.left + fitted.pad.right
    expect(w).toBeLessThanOrEqual(500)
    expect(w).toBeGreaterThan(400)
  })
})

describe('다시 그릴 재료와 자리', () => {
  const doc = createEmptyDocument(createEmptyProject('시험'))
  doc.pages[0]!.blocks = [
    createBlock('free_text', { id: 'blk_a', content: '여름 세일', position: { x: 0, y: 0, width: 300, height: 80 } }),
  ]
  const base0 = createStudioJob(doc, 1, 'job')
  const job = { ...base0, blockOrders: { blk_a: { fontFamily: '글꼴A' }, blk_banner: { fontFamily: '글꼴B' } } }
  const object = { blockId: 'blk_a', assetId: 'x', rect: { x: 0, y: 0, width: 10, height: 10 }, layer: 0 }

  it('기획서 블록이 있으면 그 문구, 없으면(배너 조각) 그릴 때 적어 둔 문구', () => {
    expect((liveInputOf(object, job, doc) as LiveTextInput).text).toBe('여름 세일')
    const banner = { ...object, blockId: 'blk_banner', text: '배너 문구', lines: ['배너 문구'], align: 'right' as const }
    expect(liveInputOf(banner, job, doc)).toMatchObject({ text: '배너 문구', lines: ['배너 문구'], family: '글꼴B', align: 'right' })
  })

  it('글꼴이 없으면 문구는 그리지 않는다 — 도형은 글꼴이 없어도 그린다', () => {
    const G = globalThis as { __noTestFont?: boolean }
    G.__noTestFont = true
    try {
      expect(liveInputOf({ ...object, blockId: 'blk_none', text: '글' }, job, doc)).toBeNull()
      expect(liveInputOf({ ...object, blockId: 'blk_none', kind: 'shape' }, job, doc)).toMatchObject({ kind: 'shape' })
    } finally {
      G.__noTestFont = false
    }
  })

  it('지문은 꾸밈·글자별 모양·정렬이 바뀌면 달라지고, 같은 값이면 같다', () => {
    const input = liveInputOf(object, job, doc) as LiveTextInput
    expect(liveKeyOf(input)).toBe(liveKeyOf({ ...input }))
    expect(liveKeyOf(input)).not.toBe(liveKeyOf({ ...input, look: { ...DEFAULT_TEXT_LOOK, outline: true } }))
    expect(liveKeyOf(input)).not.toBe(liveKeyOf({ ...input, weight: 900 }))
    expect(liveKeyOf(input)).not.toBe(liveKeyOf({ ...input, chars: [{ color: '#ff0000' }] }))
    expect(liveKeyOf(input)).not.toBe(liveKeyOf({ ...input, align: 'right' }))
    // 꾸밈 없음과 기본 꾸밈은 같은 그림이다.
    expect(liveKeyOf(input)).toBe(liveKeyOf({ ...input, look: DEFAULT_TEXT_LOOK }))
    // 도형은 상자 크기도 모양이다.
    const shape = { kind: 'shape' as const, blockId: 's' }
    expect(liveKeyOf(shape, { width: 100, height: 50 })).not.toBe(liveKeyOf(shape, { width: 100, height: 60 }))
  })

  it('틀 안에 앉히기 — 가로는 정렬 쪽으로, 세로쓰기는 위·아래로', () => {
    const frame = { x: 0, y: 0, width: 400, height: 100 }
    expect(placeInFrame({ width: 200, height: 100 }, frame, 'left')).toEqual({ x: 0, y: 0, width: 200, height: 100 })
    expect(placeInFrame({ width: 200, height: 100 }, frame, 'right')).toEqual({ x: 200, y: 0, width: 200, height: 100 })
    const tall = { x: 0, y: 0, width: 100, height: 400 }
    // 틀 폭에 닿을 때까지 키운다 (50×100 → 100×200), 남는 높이 200을 위·아래로.
    expect(placeInFrame({ width: 50, height: 100 }, tall, 'left', true)).toEqual({ x: 0, y: 0, width: 100, height: 200 })
    expect(placeInFrame({ width: 50, height: 100 }, tall, 'right', true)).toEqual({ x: 0, y: 200, width: 100, height: 200 })
    expect(placeInFrame({ width: 50, height: 100 }, tall, 'center', true)).toEqual({ x: 0, y: 100, width: 100, height: 200 })
  })
})
