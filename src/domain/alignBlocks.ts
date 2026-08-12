/**
 * 상자들을 줄 맞춰 세운다 (정렬 Patch).
 *
 * 지금까지는 눈대중이었다 — 상자를 끌어다 대충 맞추고, 한 칸 어긋난 것을 나중에
 * 발견한다. 작업자가 그 자리에서 말했다: "지금은 다 눈대중으로 위치를 맞추고
 * 있는데… 각 블록들의 정렬 기능이 있었으면 좋겠어."
 *
 * ## 기준이 무엇인가
 *
 * 이것이 정렬의 전부다. 기준이 헷갈리면 버튼을 눌러 보고서야 무슨 일이 났는지
 * 알게 되고, 그러면 쓰지 않게 된다. 규칙은 둘뿐이다:
 *
 *  - **하나만 골랐으면 캔버스**가 기준이다. 가운데로, 왼쪽 끝으로.
 *  - **여럿 골랐으면 마지막에 고른 것**이 기준이다. 나머지가 그것에 맞춰 온다.
 *
 * 마지막에 고른 것을 쓰는 이유는, 그것이 이 편집기가 이미 "지금 것"으로 삼는
 * 상자이기 때문이다 (`primarySelectedId`). "가장 왼쪽 것"을 기준으로 삼으면
 * 사람이 고르지 않은 상자가 기준이 되어, 누를 때마다 어디로 갈지 모른다.
 *
 * ## 균등 배분
 *
 * 양 끝 두 개는 **그 자리에 둔다.** 가운데 것들만 옮겨 **사이 간격을 같게**
 * 만든다. 중심 간격이 아니라 사이 간격인 것은, 크기가 다른 상자들을 늘어놓을 때
 * 눈에 고르게 보이는 것이 사이 간격이기 때문이다.
 *
 * 여기 있는 것은 전부 순수 함수다. 좌표만 바뀌고 크기는 손대지 않는다.
 */

import type { LayoutRect } from './imageLayout'

export type AlignMove =
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vcenter'
  | 'bottom'
  | 'hspread'
  | 'vspread'

export const ALIGN_MOVES: readonly { value: AlignMove; label: string; hint: string; min: number }[] = [
  { value: 'left', label: '왼쪽', hint: '왼쪽 맞춤', min: 1 },
  { value: 'hcenter', label: '가운데', hint: '가로 가운데 맞춤', min: 1 },
  { value: 'right', label: '오른쪽', hint: '오른쪽 맞춤', min: 1 },
  { value: 'top', label: '위', hint: '위 맞춤', min: 1 },
  { value: 'vcenter', label: '중간', hint: '세로 가운데 맞춤', min: 1 },
  { value: 'bottom', label: '아래', hint: '아래 맞춤', min: 1 },
  { value: 'hspread', label: '가로 고르게', hint: '가로 간격을 고르게 (셋 이상)', min: 3 },
  { value: 'vspread', label: '세로 고르게', hint: '세로 간격을 고르게 (셋 이상)', min: 3 },
]

/** 이 움직임을 쓰려면 몇 개를 골라야 하는가. 모르는 값은 하나다. */
export function alignNeeds(move: AlignMove): number {
  return ALIGN_MOVES.find((m) => m.value === move)?.min ?? 1
}

interface Axis {
  /** 이 축에서 상자의 시작과 길이를 꺼낸다. */
  start: (r: LayoutRect) => number
  size: (r: LayoutRect) => number
  /** 이 축의 시작값을 갈아 끼운 상자. */
  put: (r: LayoutRect, start: number) => LayoutRect
  bound: number
}

/**
 * 줄 맞춰 세운 상자들. **고른 차례 그대로** 돌려준다.
 *
 * `rects`의 **마지막**이 기준이다 — 편집기가 "지금 고른 것"으로 삼는 그 상자다.
 * 하나뿐이면 캔버스가 기준이 된다.
 *
 * 쓸 수 없는 움직임(셋이 필요한데 둘을 골랐다든가)이면 **받은 것을 그대로**
 * 돌려준다. 아무 일도 일어나지 않은 것이 잘못 움직인 것보다 낫다.
 */
export function alignRects(
  rects: readonly LayoutRect[],
  move: AlignMove,
  canvas: { width: number; height: number },
): LayoutRect[] {
  if (rects.length < alignNeeds(move)) return [...rects]

  const horizontal: Axis = {
    start: (r) => r.x,
    size: (r) => r.width,
    put: (r, start) => ({ ...r, x: start }),
    bound: canvas.width,
  }
  const vertical: Axis = {
    start: (r) => r.y,
    size: (r) => r.height,
    put: (r, start) => ({ ...r, y: start }),
    bound: canvas.height,
  }

  if (move === 'hspread' || move === 'vspread') {
    return spread(rects, move === 'hspread' ? horizontal : vertical)
  }

  const axis = move === 'left' || move === 'hcenter' || move === 'right' ? horizontal : vertical
  const side: 'start' | 'middle' | 'end' =
    move === 'left' || move === 'top' ? 'start' : move === 'right' || move === 'bottom' ? 'end' : 'middle'

  // 하나뿐이면 캔버스가 기준이다. 여럿이면 마지막에 고른 것.
  const anchor = rects.length === 1 ? { at: 0, size: axis.bound } : anchorOf(rects.at(-1)!, axis)

  return rects.map((rect) => {
    const size = axis.size(rect)
    const start =
      side === 'start'
        ? anchor.at
        : side === 'end'
          ? anchor.at + anchor.size - size
          : anchor.at + (anchor.size - size) / 2
    return axis.put(rect, Math.round(start))
  })
}

function anchorOf(rect: LayoutRect, axis: Axis): { at: number; size: number } {
  return { at: axis.start(rect), size: axis.size(rect) }
}

/**
 * 사이 간격을 고르게. 양 끝은 제자리다.
 *
 * 상자들이 이미 서로 겹쳐 있으면 남는 공간이 음수가 되는데, 그때도 계산은
 * 그대로 돈다 — 간격이 음수로 고르게 겹칠 뿐이고, 사람이 보기에도 그게
 * "고르게"의 뜻이다.
 */
function spread(rects: readonly LayoutRect[], axis: Axis): LayoutRect[] {
  const order = rects.map((rect, index) => ({ rect, index })).toSorted((a, b) => axis.start(a.rect) - axis.start(b.rect))
  const first = order[0]!
  const last = order.at(-1)!
  const span = axis.start(last.rect) + axis.size(last.rect) - axis.start(first.rect)
  const filled = order.reduce((sum, item) => sum + axis.size(item.rect), 0)
  const gap = (span - filled) / (order.length - 1)

  const moved = new Map<number, LayoutRect>()
  let at = axis.start(first.rect)
  for (const item of order) {
    moved.set(item.index, axis.put(item.rect, Math.round(at)))
    at += axis.size(item.rect) + gap
  }
  // 고른 차례 그대로 돌려준다 — 부르는 쪽이 자기 목록과 짝을 맞춘다.
  return rects.map((rect, index) => moved.get(index) ?? rect)
}
