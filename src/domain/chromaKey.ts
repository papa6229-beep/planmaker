/**
 * 단색 배경 지우기 (꾸며진 텍스트 Patch §3).
 *
 * `gpt-image-2`는 투명 배경을 만들어 주지 않는다 — 공급자가 그렇게 답했다
 * (`param: background`, `Transparent background is not supported for this
 * model.`). 그래서 투명을 **요청하지 않고**, 글자와 확실히 구분되는 단색 위에
 * 글자만 그리게 한 뒤 그 단색을 여기서 지운다.
 *
 * 지우는 규칙은 하나뿐이다: **허용치 안에 드는 키 색은 전부.** 바깥에서 이어지는
 * 것만 지우면 `0`·`6`·`ㅇ`처럼 글자 안쪽에 갇힌 임시 바탕이 남는다. 프롬프트가
 * 글자·외곽선·그림자·라벨에 이 색을 쓰지 못하게 막아 두었으므로, 이 색인 픽셀은
 * 어디에 있든 임시 바탕이다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

export interface KeyColor {
  r: number
  g: number
  b: number
}

/**
 * 글자에 쓰일 일이 거의 없는 색.
 *
 * 순수 마젠타다. 타이포그래피에서 이 값이 정확히 나오는 일은 드물고, 나오더라도
 * 프롬프트가 이 색을 쓰지 말라고 못 박는다.
 */
export const TEXT_KEY_COLOR: KeyColor = { r: 255, g: 0, b: 255 }
export const TEXT_KEY_HEX = '#FF00FF'

/**
 * 키 색으로 볼 거리 (RGB 유클리드).
 *
 * 모델이 만든 단색은 완벽히 균일하지 않고, 글자 가장자리는 배경과 섞인다. 너무
 * 좁으면 테두리에 색 띠가 남고, 너무 넓으면 글자의 밝은 분홍까지 먹는다.
 */
export const TEXT_KEY_TOLERANCE = 110

/** 이 알파 아래는 없는 픽셀로 센다 (`photoBox`와 같은 기준). */
const ALPHA_FLOOR = 8

export interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

function distance(data: Uint8ClampedArray, at: number, key: KeyColor): number {
  const dr = (data[at] ?? 0) - key.r
  const dg = (data[at + 1] ?? 0) - key.g
  const db = (data[at + 2] ?? 0) - key.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/**
 * 키 색인 픽셀을 전부 지운다. 지운 뒤 남은 불투명 비율을 돌려준다.
 *
 * 픽셀을 **제자리에서** 고친다 — 페이지 한 장 크기의 버퍼를 한 벌 더 만들 이유가
 * 없다. 돌려주는 비율은 부르는 쪽이 "정말 지워졌는가"를 판정하는 데 쓴다:
 * 모델이 단색 배경을 무시했다면 이 값이 거의 1로 남는다.
 */
export function keyOutBackground(
  pixels: PixelBuffer,
  key: KeyColor = TEXT_KEY_COLOR,
  tolerance: number = TEXT_KEY_TOLERANCE,
): number {
  const { data, width, height } = pixels
  if (width <= 0 || height <= 0) return 0

  const total = width * height
  let opaque = 0
  for (let i = 0; i < total; i += 1) {
    const at = i * 4
    if (distance(data, at, key) <= tolerance) {
      data[at + 3] = 0
      continue
    }
    if ((data[at + 3] ?? 0) > ALPHA_FLOOR) opaque += 1
  }
  return opaque / total
}
