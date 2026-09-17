/**
 * 돋보기로 누른 자리를 붙든 채 배율을 바꾼다 (돋보기 도구 Patch, 2026-09-17).
 *
 * 포토샵처럼 누른 점이 화면에서 제자리에 남아야 한다. 배율이 바뀌어 판이 다시 그려진
 * 뒤에(다음 프레임) 판의 새 자리를 재고, 누른 점이 원래 화면 위치로 오도록 스크롤을 민다.
 * 판이 창보다 작아 가운데 정렬될 때도 판의 실제 자리를 재므로 맞는다.
 */
export function zoomKeepingPoint(
  scroller: HTMLElement | null,
  target: HTMLElement | null,
  client: { x: number; y: number },
  oldZoom: number,
  newZoom: number,
): void {
  if (scroller === null || target === null || oldZoom <= 0 || newZoom === oldZoom) return
  const before = target.getBoundingClientRect()
  const px = (client.x - before.left) / oldZoom
  const py = (client.y - before.top) / oldZoom
  requestAnimationFrame(() => {
    const after = target.getBoundingClientRect()
    scroller.scrollLeft += after.left + px * newZoom - client.x
    scroller.scrollTop += after.top + py * newZoom - client.y
  })
}
