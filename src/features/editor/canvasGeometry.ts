/**
 * Pure geometry for canvas editing (WORK_PLAN §10). Coordinates are in true
 * 840px canvas space; the view scale is applied only when rendering, so this
 * module is scale-agnostic and easy to unit-test.
 */

export const MIN_BLOCK_WIDTH = 80
export const MIN_BLOCK_HEIGHT = 48

/** How short and how long a page may be (손검수 2 §3.2). */
export const MIN_CANVAS_HEIGHT = 400
export const MAX_CANVAS_HEIGHT = 30000
/** Breathing room kept under the lowest block when a page is shortened. */
export const CANVAS_BOTTOM_MARGIN = 80

/**
 * The page height to apply for a requested one: never so short that a block
 * would fall outside the page, never shorter than 400px, never past 30,000px.
 * Reaching a limit simply stops there — it is not an error.
 */
export function clampCanvasHeight(
  requested: number,
  blocks: readonly { position: { y: number; height: number } }[],
): number {
  const lowest = blocks.reduce((max, b) => Math.max(max, b.position.y + b.position.height), 0)
  const floor = Math.max(MIN_CANVAS_HEIGHT, blocks.length > 0 ? Math.ceil(lowest + CANVAS_BOTTOM_MARGIN) : 0)
  return Math.round(Math.min(MAX_CANVAS_HEIGHT, Math.max(floor, requested)))
}

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
 * 캔버스 밖으로 걸쳐도 남겨 두는 최소 겹침 (배경 합성 1차 §3.2).
 *
 * 작업판에서는 블록을 일부러 화면 밖으로 내린다 — 인물의 허리 아래를 자르거나,
 * 제품의 절반만 가장자리에 걸치게 하는 배치다. 다만 완전히 나가 버리면 선택
 * 테두리도 조작점도 잡을 수 없는 유령이 되므로, 양쪽 축 모두 이만큼은 캔버스와
 * 겹쳐 있게 둔다.
 */
export const MIN_ON_CANVAS = 24

/**
 * 자유 배치에서의 이동량.
 *
 * 캔버스 안으로 되돌리지 않는다. 대신 선택 묶음 전체가 캔버스에서 완전히
 * 떨어지는 것만 막는다 — 되돌릴 수 없는 배치를 만들지 않기 위해서다.
 */
export function freeDelta(
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
  // 오른쪽 끝이 캔버스 왼쪽 가장자리보다 이만큼은 안쪽에 남아야 하고, 왼쪽 끝은
  // 캔버스 오른쪽 가장자리보다 그만큼 앞에 있어야 한다. 세로도 같다.
  return {
    dx: clamp(dx, MIN_ON_CANVAS - maxRight, canvasWidth - MIN_ON_CANVAS - minX) + 0,
    dy: clamp(dy, MIN_ON_CANVAS - maxBottom, canvasHeight - MIN_ON_CANVAS - minY) + 0,
  }
}

/**
 * Computes a resized rectangle for a corner handle drag, enforcing minimum
 * sizes and keeping the rect within the canvas. The opposite corner stays put.
 *
 * `free`면 캔버스 경계로 가두지 않는다 — 이미 밖에 걸쳐 둔 블록의 모서리를 잡는
 * 순간 안으로 튀어 들어오면, 의도한 크롭이 조용히 사라진다 (§3.2).
 */
export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  canvasWidth: number,
  canvasHeight: number,
  free = false,
): Rect {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  let { x, y, width, height } = rect

  const movesLeft = handle === 'nw' || handle === 'sw'
  const movesTop = handle === 'nw' || handle === 'ne'

  const minX = free ? -Infinity : 0
  const maxWidth = free ? Infinity : canvasWidth - rect.x
  const maxHeight = free ? Infinity : canvasHeight - rect.y

  if (movesLeft) {
    x = clamp(rect.x + dx, minX, right - MIN_BLOCK_WIDTH)
    width = right - x
  } else {
    width = clamp(rect.width + dx, MIN_BLOCK_WIDTH, maxWidth)
  }

  if (movesTop) {
    y = clamp(rect.y + dy, minX, bottom - MIN_BLOCK_HEIGHT)
    height = bottom - y
  } else {
    height = clamp(rect.height + dy, MIN_BLOCK_HEIGHT, maxHeight)
  }

  return { x, y, width, height }
}

/**
 * 두 점이 만드는 사각형 (범위 선택 Patch).
 *
 * 어느 방향으로 끌든 같은 사각형이 나와야 한다 — 오른쪽 아래로만 끌게 하면
 * 위쪽에 있는 것을 고를 때 손이 한 번 더 간다.
 */
export function marqueeRect(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
}

/**
 * 범위에 **닿은** 블록들.
 *
 * 완전히 품은 것만 고르지 않는다. 큰 블록을 고르려면 그보다 큰 사각형을 그려야
 * 하는데, 화면을 꽉 채운 배경 블록에서는 그릴 자리가 없다.
 */
export function blocksInRect(
  blocks: readonly { id: string; position: Rect }[],
  area: Rect,
): string[] {
  const right = area.x + area.width
  const bottom = area.y + area.height
  return blocks
    .filter((b) => {
      const p = b.position
      return p.x < right && p.x + p.width > area.x && p.y < bottom && p.y + p.height > area.y
    })
    .map((b) => b.id)
}
