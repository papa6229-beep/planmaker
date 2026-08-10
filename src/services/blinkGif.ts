/**
 * 완성본 한 장을 **깜빡이는 GIF**로 (깜빡이는 버튼 Patch).
 *
 * 모델을 부르지 않는다. 이미 만들어 둔 완성본 PNG를 읽어, 버튼 모양 안쪽만 밝기를
 * 흔든 두 번째 프레임을 만들고, 둘을 GIF 한 장으로 엮는다.
 *
 * ## 모양 틀이 필요하다
 *
 * 앞선 판은 버튼이 앉은 **사각형을 통째로** 밀었다. 둥근 버튼인데 깜빡이는 자리는
 * 네모여서, 버튼 밖의 배경까지 함께 어두워졌다 — 작업자가 그 자리에서 걸렸다:
 * "저렇게 라운드된 버튼을 만들었으면서 깜빡 라인은 사각임."
 *
 * 원인은 재료였다. 합쳐진 완성본에서는 버튼이 배경 위에 이미 구워져 있어 **둥근
 * 모서리를 알 방법이 없다.** 다행히 버튼 조각은 투명도를 가진 PNG 한 장으로 따로
 * 남아 있다. 그것을 **모양 틀**로 깔고, 틀이 불투명한 자리에만 손댄다. 색은 여전히
 * 완성본에서 읽으므로 톤·종이 테두리 같은 후처리도 그대로 살아 있다.
 *
 * 두 번째 프레임은 **버튼 자리만** 담는다. 나머지는 첫 프레임 그대로이고 GIF는
 * 앞 프레임 위에 덮어 그리므로, 그 자리만 보내면 된다.
 *
 * 캔버스가 없는 환경(검사)에서는 `null`을 돌려준다. 부르는 쪽이 그 자리를 안다.
 */

import { blinkInsideMask } from '../domain/buttonBlink'
import { encodeGif, type GifFrame } from '../domain/gifEncode'
import type { LayoutRect } from '../domain/imageLayout'

/**
 * 프레임 하나를 몇 백분의 1초 보여 주는가.
 *
 * 1초는 느리다는 손검수를 받아 절반으로 줄였다 — "지금보다 2배 빨라야 함."
 */
export const BLINK_DELAY_CS = 50

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

export interface BlinkButton {
  /** 완성본 좌표계에서 버튼이 앉은 자리. */
  rect: LayoutRect
  /** 그 버튼의 조각 그림 — **모양 틀**로 쓴다. 없으면 사각형이 된다. */
  shape?: Blob | undefined
  /** 그 자리에서 그림이 돌아가 있으면 각도. */
  angle?: number | undefined
}

export interface BlinkGifInput {
  /** 완성본 PNG. */
  page: Blob
  buttons: readonly BlinkButton[]
  /** 밝기를 미는 정도 (0~1). */
  strength: number
  delayCs?: number
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
  const placed = input.buttons
    .map((button) => ({ button, box: clampRect(button.rect, source.width, source.height) }))
    .filter((item): item is { button: BlinkButton; box: LayoutRect } => item.box !== null)
  if (placed.length === 0) return null
  const left = Math.min(...placed.map((p) => p.box.x))
  const top = Math.min(...placed.map((p) => p.box.y))
  const right = Math.max(...placed.map((p) => p.box.x + p.box.width))
  const bottom = Math.max(...placed.map((p) => p.box.y + p.box.height))
  const width = right - left
  const height = bottom - top

  /**
   * 모양 틀 — 이 자리에서 **버튼이 실제로 차지하는 픽셀**.
   *
   * 조각 그림을 제자리·제 각도로 그려 그 알파를 읽는다. 틀을 못 만들면 예전처럼
   * 사각형 전체가 되는데, 그때도 깜빡이기는 한다.
   */
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = width
  maskCanvas.height = height
  const maskCtx = maskCanvas.getContext('2d')
  let mask: Uint8ClampedArray | null = null
  if (maskCtx !== null) {
    let drew = false
    for (const { button, box } of placed) {
      if (button.shape === undefined) continue
      const shape = await toBitmap(button.shape)
      if (shape === null) continue
      maskCtx.save()
      if (button.angle !== undefined && button.angle !== 0) {
        // 화면과 같은 축으로 돈다 — 상자 한가운데가 축이다.
        maskCtx.translate(box.x - left + box.width / 2, box.y - top + box.height / 2)
        maskCtx.rotate((button.angle * Math.PI) / 180)
        maskCtx.drawImage(shape.draw, -box.width / 2, -box.height / 2, box.width, box.height)
      } else {
        maskCtx.drawImage(shape.draw, box.x - left, box.y - top, box.width, box.height)
      }
      maskCtx.restore()
      drew = true
    }
    if (drew) {
      try {
        mask = maskCtx.getImageData(0, 0, width, height).data
      } catch {
        mask = null
      }
    }
  }

  // 버튼 자리를 떼어 낸다. 색은 완성본에서 읽으므로 톤·종이 테두리가 살아 있다.
  const patch = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const from = ((top + y) * source.width + left) * 4
    patch.set(whole.data.subarray(from, from + width * 4), y * width * 4)
  }

  const shifted = blinkInsideMask(patch, mask, { width, height }, input.strength)

  const delay = input.delayCs ?? BLINK_DELAY_CS
  const frames: GifFrame[] = [
    { data: whole.data, width: source.width, height: source.height, left: 0, top: 0, delayCs: delay },
    { data: shifted, width, height, left, top, delayCs: delay },
  ]
  return new Blob([encodeGif({ width: source.width, height: source.height }, frames)], { type: 'image/gif' })
}
