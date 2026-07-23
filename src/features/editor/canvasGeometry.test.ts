import { describe, it, expect } from 'vitest'
import {
  boundedDelta,
  clamp,
  clampPosition,
  MIN_BLOCK_HEIGHT,
  MIN_BLOCK_WIDTH,
  resizeRect,
  type Rect,
} from './canvasGeometry'

describe('clamp', () => {
  it('bounds a value', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('clampPosition', () => {
  it('keeps a rect inside the canvas', () => {
    const rect: Rect = { x: -20, y: 2000, width: 100, height: 100 }
    expect(clampPosition(rect, 840, 1800)).toEqual({ x: 0, y: 1700 })
  })
})

describe('boundedDelta', () => {
  it('limits movement so the group stays on canvas', () => {
    const members: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 200, y: 0, width: 100, height: 100 },
    ]
    // Wants to move left by 50 but leftmost is already at x=0 → clamped to 0.
    expect(boundedDelta(members, -50, 0, 840, 1800).dx).toBe(0)
    // Moving right is allowed up to canvas edge (rightmost right edge = 300).
    expect(boundedDelta(members, 1000, 0, 840, 1800).dx).toBe(840 - 300)
  })
})

describe('resizeRect', () => {
  const rect: Rect = { x: 100, y: 100, width: 200, height: 200 }

  it('grows from the SE corner without moving the origin', () => {
    const r = resizeRect(rect, 'se', 50, 40, 840, 1800)
    expect(r).toEqual({ x: 100, y: 100, width: 250, height: 240 })
  })

  it('moves the origin when dragging the NW corner', () => {
    const r = resizeRect(rect, 'nw', 20, 20, 840, 1800)
    expect(r).toEqual({ x: 120, y: 120, width: 180, height: 180 })
  })

  it('enforces the minimum size', () => {
    const r = resizeRect(rect, 'se', -1000, -1000, 840, 1800)
    expect(r.width).toBe(MIN_BLOCK_WIDTH)
    expect(r.height).toBe(MIN_BLOCK_HEIGHT)
  })
})
