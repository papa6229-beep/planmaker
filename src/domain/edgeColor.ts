/**
 * 배너 끝단의 색을 읽는다 (배너 Patch §1).
 *
 * 1020×70 계열의 얇은 띠 배너는 **만들고 나서 끝부분 색을 따로 적어 내야 한다.**
 * `#354151` 같은 값이다. 그 띠가 놓이는 자리의 좌우로 페이지가 이어지기 때문에,
 * 배경색을 띠의 끝 색에 맞춰야 경계가 보이지 않는다. 지금은 사람이 배너를 뽑아
 * 놓고 스포이드로 찍는다.
 *
 * 배너를 우리가 뽑으므로 그 값은 이미 우리 손에 있다. 끝 한 줄을 읽으면 된다 —
 * 그러면 스포이드로 찍는 단계가 통째로 사라진다.
 *
 * **평균이 아니라 중앙값**을 쓴다. 끝줄에 로고 한 조각이나 테두리 한 획이 걸려
 * 있으면 평균은 그쪽으로 끌려가지만, 중앙값은 끝줄의 대부분이 무슨 색인지를
 * 말한다. 우리가 알고 싶은 것은 후자다.
 *
 * 채널마다 따로 중앙값을 낸다. 그래서 그림에 없던 색이 나올 수도 있는데, 끝줄이
 * 그라디언트일 때는 그 편이 오히려 가운데 색을 준다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import type { PixelBuffer } from './chromaKey'

export type EdgeSide = 'left' | 'right' | 'top' | 'bottom'

/**
 * 몇 줄을 읽을 것인가.
 *
 * 한 줄만 읽으면 이미지 인코더가 마지막 줄에 남긴 흔들림을 그대로 받는다. 두
 * 줄이면 그런 한 줄짜리 사고에 흔들리지 않으면서, 안쪽 색을 끌어오지도 않는다.
 */
export const EDGE_DEPTH = 2

/** 이 알파 아래는 없는 픽셀로 센다 (`chromaKey`와 같은 기준). */
const ALPHA_FLOOR = 8

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  const mid = values.length >> 1
  if (values.length % 2 === 1) return values[mid] ?? 0
  return Math.round(((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2)
}

function pad(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).toUpperCase().padStart(2, '0')
}

/** `{ r, g, b }`를 `#RRGGBB`로. 대문자다 — 색상 코드는 대개 그렇게 적힌다. */
export function toHex(color: { r: number; g: number; b: number }): string {
  return `#${pad(color.r)}${pad(color.g)}${pad(color.b)}`
}

/**
 * 한쪽 끝의 대표 색. 읽을 것이 없으면 `null`.
 *
 * `null`을 돌려주는 것은 실패가 아니라 **모른다**는 뜻이다. 끝줄이 전부 투명한
 * 배너에는 맞춰야 할 색이 애초에 없다. 그때 검정을 지어내 주면, 받는 사람은 그
 * 값을 믿고 배경에 칠한다.
 */
export function edgeColor(pixels: PixelBuffer, side: EdgeSide, depth: number = EDGE_DEPTH): string | null {
  const { data, width, height } = pixels
  if (width <= 0 || height <= 0) return null
  const reach = Math.max(1, Math.round(depth))

  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const take = (x: number, y: number): void => {
    const at = (y * width + x) * 4
    if ((data[at + 3] ?? 0) <= ALPHA_FLOOR) return
    rs.push(data[at] ?? 0)
    gs.push(data[at + 1] ?? 0)
    bs.push(data[at + 2] ?? 0)
  }

  const band = Math.min(reach, side === 'left' || side === 'right' ? width : height)
  for (let step = 0; step < band; step += 1) {
    if (side === 'left' || side === 'right') {
      const x = side === 'left' ? step : width - 1 - step
      for (let y = 0; y < height; y += 1) take(x, y)
    } else {
      const y = side === 'top' ? step : height - 1 - step
      for (let x = 0; x < width; x += 1) take(x, y)
    }
  }

  if (rs.length === 0) return null
  return toHex({ r: median(rs), g: median(gs), b: median(bs) })
}
