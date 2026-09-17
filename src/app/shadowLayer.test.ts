/** 그림자만 남는 도형 (그림자 레이어 Patch, 2026-09-17). */
import { describe, expect, it } from 'vitest'
import { SHADOW_LAYER_LOOK, normalizeShapeLook, shapePad } from '../domain/shapeLook'

describe('§SL 그림자만', () => {
  it('keeps the shadow on whenever the shape is shadow-only', () => {
    const look = normalizeShapeLook({ ...SHADOW_LAYER_LOOK, shadow: false })
    expect(look.shadowOnly).toBe(true)
    expect(look.shadow).toBe(true)
  })

  it('is off by default, and never on a line', () => {
    expect(normalizeShapeLook({}).shadowOnly).toBe(false)
    expect(normalizeShapeLook({ kind: 'line', shadowOnly: true }).shadowOnly).toBe(false)
  })

  it('leaves room around the box for the blur', () => {
    const pad = shapePad(normalizeShapeLook(SHADOW_LAYER_LOOK))
    expect(pad.left).toBeGreaterThanOrEqual(SHADOW_LAYER_LOOK.shadowBlur * 2)
    expect(pad.bottom).toBeGreaterThanOrEqual(SHADOW_LAYER_LOOK.shadowBlur * 2)
  })
})
