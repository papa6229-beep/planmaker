/**
 * Pure geometry for canvas editing (WORK_PLAN §10). Coordinates are in true
 * 840px canvas space; the view scale is applied only when rendering, so this
 * module is scale-agnostic and easy to unit-test.
 */

export const MIN_BLOCK_WIDTH = 80
export const MIN_BLOCK_HEIGHT = 48

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'ne', 'sw', 'se']

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** Clamps a rectangle's top-left so the whole rect stays inside the canvas. */
export function clampPosition(
  rect: Rect,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: clamp(rect.x, 0, Math.max(0, canvasWidth - rect.width)),
    y: clamp(rect.y, 0, Math.max(0, canvasHeight - rect.height)),
  }
}

/**
 * Bounds a move delta so a set of rects (a group, or a single block) stays
 * inside the canvas while preserving their relative offsets.
 */
export function boundedDelta(
  members: readonly Rect[],
  dx: number,
  dy: number,
  canvasWidth: number,
  canvasHeight: number,
): { dx: number; dy: number } {
  if (members.length === 0) return { dx: 0, dy: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxRight = -Infinity
  let maxBottom = -Infinity
  for (const m of members) {
    minX = Math.min(minX, m.x)
    minY = Math.min(minY, m.y)
    maxRight = Math.max(maxRight, m.x + m.width)
    maxBottom = Math.max(maxBottom, m.y + m.height)
  }
  // `+ 0` normalizes a possible -0 (e.g. clamping against -minX when minX===0).
  return {
    dx: clamp(dx, -minX, canvasWidth - maxRight) + 0,
    dy: clamp(dy, -minY, canvasHeight - maxBottom) + 0,
  }
}

/**
 * Computes a resized rectangle for a corner handle drag, enforcing minimum
 * sizes and keeping the rect within the canvas. The opposite corner stays put.
 */
export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  canvasWidth: number,
  canvasHeight: number,
): Rect {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  let { x, y, width, height } = rect

  const movesLeft = handle === 'nw' || handle === 'sw'
  const movesTop = handle === 'nw' || handle === 'ne'

  if (movesLeft) {
    x = clamp(rect.x + dx, 0, right - MIN_BLOCK_WIDTH)
    width = right - x
  } else {
    width = clamp(rect.width + dx, MIN_BLOCK_WIDTH, canvasWidth - rect.x)
  }

  if (movesTop) {
    y = clamp(rect.y + dy, 0, bottom - MIN_BLOCK_HEIGHT)
    height = bottom - y
  } else {
    height = clamp(rect.height + dy, MIN_BLOCK_HEIGHT, canvasHeight - rect.y)
  }

  return { x, y, width, height }
}
