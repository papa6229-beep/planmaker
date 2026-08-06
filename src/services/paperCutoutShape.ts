/**
 * 종이 컷아웃 모양을 실제로 그린다 (Studio Patch §3).
 *
 * 캔버스를 쓰는 부분만 여기 모아 둔다. "어디까지가 종이인가"의 규칙은
 * `paperCutout.ts`에 있고 순수하다 — 미리보기와 최종 합성이 **같은 함수**를 쓰기
 * 때문에 두 화면의 외곽선이 같다.
 *
 * **원본 자산은 읽기만 한다.** 여기서 만드는 것은 화면이 잠깐 들고 있는 그림 한
 * 장이고, 자산 저장소에도 작업 파일에도 들어가지 않는다.
 */

import { paperMask, paperOffsets, paperPad, paperSeed, PAPER_COLOR } from '../domain/paperCutout'
import type { ContentBox } from '../domain/photoBox'

/**
 * 모양을 계산할 해상도의 상한.
 *
 * 종이 테두리는 부드럽게 확대돼도 티가 나지 않으므로 원본 해상도로 훑을 이유가
 * 없다. 670×670짜리 누끼 여러 장을 원본 크기로 넓히면 체크 한 번이 눈에 띄게
 * 걸린다.
 */
export const PAPER_WORK_MAX = 384

export interface PaperShape {
  /** 종이 모양 그림 (data URL). 종이인 자리만 불투명하다. */
  url: string
  /** 밖으로 넓힌 폭 — 아래 `content` 기준의 픽셀. */
  pad: number
  /** 이 모양이 계산된 내용 크기. `pad`와 함께 비율을 만든다. */
  content: { width: number; height: number }
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
 * 이 그림의 종이 모양.
 *
 * `box`는 `photoBox`가 잰 알파 경계다 — 블록을 채우는 바로 그 부분만 넓히므로,
 * 파일에 붙은 투명한 띠가 종이 크기를 부풀리지 않는다.
 *
 * 실패하면 던지지 않고 `null`을 돌려준다. 종이를 못 그리는 것이 사진을 못 쓰는
 * 이유는 아니고, 그때는 지금까지처럼 사진만 그린다.
 */
export async function buildPaperShape(blob: Blob, box: ContentBox, seed: string): Promise<PaperShape | null> {
  const built = await buildPaperCanvas(blob, box, seed)
  if (built === null) return null
  return { url: built.canvas.toDataURL('image/png'), pad: built.pad, content: built.content }
}

export interface PaperCanvas {
  canvas: HTMLCanvasElement
  pad: number
  content: { width: number; height: number }
}

/**
 * 같은 모양을 캔버스로.
 *
 * 최종 합성은 data URL을 다시 그림으로 읽을 이유가 없다 — 캔버스를 그대로
 * 받는다. 미리보기와 **같은 함수**를 지나므로 두 화면의 외곽선이 같다.
 */
export async function buildPaperCanvas(blob: Blob, box: ContentBox, seed: string): Promise<PaperCanvas | null> {
  try {
    const bitmap = await toBitmap(blob)
    if (bitmap.width <= 0 || bitmap.height <= 0) return null

    // 알파 경계 안쪽만 잘라 낸다 — 블록을 채우는 그 부분이다.
    const cropW = Math.max(1, bitmap.width * box.width)
    const cropH = Math.max(1, bitmap.height * box.height)
    const scale = Math.min(1, PAPER_WORK_MAX / Math.max(cropW, cropH))
    const w = Math.max(1, Math.round(cropW * scale))
    const h = Math.max(1, Math.round(cropH * scale))

    const source = document.createElement('canvas')
    source.width = w
    source.height = h
    const sctx = source.getContext('2d', { willReadFrequently: true })
    if (!sctx) return null
    sctx.clearRect(0, 0, w, h)
    sctx.drawImage(bitmap, bitmap.width * box.x, bitmap.height * box.y, cropW, cropH, 0, 0, w, h)
    const pixels = sctx.getImageData(0, 0, w, h)

    const pad = paperPad({ width: w, height: h })
    const mask = paperMask(
      { data: pixels.data, width: pixels.width, height: pixels.height },
      pad,
      paperOffsets(pad, paperSeed(seed)),
    )

    const out = document.createElement('canvas')
    out.width = mask.width
    out.height = mask.height
    const octx = out.getContext('2d')
    if (!octx) return null
    const image = octx.createImageData(mask.width, mask.height)
    for (let i = 0; i < mask.data.length; i += 1) {
      const at = i * 4
      image.data[at] = PAPER_COLOR.r
      image.data[at + 1] = PAPER_COLOR.g
      image.data[at + 2] = PAPER_COLOR.b
      image.data[at + 3] = mask.data[i] ?? 0
    }
    octx.putImageData(image, 0, 0)

    return { canvas: out, pad, content: { width: w, height: h } }
  } catch {
    return null
  }
}
