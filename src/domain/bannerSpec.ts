/**
 * 규격마다의 틀 (배너 Patch §2).
 *
 * 블록을 놓고 "알아서 예쁘게 배치"하는 것은 만들지 않는다. 그렇게 만든 배치는
 * 늘 조금씩 어색하고, 어색한 이유를 고칠 손잡이도 없다.
 *
 * 다행히 그럴 필요가 없다. **규격이 다섯 개로 고정**이고, 세 이벤트의 배너
 * 열다섯 장을 보면 규격마다 자리가 거의 같다. 얇은 띠는 세 이벤트 전부 같은
 * 문법이었다 — 왼쪽에 혜택과 그림, 가운데 제목, 오른쪽에 행동.
 *
 * 그러니 자유 배치 문제가 아니라 **틀에 꽂는 문제**다. 자리는 사람이 만든 것을
 * 베끼고, 자동이 정하는 것은 "무엇을 어느 자리에, 안 들어가면 무엇부터 양보시킬지"
 * 뿐이다. 안정감은 틀이 보장한다.
 *
 * 자리는 **0~1 비율**로 적는다. 형제 규격(1020×70과 840×78처럼 같은 디자인을
 * 크기만 바꿔 다시 저장하는 것)이 같은 틀을 그대로 쓰기 위해서다.
 *
 * 지금은 1020×70 하나뿐이다. 가장 어려운 규격이라 먼저 한다 — 배경 강등도,
 * 눕히기도, 끝단 색도 전부 여기 몰려 있다. 이것이 실물로 나오는 것을 보고 나머지
 * 넷을 채운다. 다섯을 한꺼번에 눈대중으로 적어 두면, 틀린 곳이 어디인지 실물을
 * 보기 전에는 알 수가 없다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import type { EdgeSide } from './edgeColor'
import type { BannerPurpose } from './bannerRules'

/** 배너 안의 자리. **0~1 비율**이다. */
export interface SlotArea {
  x: number
  y: number
  width: number
  height: number
}

export interface BannerSlot {
  id: string
  area: SlotArea
  /** 이 자리가 받는 일. 블록은 **가장 앞의 받아 주는 자리**로 간다. */
  accepts: readonly BannerPurpose[]
  /** 몇 개까지 받는가. */
  capacity: number
  /** 여럿이 들어오면 옆으로 나열할지 아래로 쌓을지. */
  flow: 'row' | 'column'
}

export interface BannerSpec {
  id: string
  label: string
  width: number
  height: number
  /**
   * 같은 디자인을 크기만 바꿔 다시 저장하는 형제들.
   *
   * 따로 배치하지 않는다 — 사람도 하나 만들고 크기만 바꿔 저장하거나 아주 살짝
   * 고쳐 쓴다고 했다. 형제를 독립적으로 배치하면 그 "살짝 고치는" 여지가 사라진다.
   */
  siblings: readonly { width: number; height: number }[]
  slots: readonly BannerSlot[]
  /**
   * 만든 뒤 끝 색을 함께 적어 내야 하는 쪽.
   *
   * 얇은 띠 배너는 좌우로 페이지가 이어지므로 배경색을 띠의 끝 색에 맞춰야 한다.
   * **양쪽을 다 적어 낸다** — 어느 쪽을 쓰는지 아직 확인하지 못했고, 둘 다 주면
   * 쓰는 사람이 고르면 된다. 하나만 주고 그것이 틀린 쪽이면 다시 스포이드를 든다.
   */
  edgeReport: readonly EdgeSide[]
}

/**
 * 1020×70 — 얇은 가로 띠.
 *
 * 자리는 이벤트2와 이벤트3의 1020×70 두 장을 겹쳐 읽은 것이다.
 *
 *  - 이벤트2: 상품 사진 | `GIFT EVENT` + 제목 | 젤·스피너 | 카피
 *  - 이벤트3: 배지 + 가격 | `SPECIAL EVENT` + 제목 | R19 | CTA
 *
 * 둘 다 왼쪽이 그림·혜택, 가운데가 제목, 오른쪽이 행동이다. 로고를 받는 자리는
 * 없다 — 두 장 다 로고가 없었다.
 */
export const BANNER_1020x70: BannerSpec = {
  id: '1020x70',
  label: '얇은 가로 띠',
  width: 1020,
  height: 70,
  siblings: [{ width: 840, height: 78 }],
  edgeReport: ['left', 'right'],
  slots: [
    {
      id: 'lead',
      area: { x: 0.012, y: 0.1, width: 0.2, height: 0.8 },
      accepts: ['imagery', 'benefit'],
      capacity: 2,
      flow: 'row',
    },
    {
      id: 'head',
      area: { x: 0.23, y: 0.1, width: 0.33, height: 0.8 },
      accepts: ['title', 'detail'],
      capacity: 2,
      flow: 'column',
    },
    {
      /**
       * 남는 자리.
       *
       * 이 크기의 배너는 제목과 제품을 넣고 나면 자리가 별로 없다. 그러고 남는
       * 곳에 필요하다 싶은 것을 우겨넣는다 — 로고, 기간, 추가 이미지. 그래서 이
       * 자리만 `chrome`과 `detail`까지 받는다.
       *
       * 로고가 여기 오는 것이 요점이다. "협업 이벤트면 로고를 넣는다"가 아니라,
       * 앞의 것들이 다 들어가고도 자리가 남아야 들어간다. 아니면 포기한다.
       */
      id: 'body',
      area: { x: 0.575, y: 0.12, width: 0.21, height: 0.76 },
      accepts: ['benefit', 'imagery', 'chrome', 'detail'],
      capacity: 2,
      flow: 'row',
    },
    {
      id: 'act',
      area: { x: 0.8, y: 0.15, width: 0.188, height: 0.7 },
      accepts: ['action', 'detail'],
      capacity: 2,
      flow: 'row',
    },
  ],
}

export const BANNER_SPECS: readonly BannerSpec[] = [BANNER_1020x70]

/** 임의 크기 규격의 번호는 크기 그 자체다 — `640x200`. */
export const CUSTOM_SPEC_PREFIX = 'custom'

/**
 * 작업자가 적어 넣은 크기 (배너 Patch §6).
 *
 * 정해진 규격에는 사람이 만든 틀이 있다 — 왼쪽 혜택, 가운데 제목, 오른쪽 행동.
 * 임의 크기에는 그런 것이 없고, 없는 문법을 지어내면 어색한 배치가 나온다.
 *
 * 그래서 **자리를 하나도 두지 않는다.** 배경만 그 크기로 깔리고 나머지는 비어 있다.
 * 조각은 서랍에서 꺼내 놓는다 — 백지에서 시작하는 것이 지어낸 배치보다 낫다.
 */
export function customBannerSpec(width: number, height: number): BannerSpec | null {
  const w = Math.round(width)
  const h = Math.round(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 8000 || h > 8000) return null
  return {
    id: `${CUSTOM_SPEC_PREFIX}_${String(w)}x${String(h)}`,
    label: '직접 지정',
    width: w,
    height: h,
    siblings: [],
    edgeReport: ['left', 'right'],
    slots: [],
  }
}

/** 임의 크기 번호에서 크기를 되찾는다. */
export function sizeOfCustomSpecId(id: string): { width: number; height: number } | null {
  const match = /^custom_(\d+)x(\d+)$/.exec(id)
  return match === null ? null : { width: Number(match[1]), height: Number(match[2]) }
}

export function bannerSpecById(id: string): BannerSpec | null {
  const known = BANNER_SPECS.find((spec) => spec.id === id)
  if (known !== undefined) return known
  const size = sizeOfCustomSpecId(id)
  return size === null ? null : customBannerSpec(size.width, size.height)
}
