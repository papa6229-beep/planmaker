/**
 * 블록을 복제하면 그 블록에 매달린 설정도 따라온다 (복제 설정 Patch).
 *
 * 컷아웃 설정, 연결한 제품 이미지, 생성 전 디자인 주문, 블록별 톤 — 넷 다 **기획서
 * 문서 밖**(작업판)에 블록 이름으로 매달려 있다. 원본을 지키는 올바른 경계지만,
 * 그 대가로 블록이 복제될 때 아무도 대신 옮겨 주지 않는다.
 *
 * 실제로 둘이 새고 있었다.
 *
 *  - 블록 하나를 복제하면 **합성 효과만** 따라왔다. 이미지 블록을 복제하면 사본은
 *    제품 이미지 연결이 빈 채로 생겼고, 생성은 "연결되지 않은 자리가 있습니다"로
 *    막혔다 — 방금 복제한 것이 왜 비었는지 사람은 알 길이 없다.
 *  - 페이지를 복제하면 **아무것도** 따라오지 않았다. 페이지 복제는 블록에 새 이름을
 *    주는데, 그 사실을 작업판에 알리는 길이 아예 없었다.
 *
 * 마지막 검사는 다르게 생겼다. 값 하나를 확인하는 대신 **작업에 있는 모든 칸이
 * 어느 쪽인지 분류되어 있는지**를 본다. 페이지에 매달리는 것과 블록에 매달리는 것은
 * 복제에서 할 일이 다르므로, 새 칸을 더하고 분류하지 않으면 여기서 걸린다.
 */

import { describe, it, expect } from 'vitest'
import {
  createStudioJob,
  withClonedBlock,
  withSource,
  type StudioJob,
} from '../domain/studioJob'
import { normalizeEffects } from '../domain/compositeEffects'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { STUDIO_JOB_ID } from '../services/studioStore'
import type { BriefDocument } from '../domain/pageSchema'

/** 페이지 하나에 매달리는 칸 — 복제할 때 블록 이름과 아무 상관이 없다. */
const PAGE_KEYED = ['backgrounds', 'styleRefs', 'keepReferenceBg', 'tones', 'textObjects', 'imageObjects', 'results']

/** 블록 하나에 매달리는 칸 — 블록을 복제하면 **함께 따라와야 한다**. */
const BLOCK_KEYED = ['productImages', 'effects', 'blockOrders', 'objectTones']

/** 칸이 아닌 것 — 이유가 있어 분류에서 뺀다. */
const NOT_KEYED: Record<string, string> = {
  doc: '작업본 문서 자체. 블록도 페이지도 그 안에 있다.',
  source: '이 작업이 어느 원본에서 시작했는가. 값이 아니라 파일에 대한 것이다.',
}

function docWith(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('복제 설정'))
  doc.pages[0]!.id = 'page_1'
  doc.activePageId = 'page_1'
  doc.pages[0]!.blocks = [createBlock('main_product_image', { id: 'blk_a', label: '컷아웃' })]
  return doc
}

/** `blk_a`에 매달릴 수 있는 것을 **전부** 채운 작업. */
function jobWithSettings(): StudioJob {
  const doc = docWith()
  const base = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000)
  return {
    ...base,
    productImages: { blk_a: 'asset_product' },
    effects: { blk_a: normalizeEffects({ paperCutout: true, paperWeight: 0.4, paperOpacity: 0.6 }) },
    blockOrders: { blk_a: { note: '둥근 라벨 위에 굵게', referenceAssetId: 'asset_ref' } },
    objectTones: { blk_a: { brightness: 0.3, contrast: -0.2, saturation: 0.1, temperature: 0.5 } },
  }
}

describe('블록을 복제하면 그 설정도 따라온다', () => {
  it('블록에 매달린 넷이 모두 사본에 생긴다', () => {
    const cloned = withClonedBlock(jobWithSettings(), 'blk_a', 'blk_b', 2_000)
    // 실패하면 `withClonedBlock`에 그 칸을 옮기는 줄이 빠진 것이다.
    expect(cloned.productImages.blk_b).toBe('asset_product')
    expect(cloned.effects?.blk_b?.paperCutout).toBe(true)
    expect(cloned.effects?.blk_b?.paperWeight).toBeCloseTo(0.4, 5)
    expect(cloned.blockOrders?.blk_b).toEqual({ note: '둥근 라벨 위에 굵게', referenceAssetId: 'asset_ref' })
    expect(cloned.objectTones?.blk_b?.brightness).toBeCloseTo(0.3, 5)
  })

  it('원본은 한 칸도 달라지지 않는다', () => {
    const before = jobWithSettings()
    const snapshot = JSON.stringify({
      productImages: before.productImages.blk_a,
      effects: before.effects?.blk_a,
      blockOrders: before.blockOrders?.blk_a,
      objectTones: before.objectTones?.blk_a,
    })
    const cloned = withClonedBlock(before, 'blk_a', 'blk_b', 2_000)
    expect(
      JSON.stringify({
        productImages: cloned.productImages.blk_a,
        effects: cloned.effects?.blk_a,
        blockOrders: cloned.blockOrders?.blk_a,
        objectTones: cloned.objectTones?.blk_a,
      }),
    ).toBe(snapshot)
  })

  it('사본을 고쳐도 원본이 따라 바뀌지 않는다 — 값을 나눠 갖지 않는다', () => {
    const cloned = withClonedBlock(jobWithSettings(), 'blk_a', 'blk_b', 2_000)
    cloned.effects!.blk_b!.paperWeight = 2
    cloned.blockOrders!.blk_b!.note = '바뀐 주문'
    expect(cloned.effects?.blk_a?.paperWeight).toBeCloseTo(0.4, 5)
    expect(cloned.blockOrders?.blk_a?.note).toBe('둥근 라벨 위에 굵게')
  })

  it('옮길 것이 없으면 작업을 건드리지 않는다', () => {
    const empty = withSource(createStudioJob(docWith(), 1_000, STUDIO_JOB_ID), docWith(), 1_000)
    expect(withClonedBlock(empty, 'blk_a', 'blk_b', 2_000)).toBe(empty)
  })

  it('작업의 모든 칸이 페이지별인지 블록별인지 분류되어 있다', () => {
    const job = jobWithSettings()
    // 칸처럼 생긴 것 — 이름을 열쇠로 값을 담는 자리.
    const boxes = Object.entries(job)
      .filter(([, value]) => typeof value === 'object' && value !== null && !Array.isArray(value))
      .map(([key]) => key)
    const classified = new Set([...PAGE_KEYED, ...BLOCK_KEYED, ...Object.keys(NOT_KEYED)])
    // 실패하면 새 칸이 생긴 것이다. 페이지에 매달리는지 블록에 매달리는지 정해서
    // 위 목록에 적고, 블록별이면 `withClonedBlock`이 옮기게 해야 한다.
    expect(boxes.filter((key) => !classified.has(key))).toEqual([])
  })
})
