/**
 * 그림에서 빈 여백을 잘라 낸다 (블록별 문구 Patch).
 *
 * 모델은 요청한 판 크기 그대로 한 장을 준다. 그 안에 글자 한 덩어리가 어딘가에
 * 그려져 있고 나머지는 임시 바탕이다. 임시 바탕을 걷어 내면 투명한 여백이 되는데,
 * 그 여백까지 블록 자리에 앉히면 글자가 상자 한구석에 조그맣게 박힌다.
 *
 * 그래서 **그려진 부분만** 남긴다.
 *
 * 여기에는 "어느 픽셀이 누구 것인가"라는 판단이 없다. 이 그림에는 블록이 하나뿐이니
 * 남아 있는 모든 픽셀이 그 블록의 것이다 — 앞선 판들이 깨진 자리가 바로 그 판단을
 * 해야 했던 자리였고, 이 방식에는 그 자리가 아예 없다.
 */

/** 이 알파 아래는 그려지지 않은 곳이다 (`chromaKey`·`photoBox`와 같은 기준). */
const ALPHA_FLOOR = 8

export interface TrimmedImage {
  blob: Blob
  /** 잘라 낸 그림의 크기. 블록 상자에 앉힐 때 비율의 근거가 된다. */
  width: number
  height: number
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
 * 불투명한 부분만 남긴 그림. 그려진 것이 하나도 없으면 `null`.
 *
 * 실패해도 던지지 않는다 — 이미 값을 치른 그림이라, 못 잘랐다는 사실만 알리고
 * 나머지는 부르는 쪽이 정한다.
 */
export async function trimToContent(blob: Blob): Promise<TrimmedImage | null> {
  try {
    const bitmap = await toBitmap(blob)
    const width = Math.max(1, Math.round(bitmap.width))
    const height = Math.max(1, Math.round(bitmap.height))

    const source = document.createElement('canvas')
    source.width = width
    source.height = height
    const sctx = source.getContext('2d', { willReadFrequently: true })
    if (!sctx) return null
    sctx.clearRect(0, 0, width, height)
    sctx.drawImage(bitmap, 0, 0, width, height)
    const pixels = sctx.getImageData(0, 0, width, height)

    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if ((pixels.data[(y * width + x) * 4 + 3] ?? 0) <= ALPHA_FLOOR) continue
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    if (maxX < minX || maxY < minY) return null

    const w = maxX - minX + 1
    const h = maxY - minY + 1
    const cut = document.createElement('canvas')
    cut.width = w
    cut.height = h
    const cctx = cut.getContext('2d')
    if (!cctx) return null
    const cropped = cctx.createImageData(w, h)
    for (let row = 0; row < h; row += 1) {
      const from = ((minY + row) * width + minX) * 4
      cropped.data.set(pixels.data.subarray(from, from + w * 4), row * w * 4)
    }
    cctx.putImageData(cropped, 0, 0)
    const out = await new Promise<Blob | null>((resolve) => cut.toBlob(resolve, 'image/png'))
    return out === null ? null : { blob: out, width: w, height: h }
  } catch {
    return null
  }
}
