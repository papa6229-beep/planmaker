/**
 * 페이지 길이 손잡이 드래그 (첫 사용 흐름 §3).
 *
 * 손잡이를 잡고 끌 때 두 가지가 동시에 일어나야 한다: 중앙 작업영역이 스스로
 * 스크롤되고, 그 사이에도 페이지 높이가 계속 따라와야 한다. 예전에는 높이를
 * "시작점에서 얼마나 움직였는가"로 계산해서, 패널이 스크롤되어도 포인터가
 * 멈춰 있으면 높이가 멈췄다 — 그래서 손잡이를 놓고 스크롤한 뒤 다시 잡아야 했다.
 *
 * 그래서 높이는 이동량이 아니라 **포인터가 문서의 몇 px 지점에 있는가**로
 * 계산한다. 종이의 화면상 위치를 매번 다시 읽으므로, 패널이 스크롤되면 같은
 * 포인터 위치가 더 아래의 문서 좌표를 가리키게 되고 높이는 저절로 자란다.
 *
 * 두 함수 모두 순수하다. 화면·타이머·DOM은 호출부가 맡는다.
 */

/** 이 거리 안으로 들어오면 작업영역이 스스로 스크롤된다. */
export const EDGE_ZONE = 56

/** 한 번의 tick에서 스크롤할 수 있는 최대 픽셀. */
export const MAX_SCROLL_STEP = 28

/**
 * 가장자리에 들어간 깊이(0~1)를 속도로 바꾼다.
 *
 * 곧게 비례시키면 문턱을 넘는 순간 이미 절반 속도라, 조금만 밀어도 페이지가
 * 쏟아지듯 늘어났다 — "컨트롤이 상당히 어려워". 제곱하면 문턱 근처는 기어가고
 * 깊이 밀었을 때만 빨라져서, 같은 최고 속도를 두고도 손이 따라간다.
 */
function ramp(depth: number): number {
  const t = Math.min(1, Math.max(0, depth))
  return t * t
}

/**
 * 이번 tick에 스크롤할 양. 아래로 양수, 위로 음수, 가운데에서는 0.
 *
 * 가장자리에 깊이 들어갈수록 빨라지고, 작업영역 밖으로 포인터가 나가도 멈추지
 * 않는다 (최대 속도로 계속). 화면 밖으로 조금 벗어났다고 조절이 끊기면 긴
 * 페이지는 한 번에 늘일 수 없다.
 *
 * `fromY`는 **손잡이를 잡은 자리**다. 손잡이는 페이지 끝에 붙어 있으므로 그것을
 * 보려고 스크롤한 뒤 잡으면, 잡는 순간 이미 아래 가장자리 안이다. 그 자리를
 * 문턱으로 삼지 않으면 누르자마자 최고 속도로 흘러내린다. 그래서 잡은 자리가
 * 가장자리보다 아래면 **거기서부터** 다시 잰다 — 아래로 밀어야 비로소 움직인다.
 */
export function autoScrollStep(pointerY: number, top: number, bottom: number, fromY?: number): number {
  if (bottom <= top) return 0
  const zone = Math.min(EDGE_ZONE, (bottom - top) / 2)
  if (zone <= 0) return 0

  const downEdge = fromY === undefined ? bottom - zone : Math.max(bottom - zone, fromY)
  const belowEdge = pointerY - downEdge
  if (belowEdge > 0) return Math.round(ramp(belowEdge / zone) * MAX_SCROLL_STEP)

  const upEdge = fromY === undefined ? top + zone : Math.min(top + zone, fromY)
  const aboveEdge = upEdge - pointerY
  if (aboveEdge > 0) return -Math.round(ramp(aboveEdge / zone) * MAX_SCROLL_STEP)

  return 0
}

/** 화살표 한 번에 움직이는 픽셀. Shift는 굵게, PageUp/Down은 더 굵게. */
export const HEIGHT_STEP = 10
export const HEIGHT_STEP_BIG = 100
export const HEIGHT_STEP_PAGE = 400

/**
 * 자판으로 미는 길이 변화량. 길이 손잡이에 초점이 있을 때 쓴다.
 *
 * 끌기는 빠르지만 정확하지 않다. 원하는 자리 근처까지 끌어 놓고 마지막 몇 px은
 * 화살표로 맞추는 것이 사람이 실제로 하는 일이라, 손잡이 자체가 자판을 받는다.
 * 아는 키가 아니면 `0`을 돌려주므로 호출부는 그때 기본 동작을 막지 않는다.
 */
export function heightKeyDelta(key: string, shift: boolean): number {
  if (key === 'PageUp') return -HEIGHT_STEP_PAGE
  if (key === 'PageDown') return HEIGHT_STEP_PAGE
  const big = shift ? HEIGHT_STEP_BIG : HEIGHT_STEP
  if (key === 'ArrowUp') return -big
  if (key === 'ArrowDown') return big
  return 0
}

/**
 * 포인터가 가리키는 페이지 높이.
 *
 * `sheetTop`은 종이의 현재 화면상 위쪽(스크롤이 반영된 값), `grabOffset`은
 * 손잡이를 잡은 순간 포인터가 페이지 끝에서 얼마나 아래였는지다. 그래서 잡은
 * 지점이 그대로 유지된 채 늘어난다. 확대율은 문서 좌표로 되돌린다.
 */
export function heightForPointer(
  pointerY: number,
  sheetTop: number,
  zoom: number,
  grabOffset: number,
): number {
  const scale = zoom > 0 ? zoom : 1
  return (pointerY - sheetTop) / scale - grabOffset
}
