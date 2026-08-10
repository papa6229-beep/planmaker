import { describe, it, expect } from 'vitest'
import {
  boundedDelta,
  clamp,
  clampPosition,
  MIN_BLOCK_HEIGHT,
  MIN_BLOCK_WIDTH,
  minBlockSize,
  MIN_PIECE_PX,
  minPieceSize,
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

/**
 * 조각의 바닥값 (자유 조절 Patch).
 *
 * 완성본 위의 조각은 블록이 아니다 — 안에 이름표도 버튼도 없다. 블록의 80×48을
 * 물려 쓰면서 "특정 사이즈 이하로 줄어들지 않는다"는 손검수 지적이 나왔다.
 */
describe('minPieceSize', () => {
  it('블록 바닥값보다 훨씬 낮다', () => {
    const piece = minPieceSize(840, 1180)
    expect(piece.width).toBeLessThan(MIN_BLOCK_WIDTH)
    expect(piece.height).toBeLessThan(MIN_BLOCK_HEIGHT)
  })

  it('아무리 작은 캔버스에서도 잡을 수 있을 만큼은 남는다', () => {
    expect(minPieceSize(1, 1)).toEqual({ width: MIN_PIECE_PX, height: MIN_PIECE_PX })
  })
})

describe('resizeRect: 잡는 순간 커지지 않는다', () => {
  it('바닥값보다 작게 놓인 상자가 모서리를 잡았다고 튀어 오르지 않는다', () => {
    // 자동 배치가 40×20으로 놓아 둔 조각. 예전에는 첫 움직임에 80×48이 되었다 —
    // 작업자가 "조절이 아니라 변경"이라고 부른 그 튐이다.
    const tiny = { x: 0, y: 0, width: 40, height: 20 }
    const r = resizeRect(tiny, 'se', -5, -5, 840, 1180)
    expect(r.width).toBeLessThanOrEqual(tiny.width)
    expect(r.height).toBeLessThanOrEqual(tiny.height)
  })

  it('건네준 바닥값을 쓴다', () => {
    const r = resizeRect({ x: 0, y: 0, width: 300, height: 60 }, 'se', -290, -55, 1020, 70, true, {
      width: 10,
      height: 6,
    })
    expect(r.width).toBe(10)
    expect(r.height).toBe(6)
  })
})
