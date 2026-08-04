/**
 * 이미지를 재는 일과 다시 그리는 일 (마감 교정 §3).
 *
 * 브라우저 API를 쓰는 부분만 여기 모아 둔다. 크기 판단과 "다시 그릴 것인가"의
 * 규칙은 `workingImage.ts`에 있고 순수하다 — 그래야 캔버스 없는 곳에서도 그
 * 규칙을 그대로 검사할 수 있다.
 */

/** 이미지의 실제 픽셀 크기. */
export async function measureImage(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close?.()
    return size
  }
  // createImageBitmap이 없는 곳에서는 <img>로 잰다.
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 정확히 `width × height`인 PNG로 다시 그린다.
 *
 * 잘라내지도, 여백을 붙이지도 않는다 — 받은 그림 전체를 그 크기에 채운다.
 * 확대·축소가 일어나므로 부드럽게, 가능한 한 좋은 품질로 그린다.
 */
export async function drawToSize(blob: Blob, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const source: CanvasImageSource =
    typeof createImageBitmap === 'function'
      ? await createImageBitmap(blob)
      : await new Promise<HTMLImageElement>((resolve, reject) => {
          const url = URL.createObjectURL(blob)
          const img = new Image()
          img.onload = () => {
            URL.revokeObjectURL(url)
            resolve(img)
          }
          img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('이미지를 읽지 못했습니다.'))
          }
          img.src = url
        })

  ctx.drawImage(source, 0, 0, width, height)
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!out) throw new Error('작업본 이미지를 만들지 못했습니다.')
  return out
}
