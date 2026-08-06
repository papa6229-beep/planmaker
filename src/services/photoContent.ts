/**
 * 브라우저에서 누끼의 실제 경계를 잰다 (긴급 Patch §1 이미지 경계).
 *
 * 캔버스를 쓰는 부분만 여기 모아 둔다. "어디까지가 그림인가"의 규칙은
 * `photoBox.ts`에 있고 순수하다.
 *
 * **원본 자산은 조금도 바뀌지 않는다.** 여기서 만드는 것은 화면이 잠깐 들고 있는
 * 숫자 네 개이고, 저장소에도 작업 파일에도 들어가지 않는다 — 그래서 이 기능은
 * 자료 구조를 건드리지 않는다.
 */

import { alphaContentBox, type ContentBox } from '../domain/photoBox'

/**
 * 재기 위해 줄이는 크기.
 *
 * 경계는 축소본에서도 거의 같고, 큰 그림 여러 장을 원본 해상도로 훑으면 파일을
 * 붙이는 순간이 눈에 띄게 느려진다. 비율로 돌려주므로 줄여도 뜻이 남는다.
 */
export const PHOTO_MEASURE_MAX_SIDE = 256

export interface PhotoContent {
  /** 파일 자체의 픽셀 크기. */
  natural: { width: number; height: number }
  /** 그 안에서 실제 그림이 차지하는 사각형 (0..1). */
  box: ContentBox
}

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
 * 이 그림의 크기와 실제 경계.
 *
 * 실패하면 던지지 않고 `null`을 돌려준다 — 경계를 못 재는 것이 그림을 못 쓰는
 * 이유는 아니다. 부르는 쪽은 파일 전체를 내용으로 보고 지금까지처럼 그린다.
 */
export async function measurePhoto(blob: Blob): Promise<PhotoContent | null> {
  try {
    const bitmap = await toBitmap(blob)
    const natural = { width: bitmap.width, height: bitmap.height }
    if (natural.width <= 0 || natural.height <= 0) return null

    const longest = Math.max(natural.width, natural.height)
    const scale = longest > PHOTO_MEASURE_MAX_SIDE ? PHOTO_MEASURE_MAX_SIDE / longest : 1
    const w = Math.max(1, Math.round(natural.width * scale))
    const h = Math.max(1, Math.round(natural.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    const pixels = ctx.getImageData(0, 0, w, h)
    return { natural, box: alphaContentBox({ data: pixels.data, width: pixels.width, height: pixels.height }) }
  } catch {
    return null
  }
}
