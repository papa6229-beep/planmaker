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

describe('뒤 그림자', () => {
  it('정면광이어도 제품 밖으로 밀린다 — 뒤에 숨어 보이지 않던 까닭', () => {
    const wall = wallShadow(rect, FRONT, 1)
    expect(wall.dx).toBeGreaterThan(0)
    expect(wall.dy).toBeGreaterThan(0)
    expect(Math.hypot(wall.dx, wall.dy)).toBeGreaterThan(rect.width * 0.08)
  })

  it('세게 할수록 멀고 진하고 또렷하다', () => {
    const weak = wallShadow(rect, FRONT, 0.2)
    const strong = wallShadow(rect, FRONT, 1)
    expect(strong.opacity).toBeGreaterThan(weak.opacity)
    expect(Math.hypot(strong.dx, strong.dy)).toBeGreaterThan(Math.hypot(weak.dx, weak.dy))
    expect(strong.blur).toBeLessThan(weak.blur)
    expect(strong.opacity).toBeGreaterThanOrEqual(0.5)
  })

  it('빛이 있으면 그 반대쪽으로', () => {
    const wall = wallShadow(rect, { light: { x: 1, y: 0 } }, 1)
    expect(wall.dx).toBeLessThan(0)
  })

  it('0은 진짜 0이다', () => {
    expect(wallShadow(rect, FRONT, 0).opacity).toBe(0)
    expect(contactShadow(rect, FRONT, 0).opacity).toBe(0)
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
