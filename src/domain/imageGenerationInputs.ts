/**
 * 모델에게 보낼 입력 이미지의 순서와 역할 (1단계 §6).
 *
 * 프롬프트는 "입력 이미지 2는 blk_image 자리에 들어갈 실제 제품"이라고 말한다.
 * 그 말이 참이려면 순서가 매번 같아야 한다. 그래서 순서는 화면의 우연이나
 * 객체 열거 순서가 아니라 여기 한 곳에서 정해진다.
 *
 *   1. 기획서 배치도 (이 페이지의 깨끗한 미리보기)
 *   2..  이미지 자리마다 연결된 실제 사용 제품 이미지 — 자리 순서대로
 *   ..   작성자가 자리에 붙인 참고 캡처 — 같은 자리 순서대로
 *   마지막. 페이지 전체 참고 이미지
 *
 * 같은 그림이 두 역할로 걸리면 한 번만 보낸다. 먼저 걸린 역할이 이긴다 —
 * 제품으로 쓰라고 연결한 그림을 참고 자료라고 다시 말하면 지시가 흐려진다.
 *
 * 순수 함수다.
 */

import type { GenerationRequest } from './generationRequest'

/** 공식 명세의 한 번에 보낼 수 있는 이미지 수. */
export const MAX_INPUT_IMAGES = 16

export type GenerationInputRole = 'page_layout' | 'product_image' | 'slot_reference' | 'page_reference'

export interface GenerationInputImage {
  /** 1부터 — 프롬프트에 "입력 이미지 n"으로 그대로 쓰인다. */
  index: number
  role: GenerationInputRole
  /** 배치도는 그 자리에서 만들므로 자산 번호가 없다. */
  assetId?: string
  /** 이 이미지가 어느 자리의 것인지. 페이지 전체 자료에는 없다. */
  blockId?: string
  fileName?: string
  /** 사람과 모델이 함께 읽는 한 줄. */
  label: string
}

const ROLE_LABEL: Record<GenerationInputRole, string> = {
  page_layout: '기획서 배치도 — 최종 디자인이 아니라 자리와 요구사항을 나타내는 그림입니다.',
  product_image: '실제 사용 제품 이미지',
  slot_reference: '작성자가 붙인 참고 캡처 — 분위기·구성 참고용이며 그대로 넣는 자산이 아닙니다.',
  page_reference: '페이지 전체 참고 이미지 — 분위기·구성 참고용이며 그대로 넣는 자산이 아닙니다.',
}

/** 이 요청이 보낼 입력 이미지 목록 — 언제나 같은 순서로. */
export function planGenerationInputs(request: GenerationRequest): GenerationInputImage[] {
  const inputs: GenerationInputImage[] = []
  const seen = new Set<string>()

  const push = (role: GenerationInputRole, assetId?: string, blockId?: string, fileName?: string) => {
    if (assetId !== undefined) {
      if (seen.has(assetId)) return
      seen.add(assetId)
    }
    const suffix = blockId === undefined ? '' : ` (${blockId} 자리)`
    inputs.push({
      index: inputs.length + 1,
      role,
      ...(assetId === undefined ? {} : { assetId }),
      ...(blockId === undefined ? {} : { blockId }),
      ...(fileName === undefined ? {} : { fileName }),
      label: `${ROLE_LABEL[role]}${suffix}`,
    })
  }

  push('page_layout')
  for (const slot of request.design.imageSlots) {
    if (slot.productImage) push('product_image', slot.productImage.assetId, slot.blockId, slot.productImage.fileName)
  }
  for (const slot of request.design.imageSlots) {
    if (slot.referenceAsset) push('slot_reference', slot.referenceAsset.assetId, slot.blockId, slot.referenceAsset.fileName)
  }
  const pageRef = request.design.reference
  if (pageRef.assetId !== undefined) push('page_reference', pageRef.assetId, undefined, pageRef.fileName)

  return inputs
}
