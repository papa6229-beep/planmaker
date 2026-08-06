/**
 * 스티커판을 **미리 정한 칸 좌표로만** 자른다 (스티커판 Patch §5).
 *
 * 픽셀 모양을 보는 자리가 여기 없다는 것이 이 모듈의 요점이다. 어느 조각이 어느
 * 블록의 것인지는 자르기 전에 이미 정해져 있고, 여기서는 그 사각형을 오려 낼
 * 뿐이다. 그래서 두 문구가 한 조각이 되는 일도, 한 문구가 두 조각이 되는 일도
 * 있을 수 없다 — 조각 수는 언제나 칸 수와 같다.
 *
 * 자르면서 완충 띠에 묻은 잉크의 양도 함께 잰다. 부르는 쪽은 그 값으로 "모델이
 * 자기 칸을 넘었는가"를 판정한다. 넘었으면 **얹지 않고 멈춘다** — 다시 부르지도,
 * 픽셀을 보고 다시 나누지도 않는다.
 */

import type { CellInk, StickerCell } from '../domain/stickerSheet'

export interface StickerPiece {
  blockId: string
  index: number
  blob: Blob
}

export interface StickerSliceResult {
  pieces: StickerPiece[]
  inks: CellInk[]
}

/** 이 알파 아래는 잉크가 아니다 (`chromaKey`·`photoBox`와 같은 기준). */
const ALPHA_FLOOR = 8

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

/** 비율 사각형을 이 그림의 픽셀 사각형으로. 최소 1픽셀은 남긴다. */
function toPixels(
  rect: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x * width)))
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)))
  const w = Math.max(1, Math.min(width - x, Math.round(rect.width * width)))
  const h = Math.max(1, Math.min(height - y, Math.round(rect.height * height)))
  return { x, y, w, h }
}

/**
 * 칸마다 한 조각. 실패하면 `null` — 값을 이미 치른 그림이라 던지지 않는다.
 *
 * 조각이 비어 있어도(그 칸에 모델이 아무것도 안 그렸어도) 조각은 만든다. 비었다고
 * 옆 블록과 합치거나 새로 나누는 순간, 오브젝트와 블록의 1:1이 깨진다.
 */
export async function sliceStickerSheet(
  blob: Blob,
  cells: readonly StickerCell[],
): Promise<StickerSliceResult | null> {
  if (cells.length === 0) return { pieces: [], inks: [] }
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

    const pieces: StickerPiece[] = []
    const inks: CellInk[] = []

    for (const cell of cells) {
      const outer = toPixels(cell.cell, width, height)
      const inner = toPixels(cell.crop, width, height)

      // 완충 띠 = 칸에서 잘라 낼 상자를 뺀 나머지. 여기 묻은 잉크가 침범이다.
      let guardPixels = 0
      let guardInk = 0
      for (let row = outer.y; row < outer.y + outer.h; row += 1) {
        const insideRow = row >= inner.y && row < inner.y + inner.h
        for (let col = outer.x; col < outer.x + outer.w; col += 1) {
          if (insideRow && col >= inner.x && col < inner.x + inner.w) continue
          guardPixels += 1
          if ((pixels.data[(row * width + col) * 4 + 3] ?? 0) > ALPHA_FLOOR) guardInk += 1
        }
      }
      inks.push({
        index: cell.index,
        blockId: cell.blockId,
        guardRatio: guardPixels === 0 ? 0 : guardInk / guardPixels,
      })

      const cut = document.createElement('canvas')
      cut.width = inner.w
      cut.height = inner.h
      const cctx = cut.getContext('2d')
      if (!cctx) return null
      const cropped = cctx.createImageData(inner.w, inner.h)
      for (let row = 0; row < inner.h; row += 1) {
        const from = ((inner.y + row) * width + inner.x) * 4
        cropped.data.set(pixels.data.subarray(from, from + inner.w * 4), row * inner.w * 4)
      }
      cctx.putImageData(cropped, 0, 0)
      const piece = await new Promise<Blob | null>((resolve) => cut.toBlob(resolve, 'image/png'))
      if (piece === null) return null
      pieces.push({ blockId: cell.blockId, index: cell.index, blob: piece })
    }

    return { pieces, inks }
  } catch {
    return null
  }
}
