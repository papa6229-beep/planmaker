/**
 * 문구 레이어에서 단색 배경을 걷어 낸다 (꾸며진 텍스트 Patch §3).
 *
 * 캔버스를 쓰는 부분만 여기 모아 둔다. "어디까지가 배경인가"의 규칙은
 * `chromaKey.ts`에 있고 순수하다 — 그래야 브라우저 없이 그대로 검사된다.
 *
 * 모델이 준 원본 바이트는 바뀌지 않는다. 여기서 나오는 것은 배경을 지운 **새
 * 그림 한 장**이고, 자산 저장소에 들어가는 것도 그것이다.
 */

import { keyOutBackground, TEXT_KEY_COLOR, TEXT_KEY_TOLERANCE, unspillKeyEdges } from '../domain/chromaKey'

export interface KeyedLayer {
  blob: Blob
  /** 배경을 지운 뒤 남은 불투명 비율. 1에 가까우면 지워지지 않은 것이다. */
  opaqueRatio: number
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
 * 이미 배경을 지운 문구 조각의 가장자리만 다시 다듬는다 (자주색 테두리 Patch).
 *
 * 앞선 판으로 만든 완성본에는 자주색 띠가 그대로 남아 있다. 그 띠는 **지워진
 * 픽셀에 맞닿은 불투명 픽셀**이라는 사실만으로 찾을 수 있으므로, 마젠타가 이미
 * 사라진 그림에서도 똑같이 고칠 수 있다 — 다시 만들 필요가 없다.
 *
 * 고칠 것이 없으면 `null`. 부르는 쪽은 그때 저장을 건너뛴다.
 */
export async function cleanKeyEdges(blob: Blob): Promise<{ blob: Blob; pixels: number } | null> {
  try {
    const bitmap = await toBitmap(blob)
    const width = Math.max(1, Math.round(bitmap.width))
    const height = Math.max(1, Math.round(bitmap.height))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)

    const pixels = ctx.getImageData(0, 0, width, height)
    const fixed = unspillKeyEdges(
      { data: pixels.data, width: pixels.width, height: pixels.height },
      TEXT_KEY_COLOR,
    )
    if (fixed === 0) return null
    ctx.putImageData(pixels, 0, 0)
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return out === null ? null : { blob: out, pixels: fixed }
  } catch {
    return null
  }
}

/**
 * 배경을 지운 문구 레이어. 실패하면 `null`.
 *
 * 던지지 않는 이유는 이 그림이 **이미 값을 치른** 것이기 때문이다. 여기서
 * 터지면 배경과 사진까지 함께 잃는다 — 못 지웠다는 사실만 알리고, 나머지는
 * 부르는 쪽이 정한다.
 */
export async function removeKeyBackground(blob: Blob): Promise<KeyedLayer | null> {
  try {
    const bitmap = await toBitmap(blob)
    const width = Math.max(1, Math.round(bitmap.width))
    const height = Math.max(1, Math.round(bitmap.height))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)

    const pixels = ctx.getImageData(0, 0, width, height)
    const buffer = { data: pixels.data, width: pixels.width, height: pixels.height }
    const opaqueRatio = keyOutBackground(buffer, TEXT_KEY_COLOR, TEXT_KEY_TOLERANCE)
    /**
     * 지우고 나서 가장자리를 되돌린다 (자주색 테두리 Patch).
     *
     * 비율은 **되돌리기 전에** 잰다. 그 값이 답하는 물음은 "모델이 단색 배경을
     * 지켰는가"이고, 가장자리 몇 겹이 반투명해졌는지와는 상관이 없다.
     */
    unspillKeyEdges(buffer, TEXT_KEY_COLOR)
    ctx.putImageData(pixels, 0, 0)

    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return out === null ? null : { blob: out, opaqueRatio }
  } catch {
    return null
  }
}
