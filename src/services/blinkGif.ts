/**
 * 완성본 한 장을 **깜빡이는 GIF**로 (깜빡이는 버튼 Patch).
 *
 * 모델을 부르지 않는다. 이미 만들어 둔 완성본 PNG를 읽어, 버튼이 앉은 사각형만
 * 밝기를 흔든 두 번째 프레임을 만들고, 둘을 GIF 한 장으로 엮는다.
 *
 * 두 번째 프레임은 **버튼 자리만** 담는다. 나머지는 첫 프레임 그대로이고 GIF는
 * 앞 프레임 위에 덮어 그리므로, 그 자리만 보내면 된다 — 통짜로 두 번 담으면 파일이
 * 두 배가 된다.
 *
 * 캔버스가 없는 환경(검사)에서는 `null`을 돌려준다. 부르는 쪽이 그 자리를 안다.
 */

import { blinkFrame, blinkGoesBrighter } from '../domain/buttonBlink'
import { encodeGif, type GifFrame } from '../domain/gifEncode'
import type { LayoutRect } from '../domain/imageLayout'

/** 프레임 하나를 몇 백분의 1초 보여 주는가 — 1초. */
export const BLINK_DELAY_CS = 100

async function toBitmap(blob: Blob): Promise<{ width: number; height: number; draw: CanvasImageSource } | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob)
      return { width: bitmap.width, height: bitmap.height, draw: bitmap }
    }
  } catch {
    // 아래 길로 간다.
  }
  return await new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight, draw: image })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}

/** 사각형을 그림 안으로 접는다. 밖으로 걸친 버튼이 있을 수 있다. */
function clampRect(rect: LayoutRect, width: number, height: number): LayoutRect | null {
  const x = Math.max(0, Math.min(width, Math.floor(rect.x)))
  const y = Math.max(0, Math.min(height, Math.floor(rect.y)))
  const right = Math.max(0, Math.min(width, Math.ceil(rect.x + rect.width)))
  const bottom = Math.max(0, Math.min(height, Math.ceil(rect.y + rect.height)))
  if (right - x < 1 || bottom - y < 1) return null
  return { x, y, width: right - x, height: bottom - y }
}

export interface BlinkGifInput {
  /** 완성본 PNG. */
  page: Blob
  /** 완성본 좌표계에서 버튼이 앉은 자리들. 비어 있으면 만들지 않는다. */
  buttons: readonly LayoutRect[]
  /** 밝기를 미는 정도 (0~1). */
  strength: number
}

/**
 * 두 프레임짜리 GIF.
 *
 * 버튼 자리가 없으면 `null`이다 — 깜빡일 것이 없는데 GIF로 만들면 화질만 잃는다.
 */
export async function renderBlinkGif(input: BlinkGifInput): Promise<Blob | null> {
  if (input.buttons.length === 0) return null
  const source = await toBitmap(input.page)
  if (source === null) return null

  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.drawImage(source.draw, 0, 0)

  let whole: ImageData
  try {
    whole = ctx.getImageData(0, 0, source.width, source.height)
  } catch {
    return null
  }

  // 버튼이 여럿이면 **모두 담는 한 사각형**을 쓴다. 조각을 여러 장 보내면 프레임이
  // 늘어나고, GIF는 프레임마다 팔레트를 또 싣는다.
  const boxes = input.buttons
    .map((rect) => clampRect(rect, source.width, source.height))
    .filter((rect): rect is LayoutRect => rect !== null)
  if (boxes.length === 0) return null
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  const width = right - left
  const height = bottom - top

  // 버튼 자리를 떼어 내 밝기를 민다. 방향은 그 자리의 색이 정한다.
  const patch = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const from = ((top + y) * source.width + left) * 4
    patch.set(whole.data.subarray(from, from + width * 4), y * width * 4)
  }
  const region = { data: patch, width, height }
  const shifted = blinkFrame(region, input.strength, blinkGoesBrighter(region))

  const frames: GifFrame[] = [
    { data: whole.data, width: source.width, height: source.height, left: 0, top: 0, delayCs: BLINK_DELAY_CS },
    { data: shifted, width, height, left, top, delayCs: BLINK_DELAY_CS },
  ]
  return new Blob([encodeGif({ width: source.width, height: source.height }, frames)], { type: 'image/gif' })
}
