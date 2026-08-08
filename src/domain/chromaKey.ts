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

/**
 * 가장자리를 몇 겹까지 되돌릴 것인가 (자주색 테두리 Patch).
 *
 * 모델이 그린 글자의 경계는 한 픽셀로 끝나지 않는다. 안티앨리어싱에 그림자·번짐이
 * 겹쳐 두세 겹까지 섞인 색이 이어진다. 너무 얕으면 띠가 남고, 너무 깊으면 글자
 * 안쪽의 디자인 색까지 건드린다.
 */
export const KEY_EDGE_DEPTH = 2

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

/**
 * 한 픽셀이 키 색과 섞였다면, 얼마나 섞였는가 (자주색 테두리 Patch).
 *
 * 가장자리 픽셀은 `C = α·F + (1−α)·K` 한 번의 섞임이다 — `F`는 원래 색, `K`는 키
 * 색, `α`는 글자가 덮은 정도. 우리는 `C`와 `K`를 알고 `F`와 `α`를 모른다.
 *
 * 그런데 `F`의 각 채널이 0~255 안에 있어야 한다는 사실만으로 `α`의 **아래 한계**가
 * 나온다. 그 한계를 그대로 답으로 쓰면, 되돌린 `F`는 채널 하나가 정확히 0이나
 * 255에 닿는 색이 된다 — 즉 "키 색이 조금도 남지 않은" 가장 순한 색이다.
 *
 * 마젠타 키(255,0,255)와 흰 글자에서 이것이 정확히 맞아떨어진다. 반쯤 섞인
 * `(255,128,255)`는 `α=0.5`, `F=흰색`으로 풀린다 — 지금 화면에 남는 그 분홍 띠가
 * **연한 흰색 가장자리**가 된다.
 */
export function unmixFromKey(
  color: { r: number; g: number; b: number },
  key: KeyColor,
): { r: number; g: number; b: number; alpha: number } {
  const channels: [number, number][] = [
    [color.r, key.r],
    [color.g, key.g],
    [color.b, key.b],
  ]
  let alpha = 0
  for (const [c, k] of channels) {
    // F ≥ 0 이려면
    if (k > 0) alpha = Math.max(alpha, 1 - c / k)
    // F ≤ 255 이려면
    if (k < 255) alpha = Math.max(alpha, (c - k) / (255 - k))
  }
  alpha = Math.min(1, Math.max(0, alpha))
  if (alpha <= 0) return { r: 0, g: 0, b: 0, alpha: 0 }
  const back = ([c, k]: [number, number]): number =>
    Math.min(255, Math.max(0, Math.round((c - (1 - alpha) * k) / alpha)))
  return {
    r: back(channels[0]!),
    g: back(channels[1]!),
    b: back(channels[2]!),
    alpha,
  }
}

/** 네 이웃. 대각선까지 세면 겹이 뭉툭해져 글자가 굵기를 잃는다. */
const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * 지워진 자리에 맞닿은 겹만 골라 키 색을 되돌린다 (자주색 테두리 Patch).
 *
 * `keyOutBackground`는 "지운다 / 안 지운다" 둘 중 하나로만 판정한다. 그래서 반쯤
 * 섞인 가장자리가 통째로 "안 지움"에 몰리고, 그 픽셀들이 딱딱한 띠로 남는다.
 * 흰 글자에서 유독 눈에 띄는데, 흰색과 마젠타는 **빨강과 파랑이 똑같아서** 섞여도
 * 그 두 채널이 가득 찬 채 남기 때문이다 — 남는 색이 곧 진분홍이다.
 *
 * 고치는 자리를 **가장자리로 한정**하는 것이 요점이다. 그림 전체에 되돌리기를
 * 걸면 디자인이 일부러 쓴 분홍(하트, 분홍 외곽선)까지 흰색으로 펴진다. 지워진
 * 픽셀에 닿은 겹만이 배경과 섞였을 수 있는 자리다.
 *
 * 값을 치른 그림을 고치는 일이므로 **되돌릴 수 있게** 만들지 않는다 — 부르는 쪽이
 * 원본을 그대로 쥐고 있고, 여기서 나오는 것은 언제나 새 버퍼가 아니라 제자리
 * 수정이다. 몇 픽셀을 고쳤는지 돌려준다.
 *
 * 한계를 적어 둔다. 진한 분홍 요소가 배경에 직접 닿아 있으면, 그 가장자리는
 * 원래 색이 아니라 더 옅고 따뜻한 색으로 풀린다 — 섞이기 전 색이 무엇이었는지
 * 알 방법이 원리상 없기 때문이다. 자주색 띠보다 눈에 덜 띄지만 정확하지도 않다.
 */
export function unspillKeyEdges(
  pixels: PixelBuffer,
  key: KeyColor = TEXT_KEY_COLOR,
  depth: number = KEY_EDGE_DEPTH,
): number {
  const { data, width, height } = pixels
  if (width <= 0 || height <= 0 || depth <= 0) return 0

  // 겹을 먼저 **전부 찾아 두고** 나서 고친다. 고치면서 찾으면 방금 반투명해진
  // 픽셀이 다음 겹의 기준이 되어 겹이 안쪽으로 번진다.
  const ring = new Int8Array(width * height)
  let frontier: number[] = []
  for (let i = 0; i < width * height; i += 1) {
    if ((data[i * 4 + 3] ?? 0) === 0) frontier.push(i)
  }
  for (let step = 1; step <= depth; step += 1) {
    const next: number[] = []
    for (const index of frontier) {
      const x = index % width
      const y = (index - x) / width
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const at = ny * width + nx
        if (ring[at] !== 0 || (data[at * 4 + 3] ?? 0) === 0) continue
        ring[at] = step
        next.push(at)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }

  let fixed = 0
  for (let i = 0; i < width * height; i += 1) {
    if (ring[i] === 0) continue
    const at = i * 4
    const unmixed = unmixFromKey(
      { r: data[at] ?? 0, g: data[at + 1] ?? 0, b: data[at + 2] ?? 0 },
      key,
    )
    // 이미 키 색이 섞이지 않은 픽셀은 `alpha`가 1로 나온다. 건드릴 것이 없다.
    if (unmixed.alpha >= 1) continue
    data[at] = unmixed.r
    data[at + 1] = unmixed.g
    data[at + 2] = unmixed.b
    // 원래 알파와 곱한다. 이미 반투명한 픽셀을 불투명하게 되돌리지 않기 위해서다.
    data[at + 3] = Math.round((data[at + 3] ?? 255) * unmixed.alpha)
    fixed += 1
  }
  return fixed
}
