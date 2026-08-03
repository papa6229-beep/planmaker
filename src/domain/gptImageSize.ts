/**
 * 기획서 캔버스 크기를 이미지 모델이 받아 주는 크기로 바꾼다 (1단계 §8).
 *
 * 기획서는 가로 840px 고정이지만 모델은 그 숫자를 받지 않는다. 공식 API 명세가
 * 요구하는 것은 다음 넷이다.
 *
 *  - 가로·세로 모두 16의 배수
 *  - 가로:세로 비율이 1:3 ~ 3:1 안
 *  - 긴 변 3840px 이하
 *  - 모델이 감당하는 픽셀 수 안
 *
 * 여기서 하지 않는 일이 더 중요하다. **자르지 않는다.** 기획서가 너무 길어 한
 * 장으로 만들 수 없으면 몰래 잘라 절반만 그리게 하는 대신, 만들 수 없다고 말한다
 * — 잘린 결과물은 성공처럼 보이면서 아래쪽 요구사항을 통째로 잃는다.
 *
 * 순수 함수다. 네트워크도 화면도 모른다.
 */

/** 16의 배수여야 하므로, 840 대신 그 아래 가장 가까운 배수에서 시작한다. */
export const GPT_IMAGE_BASE_WIDTH = 832
export const SIZE_STEP = 16
export const MIN_TOTAL_PIXELS = 655_360
export const MAX_TOTAL_PIXELS = 8_294_400
export const MAX_EDGE = 3840
/** 공식 명세의 1:3 ~ 3:1. */
export const MAX_ASPECT = 3

export const TOO_TALL_MESSAGE =
  '현재 페이지는 1장 생성이 가능한 최대 세로 비율을 넘었습니다. 페이지를 나누어 다시 시도해 주세요.'

export type SizeResolution =
  | { ok: true; width: number; height: number; size: string }
  | { ok: false; reason: 'aspect_out_of_range'; message: string }

function snap(value: number): number {
  return Math.max(SIZE_STEP, Math.round(value / SIZE_STEP) * SIZE_STEP)
}

/**
 * 캔버스 크기 → 요청 크기. 비율은 최대한 지키고, 한도는 반드시 지킨다.
 *
 * 16의 배수로 맞추는 과정에서 픽셀 수가 한도 밖으로 반 칸 넘어갈 수 있으므로,
 * 맞춘 뒤에 한 칸씩 물러서며 다시 확인한다 — 계산이 아니라 결과를 본다.
 */
export function resolveGptImageSize(canvasWidth: number, canvasHeight: number): SizeResolution {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return { ok: false, reason: 'aspect_out_of_range', message: TOO_TALL_MESSAGE }
  }
  const aspect = canvasHeight / canvasWidth
  if (aspect > MAX_ASPECT || 1 / aspect > MAX_ASPECT) {
    return { ok: false, reason: 'aspect_out_of_range', message: TOO_TALL_MESSAGE }
  }

  let w = GPT_IMAGE_BASE_WIDTH
  let h = w * aspect

  // 너무 작으면 같은 비율로 키운다. 잘라서 맞추지 않는다.
  const pixels = w * h
  if (pixels < MIN_TOTAL_PIXELS) {
    const scale = Math.sqrt(MIN_TOTAL_PIXELS / pixels)
    w *= scale
    h *= scale
  }
  // 너무 크면 같은 비율로 줄인다.
  if (w * h > MAX_TOTAL_PIXELS) {
    const scale = Math.sqrt(MAX_TOTAL_PIXELS / (w * h))
    w *= scale
    h *= scale
  }
  const longest = Math.max(w, h)
  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest
    w *= scale
    h *= scale
  }

  let width = snap(w)
  let height = snap(h)

  // 반올림 때문에 최소 픽셀에 못 미치면 짧은 쪽부터 한 칸씩 올린다.
  let guard = 0
  while (width * height < MIN_TOTAL_PIXELS && guard < 512) {
    if (width <= height) width += SIZE_STEP
    else height += SIZE_STEP
    guard += 1
  }
  // 반대로 넘어섰으면 긴 쪽부터 한 칸씩 내린다.
  guard = 0
  while ((width * height > MAX_TOTAL_PIXELS || Math.max(width, height) > MAX_EDGE) && guard < 512) {
    if (width >= height) width -= SIZE_STEP
    else height -= SIZE_STEP
    guard += 1
  }

  return { ok: true, width, height, size: `${width}x${height}` }
}
