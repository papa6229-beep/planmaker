/**
 * 브라우저에서 실제 사용 이미지를 읽어 숫자로 바꾼다 (배경 합성 1차 §7).
 *
 * 캔버스를 쓰는 부분만 여기 모아 둔다. "무엇을 재는가"의 규칙은
 * `imageAnalysis.ts`에 있고 순수하다 — 그래야 브라우저 없이 그대로 검사된다.
 *
 * **원본 자산은 조금도 바뀌지 않는다.** 여기서 만드는 것은 요청 안에서만 사는
 * 숫자 몇 개이고, 저장소에 들어가지 않는다.
 */

import { analyzeCutout, type ImageAnalysis } from '../domain/imageAnalysis'

/**
 * 재기 위해 줄이는 크기.
 *
 * 원본 해상도로 셀 이유가 없다 — 평균색과 밝기 기울기는 축소본에서도 같고,
 * 큰 이미지 여러 장을 원본 크기로 훑으면 클릭 한 번이 눈에 띄게 느려진다.
 */
export const ANALYSIS_MAX_SIDE = 256

function targetSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= ANALYSIS_MAX_SIDE) return { width: Math.max(1, width), height: Math.max(1, height) }
  const scale = ANALYSIS_MAX_SIDE / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
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
    // 성공하면 `img`는 이미 픽셀을 갖고 있으므로 주소는 놓아도 된다.
    URL.revokeObjectURL(url)
  }
}

/**
 * 그림 한 장의 분석값.
 *
 * 실패하면 던지지 않고 `null`을 돌려준다 — 한 장을 못 읽는 것이 배경을 못 만드는
 * 이유는 아니다. 나머지 장의 숫자만으로도 주문은 성립하고, 여기서 막으면 사람이
 * 이유도 모른 채 버튼 앞에 선다.
 */
export async function analyzeImageBlob(blob: Blob): Promise<ImageAnalysis | null> {
  try {
    const bitmap = await toBitmap(blob)
    const size = targetSize(
      typeof bitmap.width === 'number' ? bitmap.width : ANALYSIS_MAX_SIDE,
      typeof bitmap.height === 'number' ? bitmap.height : ANALYSIS_MAX_SIDE,
    )
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.clearRect(0, 0, size.width, size.height)
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)
    const pixels = ctx.getImageData(0, 0, size.width, size.height)
    return analyzeCutout({ data: pixels.data, width: pixels.width, height: pixels.height })
  } catch {
    return null
  }
}
