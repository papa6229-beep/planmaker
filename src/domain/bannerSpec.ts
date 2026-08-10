/**
 * 배너 규격 — 크기, 그리고 크기뿐 (배너 Patch §2, 자동 배치 제거 Patch).
 *
 * ## 여기 있던 틀을 걷어냈다
 *
 * 앞선 판에는 규격마다 **자리**가 있었다. 1020×70이면 왼쪽에 그림·혜택, 가운데
 * 제목, 오른쪽 행동. 사람이 만든 배너 열다섯 장에서 읽어 낸 문법이었고, 실제로
 * 그 문법대로 조각이 꽂혔다.
 *
 * 그런데 실물을 보고 작업자가 말한 것은 이랬다 — **"이벤트 페이지는 자동 배치를
 * 해 주지, 왜냐 크니까. 하지만 배너는 작은 것들이 많아."** 840×1180 지면에서는
 * 자동이 놓은 자리가 조금 어긋나도 손으로 밀면 되지만, 70px 높이에서는 어긋난
 * 자리를 고치는 것이 처음부터 놓는 것보다 오래 걸린다. 틀이 도움이 아니라 일이
 * 된다.
 *
 * 그래서 자리를 없앴다. 배너를 뽑으면 **배경만** 깔리고 조각은 하나도 올라오지
 * 않는다. 필요한 것을 서랍에서 꺼내 놓는다 — 이벤트 페이지 작업창과 똑같고,
 * 다른 것은 캔버스 크기뿐이다. 이벤트 페이지 쪽 자동 배치는 그대로 남는다.
 *
 * 규격에 남은 것은 크기, 형제 크기, 끝단 색을 어느 쪽에서 읽을지. 셋 다 사람이
 * 알려 준 사실이고 자동이 지어낸 것이 아니다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import type { EdgeSide } from './edgeColor'

export interface BannerSpec {
  id: string
  label: string
  width: number
  height: number
  /**
   * 같은 디자인을 크기만 바꿔 다시 저장하는 형제들.
   *
   * 따로 뽑지 않는다 — 사람도 하나 만들고 크기만 바꿔 저장하거나 아주 살짝 고쳐
   * 쓴다고 했다. 형제를 독립적으로 뽑으면 그 "살짝 고치는" 여지가 사라진다.
   */
  siblings: readonly { width: number; height: number }[]
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
 * 작업자가 늘 쓰는 다섯 크기 (그리고 형제들).
 *
 * 번호와 형제 관계는 작업자가 직접 적어 준 그대로다. 괄호 안의 크기는 "보통 하나
 * 작업하고 사이즈만 바꿔서 저장한 후 그냥 쓰던가, 아주 살짝만 수정해서 쓰는 것"
 * 이라고 했다.
 *
 * 1020×70만 `edgeReport`가 좌우인 것이 아니라 전부 좌우다 — 얇은 띠가 아니어도
 * 끝 색을 물어볼 일이 있고, 안 쓰면 그냥 안 보면 된다.
 */
export const BANNER_SPECS: readonly BannerSpec[] = [
  { id: '178x90', label: '작은 사각', width: 178, height: 90, siblings: [{ width: 250, height: 135 }], edgeReport: ['left', 'right'] },
  { id: '840x640', label: '큰 사각', width: 840, height: 640, siblings: [{ width: 500, height: 387 }], edgeReport: ['left', 'right'] },
  { id: '1020x70', label: '얇은 가로 띠', width: 1020, height: 70, siblings: [{ width: 840, height: 78 }], edgeReport: ['left', 'right'] },
  { id: '800x250', label: '가로 배너', width: 800, height: 250, siblings: [{ width: 700, height: 153 }], edgeReport: ['left', 'right'] },
  { id: '602x70', label: '좁은 띠', width: 602, height: 70, siblings: [], edgeReport: ['left', 'right'] },
]

/** 임의 크기 규격의 번호는 크기 그 자체다 — `640x200`. */
export const CUSTOM_SPEC_PREFIX = 'custom'

/** 작업자가 그때그때 적어 넣은 크기. 프리셋에 없는 한 번짜리를 위해 남긴다. */
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
