/**
 * 페이지의 한 자리 **주변**이 어떤 색인가 (스티커판 Patch §3).
 *
 * 문구를 어떤 색으로 그려야 읽히는지는 그 자리에 무엇이 깔려 있느냐가 정한다.
 * 배경만 보고 정하면 사진 위를 지나는 문구가 묻히고, 페이지 전체 평균으로 정하면
 * 어느 자리에도 맞지 않는 한 가지 색이 나온다.
 *
 * 그래서 자리마다 따로 잰다. 재는 규칙은 `imageAnalysis.ts`에 이미 있고 순수하다 —
 * 여기서는 캔버스로 그 자리의 픽셀만 떠 온다.
 *
 * **나가는 것은 숫자뿐이다.** 이 모듈이 만드는 값에는 그림도, 파일명도, 바이트도
 * 없다. 합성 페이지 자체가 요청에 실리지 않는 이유가 이것이다.
 */

import { analyzeCutout } from '../domain/imageAnalysis'
import type { LayoutRect } from '../domain/imageLayout'
import type { StickerRegionTone } from '../domain/stickerSheet'

/** 재기 위해 줄이는 크기 — `imageAnalysisRunner`와 같은 이유, 같은 값. */
export const REGION_MAX_SIDE = 512

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

/**
 * 자리마다 하나씩. 못 잰 자리는 `null`이고, 그 자리는 색 없이 주문한다.
 *
 * 실패하면 던지지 않는다 — 색을 못 읽는 것이 문구를 못 만드는 이유는 아니다.
 */
export async function analyzeRegions(
  blob: Blob,
  rects: readonly LayoutRect[],
  page: { width: number; height: number },
): Promise<(StickerRegionTone | null)[]> {
  const empty = rects.map(() => null)
  if (rects.length === 0 || page.width <= 0 || page.height <= 0) return empty
  try {
    const bitmap = await toBitmap(blob)
    const longest = Math.max(page.width, page.height)
    const scale = longest <= REGION_MAX_SIDE ? 1 : REGION_MAX_SIDE / longest
    const width = Math.max(1, Math.round(page.width * scale))
    const height = Math.max(1, Math.round(page.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return empty
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const pixels = ctx.getImageData(0, 0, width, height)

    return rects.map((rect) => {
      // 지면 밖으로 걸친 자리는 안쪽만 잰다. 한 점도 안 남으면 잴 것이 없다.
      const x0 = Math.max(0, Math.min(width - 1, Math.round((rect.x / page.width) * width)))
      const y0 = Math.max(0, Math.min(height - 1, Math.round((rect.y / page.height) * height)))
      const x1 = Math.max(x0 + 1, Math.min(width, Math.round(((rect.x + rect.width) / page.width) * width)))
      const y1 = Math.max(y0 + 1, Math.min(height, Math.round(((rect.y + rect.height) / page.height) * height)))
      const w = x1 - x0
      const h = y1 - y0
      if (w <= 0 || h <= 0) return null

      const region = new Uint8ClampedArray(w * h * 4)
      for (let row = 0; row < h; row += 1) {
        const from = ((y0 + row) * width + x0) * 4
        region.set(pixels.data.subarray(from, from + w * 4), row * w * 4)
      }
      const analysis = analyzeCutout({ data: region, width: w, height: h })
      if (analysis === null) return null
      return { average: analysis.average, brightness: analysis.brightness, contrast: analysis.contrast }
    })
  } catch {
    return empty
  }
}
