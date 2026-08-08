/**
 * 배너로 잘라 쓸 조용한 자리 찾기 (배너 Patch §1).
 *
 * 배너의 배경은 새로 그리지 않는다. 메인 이벤트 페이지에 쓴 배경을 그대로 잘라
 * 쓴다 — 그래야 같은 이벤트로 보이고, 호출도 들지 않는다.
 *
 * 문제는 **어디를 자르느냐**다. 메인 배경에는 하트·풍선·리본·반짝이가 흩어져
 * 있는데, 그 자리를 골라 178×90 안에 넣으면 글자와 겹쳐 읽히지 않는다. 배너는
 * 작고 들어갈 말은 이미 정해져 있어서, 배경까지 시끄러우면 가장 먼저 무너지는
 * 것이 가독성이다.
 *
 * 그래서 화소가 얼마나 요동치는지를 재서 **가장 잔잔한 자리**를 고른다. 매끈한
 * 하늘은 이웃과의 차이가 거의 없고, 하트의 윤곽은 크다. 그레인은 그림 전체에
 * 고르게 얹히므로 모든 칸에 같은 값을 더할 뿐, 순위를 바꾸지 않는다.
 *
 * 한 걸음 더 간다. 우리는 **글자가 어디 놓일지 이미 안다** — 규격마다 틀의 슬롯이
 * 정해져 있다. 그러면 "전체가 잔잔한 자리"가 아니라 **"글자 밑이 잔잔한 자리"**를
 * 고르는 편이 낫다. 풍선이 하나 있어도 글자가 없는 쪽에 있으면 방해가 아니고,
 * 오히려 그쪽이 배너가 심심해지지 않게 한다.
 *
 * 자르는 크기는 **가능한 한 크게**다. 크게 잘라 줄여 쓰면 배경의 무늬도 함께
 * 작아져 덜 방해한다. 작게 잘라 키우면 무늬만 커진다.
 *
 * 고른 자리가 그래도 시끄러우면 부르는 쪽이 다음 수단으로 내려간다 — 흐리게
 * 깔거나, 색만 뽑아 그라디언트로 헹구거나. 그 판단에 쓰라고 `activity`를 함께
 * 돌려준다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import type { PixelBuffer } from './chromaKey'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 배너 안에서 글자가 놓일 자리. **배너 기준 0~1 비율**이다.
 *
 * 픽셀이 아니라 비율인 이유는, 이 자리를 정하는 것이 규격별 틀이고 틀은 배너
 * 크기로 적히기 때문이다. 원본에서 어느 만큼을 잘라 오든 비율은 그대로 옮겨진다.
 */
export interface QuietSlot {
  x: number
  y: number
  width: number
  height: number
  /** 이 자리의 가독성이 얼마나 중요한가. 기본 1. */
  weight?: number
}

export interface QuietOptions {
  /** 몇 픽셀을 한 칸으로 묶어 잴 것인가. */
  cell?: number
  slots?: readonly QuietSlot[]
  /**
   * 슬롯 **바깥**도 얼마나 볼 것인가.
   *
   * 0으로 두면 글자 밑만 보므로, 글자 옆이 아무리 어지러워도 개의치 않는다. 배너
   * 한 장 전체가 어지러워 보이는 것도 문제이므로 조금은 본다.
   */
  outsideWeight?: number
}

export interface QuietPick {
  rect: Rect
  /**
   * 0~1. 고른 자리가 얼마나 시끄러운가 — 슬롯 가중치를 반영한 값이다.
   *
   * 이웃 화소와의 채널 차이를 255로 나눈 것이라, 매끈한 그라디언트는 0에 가깝고
   * 무늬가 많을수록 커진다.
   */
  activity: number
}

export const QUIET_CELL = 8
export const QUIET_OUTSIDE_WEIGHT = 0.25

/**
 * 이 위로는 "잘라 쓰기"가 무리라고 볼 값.
 *
 * 실제 배경에서 재 본 뒤 손질할 **시작값**이다. 이 숫자 하나로 사다리의 1단과
 * 2단이 갈리므로, 브라우저에서 실물을 보고 정하는 것이 맞다. 여기서는 부르는 쪽이
 * 쓰기만 하고, 판단은 밖에서 한다.
 */
export const QUIET_ENOUGH = 0.02

/** 이 알파 아래는 없는 픽셀로 센다 (`chromaKey`와 같은 기준). */
const ALPHA_FLOOR = 8

/**
 * 두 화소가 얼마나 다른가 — 채널 중 가장 크게 벌어진 것.
 *
 * 밝기만 보면 파란 하늘 위의 분홍 하트처럼 **밝기는 비슷한데 색만 다른** 무늬를
 * 놓친다. 그런 무늬가 글자 뒤에 오면 밝기 차이가 적은 만큼 오히려 더 지저분하다.
 */
function channelDiff(data: Uint8ClampedArray, a: number, b: number): number {
  if ((data[a + 3] ?? 0) <= ALPHA_FLOOR || (data[b + 3] ?? 0) <= ALPHA_FLOOR) return 0
  const dr = Math.abs((data[a] ?? 0) - (data[b] ?? 0))
  const dg = Math.abs((data[a + 1] ?? 0) - (data[b + 1] ?? 0))
  const db = Math.abs((data[a + 2] ?? 0) - (data[b + 2] ?? 0))
  return Math.max(dr, dg, db)
}

/** 칸마다의 평균 요동. 0~1. */
function activityCells(pixels: PixelBuffer, cell: number, cols: number, rows: number): Float64Array {
  const { data, width, height } = pixels
  const sum = new Float64Array(cols * rows)
  const count = new Float64Array(cols * rows)
  for (let y = 0; y < height; y += 1) {
    const cy = Math.min(rows - 1, (y / cell) | 0)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      let diff = 0
      if (x + 1 < width) diff = Math.max(diff, channelDiff(data, at, at + 4))
      if (y + 1 < height) diff = Math.max(diff, channelDiff(data, at, at + width * 4))
      const c = Math.min(cols - 1, (x / cell) | 0) + cy * cols
      sum[c] = (sum[c] ?? 0) + diff
      count[c] = (count[c] ?? 0) + 1
    }
  }
  const out = new Float64Array(cols * rows)
  for (let i = 0; i < out.length; i += 1) {
    const n = count[i] ?? 0
    out[i] = n > 0 ? (sum[i] ?? 0) / n / 255 : 0
  }
  return out
}

/**
 * 누적합 표. 어느 사각형의 합이든 네 번 읽어 구한다.
 *
 * 창을 한 칸씩 밀며 매번 다시 더하면 큰 배경에서 눈에 띄게 느려진다. 창의 크기와
 * 상관없이 같은 값이 들도록 미리 쌓아 둔다.
 */
function summed(cells: Float64Array, cols: number, rows: number): Float64Array {
  const stride = cols + 1
  const sat = new Float64Array(stride * (rows + 1))
  for (let y = 0; y < rows; y += 1) {
    let rowSum = 0
    for (let x = 0; x < cols; x += 1) {
      rowSum += cells[y * cols + x] ?? 0
      sat[(y + 1) * stride + (x + 1)] = (sat[y * stride + (x + 1)] ?? 0) + rowSum
    }
  }
  return sat
}

function areaMean(sat: Float64Array, cols: number, x: number, y: number, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 0
  const stride = cols + 1
  const a = sat[y * stride + x] ?? 0
  const b = sat[y * stride + x + w] ?? 0
  const c = sat[(y + h) * stride + x] ?? 0
  const d = sat[(y + h) * stride + x + w] ?? 0
  return (d - b - c + a) / (w * h)
}

/**
 * 목표 비율의 창을 원본 위로 밀어 가장 잔잔한 자리를 고른다.
 *
 * `aspect`는 배너의 가로÷세로다. 돌려주는 사각형은 원본 좌표이고, 원본 밖으로
 * 나가지 않는다.
 */
export function quietRegion(pixels: PixelBuffer, aspect: number, options: QuietOptions = {}): QuietPick {
  const { width, height } = pixels
  if (width <= 0 || height <= 0 || !(aspect > 0)) {
    return { rect: { x: 0, y: 0, width: 0, height: 0 }, activity: 0 }
  }

  // 가장 크게 자른다 — 크게 잘라 줄이면 배경의 무늬도 함께 작아진다.
  let winW = width
  let winH = Math.round(winW / aspect)
  if (winH > height) {
    winH = height
    winW = Math.min(width, Math.round(winH * aspect))
  }
  winW = Math.max(1, winW)
  winH = Math.max(1, winH)

  const cell = Math.max(1, Math.round(options.cell ?? QUIET_CELL))
  const cols = Math.max(1, Math.ceil(width / cell))
  const rows = Math.max(1, Math.ceil(height / cell))
  const sat = summed(activityCells(pixels, cell, cols, rows), cols, rows)

  const wc = Math.max(1, Math.min(cols, Math.round(winW / cell)))
  const hc = Math.max(1, Math.min(rows, Math.round(winH / cell)))

  const slots = options.slots ?? []
  const outside = slots.length > 0 ? Math.max(0, options.outsideWeight ?? QUIET_OUTSIDE_WEIGHT) : 1
  // 슬롯을 **창 안의 칸 범위**로 한 번만 옮겨 둔다. 창을 밀 때마다 다시 계산할
  // 것이 없다 — 창 안에서의 자리는 어디로 밀든 같기 때문이다.
  const bands = slots.map((slot) => {
    const sx = Math.max(0, Math.min(wc - 1, Math.floor(slot.x * wc)))
    const sy = Math.max(0, Math.min(hc - 1, Math.floor(slot.y * hc)))
    return {
      sx,
      sy,
      sw: Math.max(1, Math.min(wc - sx, Math.round(slot.width * wc))),
      sh: Math.max(1, Math.min(hc - sy, Math.round(slot.height * hc))),
      weight: Math.max(0, slot.weight ?? 1),
    }
  })
  const weightSum = bands.reduce((total, band) => total + band.weight, 0) + outside || 1

  // 같은 점수면 가운데 쪽을 고른다. 원본의 가장자리는 잘려 나간 자리라 잔잔하기
  // 쉬운데, 거기만 고르면 배너마다 이벤트의 한구석만 보이게 된다.
  const midX = (cols - wc) / 2
  const midY = (rows - hc) / 2
  let bestX = 0
  let bestY = 0
  let bestScore = Infinity
  let bestNear = Infinity
  for (let y = 0; y + hc <= rows; y += 1) {
    for (let x = 0; x + wc <= cols; x += 1) {
      let score = outside > 0 ? outside * areaMean(sat, cols, x, y, wc, hc) : 0
      for (const band of bands) {
        score += band.weight * areaMean(sat, cols, x + band.sx, y + band.sy, band.sw, band.sh)
      }
      score /= weightSum
      const near = (x - midX) ** 2 + (y - midY) ** 2
      if (score < bestScore - 1e-9 || (score < bestScore + 1e-9 && near < bestNear)) {
        bestX = x
        bestY = y
        bestScore = score
        bestNear = near
      }
    }
  }

  return {
    rect: {
      x: Math.max(0, Math.min(width - winW, bestX * cell)),
      y: Math.max(0, Math.min(height - winH, bestY * cell)),
      width: winW,
      height: winH,
    },
    activity: Number.isFinite(bestScore) ? bestScore : 0,
  }
}
