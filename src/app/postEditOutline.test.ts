/**
 * 후보정의 그림자·테두리 (후보정 Patch, 2026-09-17).
 *
 * 사용자: 그림자를 끝까지 올려도 거의 티가 나지 않는다. 테두리를 후보정에서 조절하고 싶다.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMPOSITE_EFFECTS,
  contactShadow,
  normalizeEffects,
  outlineWidthPx,
  wallShadow,
} from '../domain/compositeEffects'

const rect = { x: 100, y: 100, width: 400, height: 600 }
const FRONT = { light: { x: 0, y: 0 } }

describe('드롭 그림자 — 자리는 작업자가 정한다 (2026-09-17)', () => {
  it('정한 자리로 민다 — 왼쪽·위도 된다', () => {
    const left = wallShadow(rect, 1, { x: -0.5, y: 0, blur: 0.3 })
    expect(left.dx).toBeCloseTo(-200)
    expect(left.dy).toBeCloseTo(0)
    const up = wallShadow(rect, 1, { x: 0, y: -0.25, blur: 0.3 })
    expect(up.dy).toBeCloseTo(-100)
  })

  it('제품을 돌려도 그림자는 페이지에서 같은 쪽에 진다', () => {
    // 90° 돌린 좌표계 안에서 그리므로, 오른쪽(+x)은 그 안에서 -y 쪽이어야 한다.
    const w = wallShadow(rect, 1, { x: 0.5, y: 0, blur: 0, angle: 90 })
    expect(w.dx).toBeCloseTo(0)
    expect(w.dy).toBeCloseTo(-200)
  })

  it('흐림과 진하기', () => {
    const sharp = wallShadow(rect, 1, { x: 0.1, y: 0.1, blur: 0 })
    const soft = wallShadow(rect, 1, { x: 0.1, y: 0.1, blur: 1 })
    expect(soft.blur).toBeGreaterThan(sharp.blur)
    expect(wallShadow(rect, 1, { x: 0, y: 0, blur: 0 }).opacity).toBeGreaterThanOrEqual(0.75)
    expect(wallShadow(rect, 0, { x: 0.1, y: 0.1, blur: 0.4 }).opacity).toBe(0)
    expect(contactShadow(rect, FRONT, 0).opacity).toBe(0)
  })

  it('자리 값은 짧은 변의 1.5배까지, 예전 파일은 기본 자리', () => {
    const e = normalizeEffects({ shadowX: 9, shadowY: -9 })
    expect(e.shadowX).toBe(1.5)
    expect(e.shadowY).toBe(-1.5)
    expect(normalizeEffects({}).shadowX).toBe(DEFAULT_COMPOSITE_EFFECTS.shadowX)
  })
})

describe('바닥 그림자', () => {
  it('끝까지 올리면 뚜렷하다 (앞선 상한 0.45)', () => {
    expect(contactShadow(rect, FRONT, 1).opacity).toBeGreaterThanOrEqual(0.75)
  })
})

describe('테두리', () => {
  it('예전 작업 파일에는 없다 — 꺼진 채로 읽는다', () => {
    const effects = normalizeEffects({ edge: 0.5 })
    expect(effects.outline).toBe(false)
    expect(effects.outlineColor).toBe(DEFAULT_COMPOSITE_EFFECTS.outlineColor)
  })

  it('이상한 값은 걸러 낸다', () => {
    const effects = normalizeEffects({ outline: true, outlineWidth: 7, outlineOpacity: -1, outlineColor: 'red' })
    expect(effects.outline).toBe(true)
    expect(effects.outlineWidth).toBe(1)
    expect(effects.outlineOpacity).toBe(0)
    expect(effects.outlineColor).toBe('#ffffff')
    expect(normalizeEffects({ outlineColor: '#FF8800' }).outlineColor).toBe('#ff8800')
  })

  it('두께는 짧은 변의 최대 6%, 0이어도 1px', () => {
    expect(outlineWidthPx(rect, 1)).toBeCloseTo(24)
    expect(outlineWidthPx(rect, 0)).toBe(1)
  })
})

describe('바닥 그림자는 0에서 시작한다 (2026-09-17)', () => {
  it('아무것도 없으면 0', () => {
    expect(DEFAULT_COMPOSITE_EFFECTS.contactShadow).toBe(0)
    expect(normalizeEffects({}).contactShadow).toBe(0)
  })

  it('예전에 통째로 저장된 기본값 0.7은 0으로 읽는다', () => {
    expect(normalizeEffects({ contactShadow: 0.7, wallShadow: 0.5 }).contactShadow).toBe(0)
    expect(normalizeEffects({ contactShadow: 0.4 }).contactShadow).toBeCloseTo(0.4)
  })

  it('한 번 읽은 뒤에 고른 70은 그대로 남는다', () => {
    const once = normalizeEffects({ contactShadow: 0.7 })
    const chosen = normalizeEffects({ ...once, contactShadow: 0.7 })
    expect(chosen.contactShadow).toBeCloseTo(0.7)
    expect(normalizeEffects(JSON.parse(JSON.stringify(chosen))).contactShadow).toBeCloseTo(0.7)
  })
})
