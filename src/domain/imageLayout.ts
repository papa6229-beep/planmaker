/**
 * 그림이 블록 안에 놓이는 방식과, 캔버스 밖으로 걸친 블록의 최종 크롭
 * (배경 합성 1차 §3).
 *
 * 두 가지가 여기 함께 있는 이유는 둘 다 "블록이 그린 상자와 실제로 출력되는
 * 사각형이 어떻게 다른가"를 말하기 때문이다.
 *
 *  - **맞춤 방식** — 상자 안에서 그림이 전부 보이는가(`contain`), 상자를 꽉
 *    채우고 넘치는 부분이 잘리는가(`cover`).
 *  - **캔버스 크롭** — 작업자가 일부러 캔버스 밖으로 내려 둔 블록에서, 최종
 *    결과에 남는 것은 캔버스 안쪽뿐이다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다 — 그래야 브라우저 없이 그대로 검사된다.
 */

/** `전체 보이기`(contain) · `블록 채우기`(cover). */
export type ImageFit = 'contain' | 'cover'

/**
 * 아무것도 고르지 않은 블록의 뜻.
 *
 * 예전 문서에는 이 값이 없다. 없는 것을 `cover`로 읽으면 이미 완성된 기획서의
 * 그림이 조용히 잘리므로, 없으면 언제나 지금까지의 동작인 `전체 보이기`다.
 */
export const DEFAULT_IMAGE_FIT: ImageFit = 'contain'

export const IMAGE_FIT_OPTIONS: readonly { value: ImageFit; label: string }[] = [
  { value: 'contain', label: '전체 보이기' },
  { value: 'cover', label: '블록 채우기' },
]

/** 이 블록의 맞춤 방식. 모르는 값은 기본값으로 읽는다. */
export function imageFitOf(block: { image?: { fit?: string } | undefined }): ImageFit {
  return block.image?.fit === 'cover' ? 'cover' : DEFAULT_IMAGE_FIT
}

export interface LayoutRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 한 번의 `drawImage`에 그대로 넘길 수 있는 값.
 *
 * `s*`는 **블록이 그린 상자 안의 좌표**다 — 원본 픽셀 좌표가 아니다. 맞춤 방식에
 * 따라 원본의 어느 부분이 그 상자를 채우는지는 그리는 쪽이 한 번 더 옮긴다.
 */
export interface CanvasCrop {
  sx: number
  sy: number
  sWidth: number
  sHeight: number
  dx: number
  dy: number
  dWidth: number
  dHeight: number
}

/**
 * 캔버스 밖으로 걸친 블록에서 실제로 출력되는 부분.
 *
 * 완전히 밖에 있으면 `null` — 그리지 않는 것과 0픽셀을 그리는 것은 다르고,
 * 후자는 캔버스 API에서 오류가 된다.
 */
export function cropToCanvas(rect: LayoutRect, canvasWidth: number, canvasHeight: number): CanvasCrop | null {
  const left = Math.max(0, rect.x)
  const top = Math.max(0, rect.y)
  const right = Math.min(canvasWidth, rect.x + rect.width)
  const bottom = Math.min(canvasHeight, rect.y + rect.height)

  const dWidth = right - left
  const dHeight = bottom - top
  if (dWidth <= 0 || dHeight <= 0) return null

  return {
    sx: left - rect.x,
    sy: top - rect.y,
    sWidth: dWidth,
    sHeight: dHeight,
    dx: left,
    dy: top,
    dWidth,
    dHeight,
  }
}

/**
 * 맞춤 방식대로 원본을 상자에 앉힌다 — 원본 픽셀 좌표 기준.
 *
 *  - `contain`: 원본 전체가 보이도록 비율을 지키고, 남는 자리는 비운다.
 *  - `cover`: 상자를 꽉 채우고 넘치는 쪽을 가운데 기준으로 잘라낸다.
 */
export function fitSourceRect(
  fit: ImageFit,
  source: { width: number; height: number },
  box: LayoutRect,
): { source: LayoutRect; dest: LayoutRect } | null {
  if (source.width <= 0 || source.height <= 0 || box.width <= 0 || box.height <= 0) return null

  if (fit === 'cover') {
    const scale = Math.max(box.width / source.width, box.height / source.height)
    const sWidth = box.width / scale
    const sHeight = box.height / scale
    return {
      source: {
        x: (source.width - sWidth) / 2,
        y: (source.height - sHeight) / 2,
        width: sWidth,
        height: sHeight,
      },
      dest: { ...box },
    }
  }

  const scale = Math.min(box.width / source.width, box.height / source.height)
  const dWidth = source.width * scale
  const dHeight = source.height * scale
  return {
    source: { x: 0, y: 0, width: source.width, height: source.height },
    dest: {
      x: box.x + (box.width - dWidth) / 2,
      y: box.y + (box.height - dHeight) / 2,
      width: dWidth,
      height: dHeight,
    },
  }
}
