/**
 * 배너 페이지의 번호와 빈 캔버스 (배너 Patch §2, 자동 배치 제거 Patch).
 *
 * 배너를 **이미지로 만들지 않는다.** 결과물이 PNG면 나온 뒤에는 손댈 수가 없다.
 * 여기서 나오는 것은 **또 하나의 기획서 페이지**이고, 크기만 배너 규격이다.
 * 그러면 이미 있는 편집기가 그대로 먹힌다 — 위치, 크기, 앞뒤, 삭제, 부분수정.
 *
 * ## 자동 배치를 걷어냈다
 *
 * 이 파일에는 중요도 순으로 자리를 나눠 주고, 안 들어가면 양보시키고, 그래도 안
 * 되면 빼는 배치기가 있었다. 실물을 보고 작업자가 말한 것은 이랬다 — **"이벤트
 * 페이지는 자동 배치를 해 주지, 왜냐 크니까. 하지만 배너는 작은 것들이 많아."**
 * 70px 높이에서는 자동이 놓은 자리를 고치는 것이 처음부터 놓는 것보다 오래 걸린다.
 *
 * 그래서 배너는 **빈 캔버스**로 시작한다. 배경만 깔리고 조각은 하나도 없다.
 * 이벤트 페이지 쪽 자동 배치는 손대지 않았다 — 그쪽은 크고, 거기서는 도움이 된다.
 *
 * ## 블록은 전부 데려온다
 *
 * 올려놓는 조각이 0개인데 블록은 전부 가져오는 것이 이상해 보이지만, 그렇게 해야
 * 한다. **이미지 조각은 제 블록이 그 페이지에 있어야 합성에 실린다** —
 * `planLocalComposite`이 `page.blocks`를 훑기 때문이다. 자리를 얻은 블록만
 * 데려오면 나머지는 서랍에서 꺼내도 그려지지 않는다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import type { BriefBlock } from './briefSchema'
import type { BannerSpec } from './bannerSpec'
import { DEFAULT_REFERENCE_OPACITY, type BriefPage } from './pageSchema'

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
 * 배너 조각의 번호에서 **원본 블록**을 되찾는다.
 *
 * 서랍에서 한 벌 더 꺼낸 복제본은 뒤에 `#2`가 붙는다. 그 꼬리를 떼야 원본의
 * 이름과 문구 원문을 찾을 수 있다 — 부분수정이 "무엇을 고치는가"를 그것으로 안다.
 */
export function sourceBlockIdOf(pageId: string, blockId: string): string | null {
  const head = `${pageId}__`
  if (!blockId.startsWith(head)) return null
  const rest = blockId.slice(head.length)
  const hash = rest.indexOf('#')
  return hash === -1 ? rest : rest.slice(0, hash)
}

/** 이 조각이 몇 벌째인가 — 첫 벌은 1. */
export function bannerCopyNo(blockId: string): number {
  const hash = blockId.lastIndexOf('#')
  if (hash === -1) return 1
  const n = Number(blockId.slice(hash + 1))
  return Number.isInteger(n) && n > 1 ? n : 1
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

/**
 * 원본 블록의 자리를 배너 캔버스로 줄여 옮긴다.
 *
 * 어디에 놓일지는 사람이 정하므로 이 값이 최종 자리는 아니다. 다만 840×1180
 * 좌표를 그대로 두면 70px 캔버스 바깥 저 멀리에 블록이 눕고, 기획서 쪽 화면을
 * 열었을 때 아무것도 안 보인다. 비율을 지켜 한 번 줄여 두면 그런 일이 없다.
 */
function shrink(block: BriefBlock, from: BriefPage, spec: BannerSpec): BriefBlock {
  const k = Math.min(spec.width / Math.max(1, from.canvasWidth), spec.height / Math.max(1, from.canvasHeight))
  const width = Math.max(1, Math.round(block.position.width * k))
  const height = Math.max(1, Math.round(block.position.height * k))
  return {
    ...block,
    position: {
      x: Math.max(0, Math.min(spec.width - width, Math.round(block.position.x * k))),
      y: Math.max(0, Math.min(spec.height - height, Math.round(block.position.y * k))),
      width,
      height,
    },
  }
}

/**
 * 조각이 하나도 올라오지 않은 배너 규격의 페이지.
 *
 * 원본 페이지는 **건드리지 않는다.** 블록은 복제해서 번호와 자리만 바꾼다 —
 * 배너를 뽑았다고 메인 이벤트 페이지의 배치가 흔들리면 안 된다.
 */
export function blankBannerPage(page: BriefPage, spec: BannerSpec): BriefPage {
  const id = bannerPageId(page.id, spec.id)
  return {
    // **정해진 번호**를 쓴다. 무작위 번호를 주면 작업이 기억하는 번호와 달라져,
    // 같은 배너를 두고 문서와 작업이 서로를 못 찾는다 — 실제로 그랬다. 같은
    // 규격을 다시 뽑을 때 제자리에서 바뀌는 것도 이 번호 덕이다.
    id,
    title: `${page.title} · ${String(spec.width)}×${String(spec.height)}`,
    blocks: page.blocks.map((block) => shrink({ ...block, id: bannerBlockId(id, block.id) }, page, spec)),
    canvasWidth: spec.width,
    canvasHeight: spec.height,
    reference: { viewMode: 'canvas', opacity: DEFAULT_REFERENCE_OPACITY, fit: 'width', visible: false },
  }
}
