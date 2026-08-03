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
 * 이번 tick에 스크롤할 양. 아래로 양수, 위로 음수, 가운데에서는 0.
 *
 * 가장자리에 깊이 들어갈수록 빨라지고, 작업영역 밖으로 포인터가 나가도 멈추지
 * 않는다 (최대 속도로 계속). 화면 밖으로 조금 벗어났다고 조절이 끊기면 긴
 * 페이지는 한 번에 늘일 수 없다.
 */
export function autoScrollStep(pointerY: number, top: number, bottom: number): number {
  if (bottom <= top) return 0
  const zone = Math.min(EDGE_ZONE, (bottom - top) / 2)
  if (zone <= 0) return 0

  const belowEdge = pointerY - (bottom - zone)
  if (belowEdge > 0) return Math.round(Math.min(1, belowEdge / zone) * MAX_SCROLL_STEP)

  const aboveEdge = top + zone - pointerY
  if (aboveEdge > 0) return -Math.round(Math.min(1, aboveEdge / zone) * MAX_SCROLL_STEP)

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
