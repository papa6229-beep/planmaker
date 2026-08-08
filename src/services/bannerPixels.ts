/**
 * 배너가 화소를 읽어야 하는 두 자리 (배너 Patch §4).
 *
 * 규칙은 `quietRegion`과 `edgeColor`에 있고 순수하다. 여기 있는 것은 캔버스를
 * 여는 부분뿐이다 — `textLayerKey`가 `chromaKey`를 감싸는 것과 같은 나눔이다.
 *
 * 둘 다 실패해도 던지지 않는다. 배경에서 잔잔한 자리를 못 고르면 지금까지처럼
 * 가운데를 쓰면 되고, 끝 색을 못 읽으면 사람이 스포이드를 들면 된다. 어느 쪽도
 * 배너를 못 뽑을 이유가 아니다.
 */

import { edgeColor, type EdgeSide } from '../domain/edgeColor'
import { quietRegion, type QuietSlot, type Rect } from '../domain/quietRegion'

async function toBitmap(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob)
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.addEventListener('load', () => resolve(img))
      img.addEventListener('error', () => reject(new Error('이미지를 읽지 못했습니다.')))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 큰 배경을 통째로 훑으면 느리다. 잔잔한 자리를 고르는 데는 이만하면 넉넉하다. */
const SCAN_MAX = 640

async function readPixels(blob: Blob, maxEdge: number): Promise<ImageData | null> {
  const bitmap = await toBitmap(blob)
  const shrink = Math.min(1, maxEdge / Math.max(1, bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * shrink))
  const height = Math.max(1, Math.round(bitmap.height * shrink))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

/**
 * 배경에서 잘라 쓸 자리. 못 읽으면 `null` — 부르는 쪽은 가운데를 쓰면 된다.
 *
 * 훑을 때는 줄여서 보고, 돌려주는 자리는 **원본 크기로 되돌린다.** 그러지 않으면
 * 640짜리 좌표가 840짜리 그림에 쓰여 왼쪽 위로 쏠린다.
 */
export async function pickQuietRegion(
  blob: Blob,
  aspect: number,
  slots: readonly QuietSlot[],
): Promise<Rect | null> {
  try {
    const bitmap = await toBitmap(blob)
    const pixels = await readPixels(blob, SCAN_MAX)
    if (pixels === null) return null

    const { rect } = quietRegion({ data: pixels.data, width: pixels.width, height: pixels.height }, aspect, {
      slots,
    })
    const back = bitmap.width / Math.max(1, pixels.width)
    return {
      x: Math.round(rect.x * back),
      y: Math.round(rect.y * back),
      width: Math.round(rect.width * back),
      height: Math.round(rect.height * back),
    }
  } catch {
    return null
  }
}

/**
 * 다 뽑은 배너의 끝 색. 얇은 띠 배너가 놓이는 자리의 배경색을 여기에 맞춘다.
 *
 * 배너는 작아서 통째로 읽는다 — 줄여서 보면 끝줄이 이웃 화소와 섞여, 정작 알고
 * 싶은 **맨 끝의 색**이 아닌 값이 나온다.
 */
export async function readEdgeColors(
  blob: Blob,
  sides: readonly EdgeSide[],
): Promise<{ side: EdgeSide; hex: string }[]> {
  try {
    const pixels = await readPixels(blob, Number.MAX_SAFE_INTEGER)
    if (pixels === null) return []
    const buffer = { data: pixels.data, width: pixels.width, height: pixels.height }
    return sides.flatMap((side) => {
      const hex = edgeColor(buffer, side)
      return hex === null ? [] : [{ side, hex }]
    })
  } catch {
    return []
  }
}
