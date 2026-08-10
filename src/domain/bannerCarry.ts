/**
 * 비슷한 크기의 배너로 작업을 옮긴다 (배너 이어받기 Patch).
 *
 * 작업자의 말이 근거다 — "유사한 비율의 사이즈의 배너들, 비율이 똑같은 게 아냐
 * 미묘하게 달라. 근데 그 비율 차이가 작아서 배치는 그대로 두고 조각들의 미세한
 * 위치나 크기 조정만 하거나, 일부 한두 가지 조각만 교체하거나 추가하면 되는
 * 부분이라서, 유사 사이즈 배너 하나를 작업했다면 다른 사이즈 배너 작업창을
 * 불러왔을 때 그 내용이 남아 있으면 좋겠다."
 *
 * 그래서 새 크기의 배너를 처음 뽑을 때, **이미 작업해 둔 배너 중 비율이 가장
 * 가까운 것**의 조각을 그대로 옮겨 놓는다. 백지가 아니라 손볼 것이 있는 화면에서
 * 시작하는 것이다.
 *
 * ## 크기를 어떻게 옮기는가
 *
 * 자리는 **가로세로 각각의 비율로** 옮기고, 크기는 **둘 중 작은 비율 하나로만**
 * 옮긴다. 자리까지 한 비율로 옮기면 840×640에서 오른쪽 끝에 붙여 둔 것이 500×387
 * 에서는 가운데로 들어오고, 크기를 두 비율로 나눠 옮기면 이미 만들어 둔 글자
 * 그림이 옆으로 눌린다. 둘 다 손으로 되돌려야 하는 일이다.
 *
 * 조각의 번호는 새 배너의 번호로 갈아입는다. 같은 번호를 쓰면 이쪽 배너에 건 톤이
 * 저쪽 배너까지 바꾼다.
 *
 * 순수 모듈이다. 저장소도 화면도 모른다.
 */

import { bannerBlockId, sourceBlockIdOf } from './bannerFit'
import type { StudioTextObject } from './textObjects'

export interface BannerSize {
  width: number
  height: number
}

/**
 * 이미 작업해 둔 배너 중 **비율이 가장 가까운** 것.
 *
 * 가로세로 비의 로그 거리로 잰다. 840×640(1.31)에서 500×387(1.29)로 가는 길과
 * 1020×70(14.6)에서 840×78(10.8)로 가는 길이 같은 자로 재어져야, 큰 비율의
 * 띠 배너들끼리 서로를 먼저 찾는다.
 */
export function closestBanner<T extends { pageId: string; size: BannerSize; pieceCount: number }>(
  candidates: readonly T[],
  to: BannerSize,
): T | null {
  const want = Math.log(to.width / Math.max(1, to.height))
  let best: T | null = null
  let bestGap = Infinity
  for (const item of candidates) {
    // 빈 배너에서 옮겨 올 것은 없다.
    if (item.pieceCount === 0) continue
    const gap = Math.abs(Math.log(item.size.width / Math.max(1, item.size.height)) - want)
    if (gap < bestGap) {
      best = item
      bestGap = gap
    }
  }
  return best
}

/** 조각 하나를 새 배너의 좌표와 번호로 옮긴다. */
function carryOne(
  piece: StudioTextObject,
  fromPageId: string,
  toPageId: string,
  from: BannerSize,
  to: BannerSize,
): StudioTextObject | null {
  const sourceId = sourceBlockIdOf(fromPageId, piece.blockId)
  if (sourceId === null) return null
  // `#2` 같은 복제 꼬리는 그대로 붙여 간다 — 두 벌이던 것이 새 크기에서 한 벌로
  // 합쳐지면 사람이 지운 적 없는 것이 사라진다.
  const tail = piece.blockId.slice(`${fromPageId}__${sourceId}`.length)
  const kx = to.width / Math.max(1, from.width)
  const ky = to.height / Math.max(1, from.height)
  const k = Math.min(kx, ky)
  return {
    ...piece,
    blockId: `${bannerBlockId(toPageId, sourceId)}${tail}`,
    rect: {
      x: Math.round(piece.rect.x * kx),
      y: Math.round(piece.rect.y * ky),
      width: Math.max(1, Math.round(piece.rect.width * k)),
      height: Math.max(1, Math.round(piece.rect.height * k)),
    },
  }
}

export interface CarriedWork {
  texts: StudioTextObject[]
  images: StudioTextObject[]
  /** 새 조각의 번호 → 설정을 물려받을 옛 조각의 번호. */
  settingsFrom: { from: string; to: string }[]
}

export function carryBannerWork(
  fromPageId: string,
  toPageId: string,
  from: BannerSize,
  to: BannerSize,
  texts: readonly StudioTextObject[],
  images: readonly StudioTextObject[],
): CarriedWork {
  const move = (list: readonly StudioTextObject[]) =>
    list.flatMap((piece) => {
      const next = carryOne(piece, fromPageId, toPageId, from, to)
      return next === null ? [] : [{ piece, next }]
    })
  const movedTexts = move(texts)
  const movedImages = move(images)
  return {
    texts: movedTexts.map((m) => m.next),
    images: movedImages.map((m) => m.next),
    // 컷아웃 두께도 톤도 함께 간다. 옮긴 배너에서만 다시 켜야 한다면 그건 옮긴
    // 것이 아니다.
    settingsFrom: [...movedTexts, ...movedImages].map((m) => ({ from: m.piece.blockId, to: m.next.blockId })),
  }
}
