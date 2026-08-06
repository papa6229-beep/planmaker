/**
 * 사진 블록의 경계 (긴급 Patch §1 이미지 경계).
 *
 * 누끼 PNG는 대개 실제 그림보다 큰 캔버스에 담겨 온다 — 위아래로 투명한 띠가
 * 붙어 있고, 그 띠까지가 파일의 크기다. 그 크기를 그대로 블록으로 삼으면 선택
 * 테두리와 조작점이 **보이지 않는 여백**을 감싸게 되고, 작업자는 그림에서 한참
 * 떨어진 자리를 잡아야 한다.
 *
 * 그래서 여기서는 두 가지를 계산한다.
 *
 *  - **내용 상자** — 불투명한 픽셀이 실제로 차지하는 사각형. 파일 크기에 대한
 *    0..1 비율로 적어 두므로, 원본 픽셀을 하나도 건드리지 않는다.
 *  - **그림을 앉히는 자리** — 그 내용 상자가 블록을 정확히 채우도록 그림을
 *    확대해 밀어 넣는 값. 잘라내는 것은 그리는 쪽의 `overflow`가 하고, 원본
 *    바이트는 그대로 남는다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import { MIN_BLOCK_HEIGHT, MIN_BLOCK_WIDTH, type Rect, type ResizeHandle } from '../features/editor/canvasGeometry'

/** 파일 크기에 대한 0..1 비율. */
export interface ContentBox {
  x: number
  y: number
  width: number
  height: number
}

/** 잘라낼 것이 없을 때 — 그림 전체가 곧 내용이다. */
export const FULL_CONTENT_BOX: ContentBox = { x: 0, y: 0, width: 1, height: 1 }

/**
 * 이 알파 이하는 빈 자리로 본다.
 *
 * 0으로 두면 눈에 보이지도 않는 알파 1짜리 픽셀 하나가 경계를 파일 끝까지
 * 늘린다. 머리카락처럼 반투명이 많은 그림을 잃지 않을 만큼은 낮게 잡는다.
 */
export const CONTENT_ALPHA = 8

export interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * 불투명한 픽셀이 차지하는 사각형.
 *
 * 전부 투명하면 잘라낼 근거가 없으므로 그림 전체를 돌려준다 — 빈 상자를 주면
 * 부르는 쪽이 0으로 나누게 된다.
 */
export function alphaContentBox(pixels: PixelBuffer): ContentBox {
  const { data, width, height } = pixels
  if (width <= 0 || height <= 0) return FULL_CONTENT_BOX

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) <= CONTENT_ALPHA) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) return FULL_CONTENT_BOX

  return {
    x: minX / width,
    y: minY / height,
    width: (maxX - minX + 1) / width,
    height: (maxY - minY + 1) / height,
  }
}

/** 내용의 실제 픽셀 비율 (가로/세로). */
export function contentAspect(natural: { width: number; height: number }, box: ContentBox): number {
  const w = natural.width * box.width
  const h = natural.height * box.height
  if (w <= 0 || h <= 0) return 1
  return w / h
}

/**
 * 블록을 내용 비율에 맞춘다 (연결하는 순간 한 번).
 *
 * 넓이는 대체로 지키고 가운데도 지킨다 — 작업자가 잡아 둔 자리와 크기감을
 * 그대로 두면서 모양만 바로잡는 것이지, 블록을 다른 데로 옮기는 것이 아니다.
 * 캔버스 안으로 되돌리지 않는다: 밖으로 걸쳐 둔 배치는 의도한 크롭이다.
 */
export function photoRect(rect: Rect, natural: { width: number; height: number }, box: ContentBox): Rect {
  const aspect = contentAspect(natural, box)
  const area = Math.max(1, rect.width * rect.height)
  const height = Math.max(MIN_BLOCK_HEIGHT, Math.sqrt(area / aspect))
  const width = Math.max(MIN_BLOCK_WIDTH, height * aspect)
  return {
    x: rect.x + rect.width / 2 - width / 2,
    y: rect.y + rect.height / 2 - height / 2,
    width,
    height,
  }
}

export interface PhotoImageStyle {
  width: number
  height: number
  left: number
  top: number
}

/**
 * 내용 상자가 블록을 정확히 채우도록 그림을 앉힌다.
 *
 * 내용이 그림의 가운데 절반이면 그림은 블록의 두 배로 그려지고 그만큼 밀려난다.
 * 밖으로 나간 부분은 그리는 쪽에서 잘린다 — 원본은 그대로다.
 */
export function photoImageStyle(size: { width: number; height: number }, box: ContentBox): PhotoImageStyle {
  const safeW = box.width > 0 ? box.width : 1
  const safeH = box.height > 0 ? box.height : 1
  const width = size.width / safeW
  const height = size.height / safeH
  // `+ 0`은 -0을 0으로 되돌린다. 자리를 옮기지 않는데 부호가 붙으면 값을 비교
  // 하는 쪽이 이유 없이 갈린다.
  return { width, height, left: -box.x * width + 0, top: -box.y * height + 0 }
}

/**
 * 비율을 지키는 크기 조절.
 *
 * 사진에서 가로세로를 따로 늘리면 원본에 없던 찌그러짐이 생긴다. 잡은 모서리의
 * 반대쪽은 제자리에 남고, 가로·세로 중 **더 많이 끈 쪽**이 새 크기를 정한다 —
 * 그래야 위아래로만 끌어도 반응한다.
 */
export function keepAspect(rect: Rect, handle: ResizeHandle, dx: number, dy: number, aspect: number): Rect {
  const safeAspect = aspect > 0 ? aspect : 1
  const movesLeft = handle === 'nw' || handle === 'sw'
  const movesTop = handle === 'nw' || handle === 'ne'

  const fromX = movesLeft ? rect.width - dx : rect.width + dx
  const fromY = (movesTop ? rect.height - dy : rect.height + dy) * safeAspect
  const wanted = Math.abs(fromX - rect.width) >= Math.abs(fromY - rect.width) ? fromX : fromY

  const width = Math.max(MIN_BLOCK_WIDTH, Math.max(MIN_BLOCK_HEIGHT * safeAspect, wanted))
  const height = width / safeAspect

  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  return {
    x: movesLeft ? right - width : rect.x,
    y: movesTop ? bottom - height : rect.y,
    width,
    height,
  }
}
