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
 * 가장자리 픽셀이 얼마나 글자에 덮였는가 (자주색 테두리 Patch).
 *
 * 가장자리는 `C = α·F + (1−α)·K` 한 번의 섞임이다 — `F`는 원래 색, `K`는 키 색.
 * 그래서 `C`가 `K`에서 떨어진 거리는 `F`가 떨어진 거리의 **정확히 α배**다. 원래
 * 색을 알면 나눗셈 한 번으로 α가 나온다.
 *
 * 원래 색을 어떻게 아는가가 요점이다. 앞선 판은 그것을 몰라도 되는 방법을 썼다 —
 * `F`의 각 채널이 0~255여야 한다는 조건만으로 α의 아래 한계를 구하는 것. 흰
 * 글자에서는 정확했지만 **색 있는 글자에서 무너졌다.** 분홍 글자의 가장자리가
 * 연두색으로 풀렸다. 조건이 주는 한계는 "키가 조금도 안 남은 가장 순한 색"이고,
 * 그 색이 원래 색이라는 보장은 어디에도 없기 때문이다.
 *
 * 그래서 원래 색을 **이웃에게 묻는다**. 가장자리 바로 안쪽의 픽셀은 배경과 섞이지
 * 않았고, 외곽선이든 글자든 그 가장자리는 바로 그 색의 가장자리다.
 */
export function keyEdgeAlpha(
  color: { r: number; g: number; b: number },
  foreground: { r: number; g: number; b: number },
  key: KeyColor,
): number {
  const span = Math.hypot(foreground.r - key.r, foreground.g - key.g, foreground.b - key.b)
  // 안쪽 색 자체가 키 색과 구별되지 않으면 나눌 수가 없다. 손대지 않는다.
  if (span < 1) return 1
  const reach = Math.hypot(color.r - key.r, color.g - key.g, color.b - key.b)
  return Math.min(1, Math.max(0, reach / span))
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
 * 걸면 디자인이 일부러 쓴 분홍(하트, 분홍 외곽선)까지 펴진다. 지워진 픽셀에 닿은
 * 겹만이 배경과 섞였을 수 있는 자리다.
 *
 * 겹마다 **바로 안쪽의 색을 함께 물고 나온다.** 그 색이 이 가장자리의 원래 색이다 —
 * 흰 외곽선의 가장자리는 흰색이고, 분홍 하트의 가장자리는 분홍이다. 그래서 색 있는
 * 요소가 배경에 닿아 있어도 제 색으로 풀린다. 앞선 판은 원래 색을 모르는 채 풀어서
 * 흰 글자에서만 맞았다.
 *
 * 안쪽이 없는 조각 — 겹 두께보다 얇은 획 — 은 손대지 않는다. 물어볼 데가 없으면
 * 지어내지 않는 쪽이 낫다.
 *
 * 몇 픽셀을 고쳤는지 돌려준다. 부르는 쪽이 "정말 달라졌는가"를 그 값으로 안다.
 */
export function unspillKeyEdges(
  pixels: PixelBuffer,
  key: KeyColor = TEXT_KEY_COLOR,
  depth: number = KEY_EDGE_DEPTH,
): number {
  const { data, width, height } = pixels
  const total = width * height
  if (width <= 0 || height <= 0 || depth <= 0) return 0

  const CLEAR = -1
  const UNSET = -2
  /** 이 픽셀의 원래 색을 어디에 물을 것인가. 아직 모르면 `UNSET`. */
  const source = new Int32Array(total).fill(UNSET)
  const ring = new Int8Array(total)

  // 지워진 픽셀에서 시작한다. 그 자리는 물을 곳이 없다는 표시만 달고 넘어간다.
  let frontier: number[] = []
  for (let i = 0; i < total; i += 1) {
    if ((data[i * 4 + 3] ?? 0) === 0) {
      source[i] = CLEAR
      frontier.push(i)
    }
  }
  if (frontier.length === 0) return 0

  /**
   * 겹을 먼저 **전부 찾아 두고** 나서 고친다. 고치면서 찾으면 방금 반투명해진
   * 픽셀이 다음 겹의 기준이 되어 겹이 안쪽으로 번진다.
   */
  const edges: number[] = []
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
        if (source[at] !== UNSET || (data[at * 4 + 3] ?? 0) === 0) continue
        source[at] = CLEAR
        ring[at] = step
        edges.push(at)
        next.push(at)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  /**
   * 바깥으로도 한 겹 (자주색 테두리 Patch 2).
   *
   * `keyOutBackground`의 판정은 **0 아니면 255**다. 허용치 안에 든 픽셀은 얼마나
   * 덮였든 통째로 지워지므로, 모델이 그린 안티앨리어싱이 잘려나가고 1비트짜리
   * 하드 엣지만 남는다. 그 하드 엣지를 상자 크기로 줄여 붙이면 가장자리가
   * 계단처럼 보인다 — 글자마다, 크기와 상관없이.
   *
   * 지워진 픽셀 중 **글자에 닿은 한 겹**은 배경이 아니라 덮이다 만 자리다. 그
   * 자리에 원래의 부분 투명도를 돌려주면 가장자리가 다시 부드러워진다. 진짜
   * 배경은 키 색 그대로라 계산이 0을 주므로 저절로 투명하게 남는다.
   */
  const outer: number[] = []
  for (let i = 0; i < total; i += 1) {
    if ((data[i * 4 + 3] ?? 0) !== 0) continue
    const x = i % width
    const y = (i - x) / width
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      if ((data[(ny * width + nx) * 4 + 3] ?? 0) !== 0) {
        outer.push(i)
        break
      }
    }
  }
  if (edges.length === 0 && outer.length === 0) return 0

  /**
   * 이제 반대로 — 겹이 아닌 불투명 픽셀(안쪽)에서 바깥으로 퍼뜨려, 겹마다 가장
   * 가까운 안쪽 색을 물려 준다. 이것이 그 가장자리의 원래 색이다.
   */
  let inner: number[] = []
  for (let i = 0; i < total; i += 1) {
    if (ring[i] === 0 && (data[i * 4 + 3] ?? 0) !== 0) {
      source[i] = i
      inner.push(i)
    }
  }
  while (inner.length > 0) {
    const next: number[] = []
    for (const index of inner) {
      const x = index % width
      const y = (index - x) / width
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const at = ny * width + nx
        if (ring[at] === 0 || source[at] !== CLEAR) continue
        source[at] = source[index]!
        next.push(at)
      }
    }
    inner = next
  }

  /** 바깥 겹은 맞닿은 불투명 픽셀의 안쪽 색을 물려받는다. */
  for (const index of outer) {
    const x = index % width
    const y = (index - x) / width
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const at = ny * width + nx
      if ((data[at * 4 + 3] ?? 0) === 0) continue
      const from = source[at]!
      if (from >= 0) {
        source[index] = from
        break
      }
    }
  }

  let fixed = 0
  for (const index of edges) {
    const from = source[index]!
    // 물어볼 안쪽이 없는 조각은 그대로 둔다.
    if (from < 0) continue
    const at = index * 4
    const fat = from * 4
    const foreground = { r: data[fat] ?? 0, g: data[fat + 1] ?? 0, b: data[fat + 2] ?? 0 }
    const alpha = keyEdgeAlpha(
      { r: data[at] ?? 0, g: data[at + 1] ?? 0, b: data[at + 2] ?? 0 },
      foreground,
      key,
    )
    // 키가 섞이지 않은 픽셀은 안쪽 색만큼 멀리 있다. 건드릴 것이 없다.
    if (alpha >= 1) continue
    data[at] = foreground.r
    data[at + 1] = foreground.g
    data[at + 2] = foreground.b
    // 원래 알파와 곱한다. 이미 반투명한 픽셀을 불투명하게 되돌리지 않기 위해서다.
    data[at + 3] = Math.round((data[at + 3] ?? 255) * alpha)
    fixed += 1
  }

  for (const index of outer) {
    const from = source[index]!
    if (from < 0) continue
    const at = index * 4
    const fat = from * 4
    const foreground = { r: data[fat] ?? 0, g: data[fat + 1] ?? 0, b: data[fat + 2] ?? 0 }
    const alpha = keyEdgeAlpha(
      { r: data[at] ?? 0, g: data[at + 1] ?? 0, b: data[at + 2] ?? 0 },
      foreground,
      key,
    )
    // 진짜 배경은 키 색 그대로라 0이 나온다. 투명한 채로 둔다.
    if (alpha <= 0) continue
    data[at] = foreground.r
    data[at + 1] = foreground.g
    data[at + 2] = foreground.b
    // 지워진 자리이므로 **곱하지 않고 정한다** — 곱하면 0에 0을 곱해 그대로다.
    data[at + 3] = Math.round(255 * alpha)
    fixed += 1
  }
  return fixed
}
