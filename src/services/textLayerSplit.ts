/**
 * 꾸며진 문구 한 장을 블록별 그림으로 자른다 (텍스트 오브젝트 Patch §1).
 *
 * 캔버스를 쓰는 부분만 여기 모아 둔다. "어느 픽셀이 누구 것인가"의 규칙은
 * `textObjects.ts`에 있고 순수하다.
 *
 * 자를 때 **제 임자의 픽셀만** 옮긴다. 사각형째 잘라 오면 겹쳐 있는 옆 문구의
 * 글자가 딸려 오고, 그것을 옮기는 순간 남의 글자가 함께 움직인다.
 */

import { splitTextLayer, type StudioTextObject, type TextSourceBlock } from '../domain/textObjects'

export interface SlicedTextLayer {
  blockId: string
  layer: number
  /** 기획서 좌표의 자리. 오브젝트의 처음 위치와 크기가 된다. */
  rect: { x: number; y: number; width: number; height: number }
  blob: Blob
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
 * 블록마다 한 장씩. 실패하면 `null` — 값을 이미 치른 그림이므로 던지지 않는다.
 *
 * 자를 것이 없으면 빈 배열이다. 부르는 쪽은 그때 예전처럼 한 장을 통째로 얹는다.
 */
export async function sliceTextLayer(
  blob: Blob,
  blocks: readonly TextSourceBlock[],
  page: { width: number; height: number },
): Promise<SlicedTextLayer[] | null> {
  if (blocks.length === 0) return []
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

    const scale = { x: page.width / width, y: page.height / height }
    const { owner, slices } = splitTextLayer(
      { data: pixels.data, width: pixels.width, height: pixels.height },
      blocks,
      scale,
    )

    const out: SlicedTextLayer[] = []
    for (const [index, slice] of slices.entries()) {
      // `slices`는 픽셀이 있는 블록만 담고 있으므로 차례가 어긋난다. 임자 번호는
      // 원래 블록 목록의 차례이니 그 번호로 되찾는다.
      const ownerIndex = blocks.findIndex((b) => b.blockId === slice.blockId)
      if (ownerIndex < 0) continue
      void index

      const { x, y, width: w, height: h } = slice.box
      const cut = document.createElement('canvas')
      cut.width = w
      cut.height = h
      const cctx = cut.getContext('2d')
      if (!cctx) continue
      const cropped = cctx.createImageData(w, h)
      for (let row = 0; row < h; row += 1) {
        for (let col = 0; col < w; col += 1) {
          const from = ((y + row) * width + (x + col)) * 4
          if (owner[(y + row) * width + (x + col)] !== ownerIndex) continue
          const to = (row * w + col) * 4
          cropped.data[to] = pixels.data[from] ?? 0
          cropped.data[to + 1] = pixels.data[from + 1] ?? 0
          cropped.data[to + 2] = pixels.data[from + 2] ?? 0
          cropped.data[to + 3] = pixels.data[from + 3] ?? 0
        }
      }
      cctx.putImageData(cropped, 0, 0)
      const piece = await new Promise<Blob | null>((resolve) => cut.toBlob(resolve, 'image/png'))
      if (piece === null) continue

      out.push({
        blockId: slice.blockId,
        layer: slice.layer,
        rect: {
          x: Math.round(x * scale.x),
          y: Math.round(y * scale.y),
          width: Math.max(1, Math.round(w * scale.x)),
          height: Math.max(1, Math.round(h * scale.y)),
        },
        blob: piece,
      })
    }
    return out
  } catch {
    return null
  }
}

export type { StudioTextObject }
