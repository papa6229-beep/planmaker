/**
 * 그림의 밝기 분포 (톤 곡선 Patch).
 *
 * 레벨·커브 그래프 뒤에 깐다. 캔버스를 쓰는 부분만 여기 있고, 세는 규칙은
 * `domain/toneCurve.ts`의 `histogramOf`다. 긴 변 256px로 줄여 센다 — 분포의 모양은
 * 그 정도로 충분하고, 슬라이더를 끄는 동안 다시 세도 버벅이지 않는다.
 *
 * 읽지 못하면 `null`. 그래프는 분포 없이도 쓸 수 있다.
 */

import { histogramOf, type Histogram } from '../domain/toneCurve'

export const HISTOGRAM_MAX_SIDE = 256

export async function histogramOfBlob(blob: Blob): Promise<Histogram | null> {
  try {
    if (typeof createImageBitmap !== 'function') return null
    const bitmap = await createImageBitmap(blob)
    const k = Math.min(1, HISTOGRAM_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * k))
    canvas.height = Math.max(1, Math.round(bitmap.height * k))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return histogramOf(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
  } catch {
    return null
  }
}
