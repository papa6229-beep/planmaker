/**
 * 기획서를 배너 기획서로 옮긴다 (배너 Patch §2).
 *
 * 배너를 **이미지로 만들지 않는다.** 결과물이 PNG면 나온 뒤에는 손댈 수가 없고,
 * 자동 배치는 아무리 잘해도 마지막 손질이 필요하다.
 *
 * 그래서 여기서 나오는 것은 **또 하나의 기획서 페이지**다. 크기만 배너 규격이고
 * 안에 든 것은 같은 블록이다. 그러면 이미 있는 편집기가 그대로 먹힌다 — 위치,
 * 크기, 앞뒤, 삭제, 복제 전부. 그리고 마지막에 `renderComposite(plan, sources,
 * { scale })`로 뽑는다.
 *
 * 조각도 다시 만들지 않는다. 메인에서 이미 생성한 제목 조각·버튼 조각·상품 사진을
 * 그대로 옮겨 쓴다. `assetId`가 따라가므로 배너 다섯 장을 만드는 데 새 이미지가
 * 거의 필요 없다.
 *
 * ## 자리를 못 얻은 블록을 어떻게 하는가
 *
 * 이 파일에서 가장 조심한 자리다. 셋으로 갈린다.
 *
 *  - **빠진다** — 양보 목록 끝이 `drop`인 것. 기간, 로고, 그리고 모양이 안 맞는
 *    그림. 뺀 것은 조각 서랍에서 사람이 다시 꺼낼 수 있다.
 *  - **남는다, 자리 없이** — 제목과 CTA. 이 둘은 뺄 수 없으므로, 자리를 못 얻으면
 *    **그렇다고 말한다.** 조용히 빼면 제목 없는 배너가 나오고, 억지로 밀어 넣으면
 *    다른 것과 겹친 배너가 나온다. 둘 다 사람이 알아야 고칠 수 있는 일이다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import { bannerOrder, bannerRoleOf, goesToBanner, nextConcession, type Concession } from './bannerRules'
import type { BannerSlot, BannerSpec } from './bannerSpec'
import type { BriefBlock } from './briefSchema'
import type { LayoutRect } from './imageLayout'
import { DEFAULT_REFERENCE_OPACITY, type BriefPage } from './pageSchema'

/** 한 자리에 여럿이 들어올 때 비워 두는 틈 — 자리의 흐름 방향 길이 대비. */
const SLOT_GAP = 0.06

/**
 * 자리를 이만큼도 못 채우면 그 자리에 어울리지 않는다 (배너 Patch §2-2).
 *
 * 앞선 판은 자리를 얻은 블록에게 **자리 전체**를 주었다. 그러면 세로로 긴 가차
 * 기계가 가로로 긴 상자를 받아 옆으로 찌그러진다. 비율을 지켜 넣으면 찌그러지지는
 * 않지만, 이번에는 204×56 자리에 39×56짜리 조각이 덩그러니 남는다.
 *
 * 그때는 **뺀다.** 한때 배경으로 내려 깔아 보았지만 — 이벤트3의 가차 기계가 그랬듯 —
 * 인물 컷아웃은 늘리면 얼룩이고, 작업자가 "배경에 뭐가 깔린지 모르겠다"고 했다.
 * 빼고 그렇다고 말하면, 필요한 사람은 조각 서랍에서 다시 꺼낸다.
 */
export const MIN_SLOT_FILL = 0.25

/**
 * 이 배너 페이지의 번호 (배너 Patch §5).
 *
 * 원본 페이지와 규격에서 **정해진 값**이 나온다. 그래야 같은 규격을 다시 뽑을 때
 * 새 페이지가 생기지 않고 제자리에서 바뀐다.
 */
export const BANNER_PAGE_PREFIX = 'banner_'

export function bannerPageId(sourcePageId: string, specId: string): string {
  return `${BANNER_PAGE_PREFIX}${sourcePageId}_${specId}`
}

/**
 * 배너 안에서 이 블록이 쓸 번호.
 *
 * **원본과 같은 번호를 쓰면 안 된다.** 합성 효과·블록별 톤·연결한 제품 이미지가
 * 전부 블록 번호로 매달려 있어서, 번호가 같으면 배너에 건 톤이 메인 이벤트
 * 페이지까지 바꾼다. 페이지 복제가 같은 문제를 겪고 새 번호를 받는 길로 풀었다.
 */
export function bannerBlockId(pageId: string, blockId: string): string {
  return `${pageId}__${blockId}`
}

/**
 * 배너 페이지 번호에서 원본 페이지를 되찾는다.
 *
 * 규격 번호를 **알고 있어야** 한다. 임의 크기 규격은 `custom_640x200`처럼 밑줄이
 * 들어 있어서, 마지막 밑줄에서 자르면 `custom_640`을 규격으로 읽고 원본 번호에
 * `_custom`이 붙는다. 그렇게 잘린 번호로는 원본을 못 찾는다.
 */
export function sourcePageIdOf(bannerPageId: string, specId: string): string | null {
  const tail = `_${specId}`
  if (!bannerPageId.startsWith(BANNER_PAGE_PREFIX) || !bannerPageId.endsWith(tail)) return null
  return bannerPageId.slice(BANNER_PAGE_PREFIX.length, bannerPageId.length - tail.length)
}

export interface BannerPlacement {
  blockId: string
  slotId: string
  rect: LayoutRect
  /** 자리를 얻는 동안 실제로 한 양보. 아무것도 안 했으면 비어 있다. */
  applied: readonly Concession[]
}

export type DropReason =
  /** 배너에 가지 않는 종류 — 주의 문구, 링크, 메모. */
  | 'not-for-banner'
  /** 받아 주는 자리가 없었다. */
  | 'no-slot'
  /** 자리는 있었지만 그 모양으로는 어울리지 않았다. */
  | 'no-shape'

export interface BannerFit {
  spec: BannerSpec
  placements: readonly BannerPlacement[]
  dropped: readonly { blockId: string; reason: DropReason }[]
  /**
   * 자리를 못 얻었지만 **빼서도 안 되는** 것 — 제목과 CTA.
   *
   * 비어 있지 않으면 그 배너는 아직 사람 손이 필요하다. 이 목록을 무시하고 그냥
   * 뽑으면 제목이 없는 배너가 나간다.
   */
  unplaced: readonly string[]
}

/** 자리 하나가 통째로 차지하는 칸. 여럿이 들어오면 이것을 나눈다. */
function slotCell(slot: BannerSlot, index: number, count: number, width: number, height: number): LayoutRect {
  const x = slot.area.x * width
  const y = slot.area.y * height
  const w = slot.area.width * width
  const h = slot.area.height * height
  if (count <= 1) return { x, y, width: w, height: h }

  const span = slot.flow === 'row' ? w : h
  const gapTotal = span * SLOT_GAP
  const gap = gapTotal / (count - 1)
  const each = (span - gapTotal) / count
  return slot.flow === 'row'
    ? { x: x + index * (each + gap), y, width: each, height: h }
    : { x, y: y + index * (each + gap), width: w, height: each }
}

/**
 * 칸 안에 **제 비율을 지켜** 넣고 가운데로 모은다.
 *
 * 칸을 통째로 주면 조각이 늘어나거나 찌그러진다. 배너에 들어가는 것은 이미 만들어
 * 놓은 그림 조각이라 — 제목도 버튼도 상품 사진도 — 늘리면 그 그림이 망가진다.
 */
function containIn(cell: LayoutRect, aspect: number): LayoutRect {
  if (!(aspect > 0)) return cell
  let w = cell.width
  let h = w / aspect
  if (h > cell.height) {
    h = cell.height
    w = h * aspect
  }
  return { x: cell.x + (cell.width - w) / 2, y: cell.y + (cell.height - h) / 2, width: w, height: h }
}

/**
 * 이 블록이 이 칸에서 가질 비율. 눕히는 것이 나으면 눕힌 비율을 준다.
 *
 * 세로로 긴 글자를 가로로 긴 칸에 그대로 넣으면 손가락만 한 폭이 남는다. 눕히면
 * 칸을 거의 다 쓴다 — 이벤트3의 `ADULT ONLY - R19`가 1020×70에서 그렇게 되었다.
 */
function aspectIn(block: BriefBlock, cell: LayoutRect): { aspect: number; rotated: boolean } {
  const own = block.position.width / Math.max(1, block.position.height)
  if (!(own > 0)) return { aspect: 1, rotated: false }
  const canRotate = bannerRoleOf(block.type).concessions.includes('rotate')
  const cellAspect = cell.width / Math.max(1, cell.height)
  // 눕혀야 이득인 경우만 눕힌다 — 칸이 가로로 길고 블록이 세로로 길 때.
  if (canRotate && cellAspect > 1 && own < 1) return { aspect: 1 / own, rotated: true }
  return { aspect: own, rotated: false }
}

function fillOf(cell: LayoutRect, box: LayoutRect): number {
  const area = cell.width * cell.height
  return area > 0 ? (box.width * box.height) / area : 0
}

/** 배너 좌표는 픽셀이다. 소수점이 남으면 편집기에서 1px씩 어긋나 보인다. */
function round(rect: LayoutRect, width: number, height: number): LayoutRect {
  const w = Math.max(1, Math.round(rect.width))
  const h = Math.max(1, Math.round(rect.height))
  return {
    x: Math.max(0, Math.min(width - w, Math.round(rect.x))),
    y: Math.max(0, Math.min(height - h, Math.round(rect.y))),
    width: w,
    height: h,
  }
}

/**
 * 어떤 블록이 어느 자리로 가는가.
 *
 * 중요도가 높은 것부터 자리를 고른다. 같은 일을 받는 자리가 여럿이면 앞의 것부터
 * 채운다 — 얇은 띠에서 혜택이 왼쪽부터 차는 것이 그 때문이다.
 */
export function fitBanner(blocks: readonly BriefBlock[], spec: BannerSpec): BannerFit {
  const placements: BannerPlacement[] = []
  const dropped: { blockId: string; reason: DropReason }[] = []
  const unplaced: string[] = []

  for (const block of blocks) {
    if (!goesToBanner(block.type)) dropped.push({ blockId: block.id, reason: 'not-for-banner' })
  }

  // 자리마다 누가 들어왔는지. 몇 번째로 들어왔는지가 그 안의 위치를 정한다.
  const taken = new Map<string, { id: string; rotated: boolean }[]>(spec.slots.map((slot) => [slot.id, []]))

  for (const block of bannerOrder(blocks)) {
    const role = bannerRoleOf(block.type)
    const slot = spec.slots.find(
      (candidate) => candidate.accepts.includes(role.purpose) && taken.get(candidate.id)!.length < candidate.capacity,
    )
    if (slot !== undefined) {
      // 자리를 얻었다고 끝이 아니다. **모양이 맞는지**를 여기서 본다. 칸 전체를
      // 혼자 쓴다고 쳐도 이만큼도 못 채우면, 그 자리는 이 블록의 자리가 아니다.
      const whole = slotCell(slot, 0, 1, spec.width, spec.height)
      const { aspect, rotated } = aspectIn(block, whole)
      // **줄일 수 없는 히어로에게만** 묻는다. 개수를 줄일 수 있는 뭉치나 글자는
      // 작게 들어가도 제 몫을 한다 — 이벤트2의 70px 띠에서 사은품 사진이 그랬다.
      // 이 조건을 넓히면 그런 것들까지 조용히 빠진다.
      const cannotThin = role.purpose === 'imagery' && !role.concessions.includes('thin')
      if (cannotThin && fillOf(whole, containIn(whole, aspect)) < MIN_SLOT_FILL && role.concessions.includes('drop')) {
        dropped.push({ blockId: block.id, reason: 'no-shape' })
        continue
      }
      taken.get(slot.id)!.push({ id: block.id, rotated })
      continue
    }

    // 받아 주는 자리가 없다. 양보 목록에서 **자리 문제를 푸는 수단**을 찾는다.
    // 줄바꿈·열 수·이름표는 자리 안에서 줄이는 일이라 여기서는 도움이 안 된다.
    const applied: Concession[] = []
    let settled = false
    for (let step = nextConcession(block.type); step !== null; step = nextConcession(block.type, applied)) {
      applied.push(step)
      if (step === 'drop') {
        dropped.push({ blockId: block.id, reason: 'no-slot' })
        settled = true
        break
      }
    }
    // 물러날 데까지 다 갔는데도 남았다 — 제목과 CTA다. 조용히 빼지 않는다.
    if (!settled) unplaced.push(block.id)
  }

  const byId = new Map(blocks.map((block) => [block.id, block]))
  for (const slot of spec.slots) {
    const seats = taken.get(slot.id)!
    for (const [index, seat] of seats.entries()) {
      const block = byId.get(seat.id)!
      const cell = slotCell(slot, index, seats.length, spec.width, spec.height)
      const own = block.position.width / Math.max(1, block.position.height)
      placements.push({
        blockId: seat.id,
        slotId: slot.id,
        rect: round(containIn(cell, seat.rotated ? 1 / own : own), spec.width, spec.height),
        applied: seat.rotated ? ['rotate'] : [],
      })
    }
  }

  return { spec, placements, dropped, unplaced }
}

/**
 * 배너 규격의 기획서 페이지 하나.
 *
 * 원본 페이지는 **건드리지 않는다.** 블록은 복제해서 자리만 바꾼다 — 배너를
 * 뽑았다고 메인 이벤트 페이지의 배치가 흔들리면 안 된다.
 *
 * 배열의 차례가 곧 앞뒤다 — 앞에 있는 것이 뒤에 깔린다.
 */
export function buildBannerPage(page: BriefPage, spec: BannerSpec): { page: BriefPage; fit: BannerFit } {
  const fit = fitBanner(page.blocks, spec)
  const byId = new Map(page.blocks.map((block) => [block.id, block]))

  const front: BriefBlock[] = fit.placements.flatMap((placement) => {
    const block = byId.get(placement.blockId)
    return block === undefined ? [] : [{ ...block, position: { ...placement.rect } }]
  })

  return {
    page: {
      // **정해진 번호**를 쓴다. 무작위 번호를 주면 작업이 기억하는 번호와 달라져,
      // 같은 배너를 두고 문서와 작업이 서로를 못 찾는다 — 실제로 그랬다. 같은
      // 규격을 다시 뽑을 때 제자리에서 바뀌는 것도 이 번호 덕이다.
      id: bannerPageId(page.id, spec.id),
      title: `${page.title} · ${spec.width}×${spec.height}`,
      blocks: front,
      canvasWidth: spec.width,
      canvasHeight: spec.height,
      reference: { viewMode: 'canvas', opacity: DEFAULT_REFERENCE_OPACITY, fit: 'width', visible: false },
    },
    fit,
  }
}
