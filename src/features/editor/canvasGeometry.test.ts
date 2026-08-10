import { describe, it, expect } from 'vitest'
import {
  boundedDelta,
  clamp,
  clampPosition,
  MIN_BLOCK_HEIGHT,
  MIN_BLOCK_WIDTH,
  minBlockSize,
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

/**
 * 얇은 배너에서는 바닥값도 얇아진다 (배너 Patch §6).
 *
 * 절대 픽셀 바닥값이 1020×70 배너에서는 캔버스 높이의 69%가 된다. 한 번 키운
 * 조각이 그 아래로 줄지 않아 실제로 손검수에서 막혔다.
 */
describe('minBlockSize', () => {
  it('기획서 캔버스에서는 지금까지와 똑같다', () => {
    // 여기가 달라지면 배너를 고치려다 작성기를 건드린 것이다.
    expect(minBlockSize(840, 1180)).toEqual({ width: MIN_BLOCK_WIDTH, height: MIN_BLOCK_HEIGHT })
  })

  it('얇은 배너에서는 세로 바닥이 함께 낮아진다', () => {
    expect(minBlockSize(1020, 70).height).toBeLessThan(MIN_BLOCK_HEIGHT / 4)
  })

  it('가장 작은 배너에서도 0이 되지는 않는다', () => {
    const floor = minBlockSize(178, 90)
    expect(floor.width).toBeGreaterThan(0)
    expect(floor.height).toBeGreaterThan(0)
  })

  it('얇은 캔버스에서 실제로 작게 줄일 수 있다', () => {
    // 손검수에서 막힌 그 동작이다.
    const shrunk = resizeRect({ x: 0, y: 0, width: 300, height: 60 }, 'se', -280, -55, 1020, 70, true)
    expect(shrunk.height).toBeLessThan(MIN_BLOCK_HEIGHT)
  })
})
