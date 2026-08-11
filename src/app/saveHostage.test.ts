/**
 * 그림 하나가 없다고 하루치 작업을 인질로 잡지 않는다 (저장 인질 Patch).
 *
 * 실제로 그 자리에서 걸렸다. 작업자의 팀원 화면에 이렇게 떴다:
 *
 *   내보내기 실패 — 연결된 제품 이미지의 원본을 찾을 수 없어 저장할 수 없습니다:
 *   asset_44c791e8-…
 *
 * 이 한 줄이 두 가지를 동시에 잘못하고 있었다.
 *
 *  1. **저장을 통째로 거부한다.** 사라진 그림 하나 때문에 나머지 전부를 못 남긴다.
 *  2. **엉뚱한 곳을 가리킨다.** 검사하는 것은 일곱 갈래인데 (제품 이미지 · 배경 ·
 *     스타일 레퍼런스 · 문구 조각 · 이미지 조각 · 블록 참고 그림 · 깜빡임 GIF),
 *     화면은 무조건 "제품 이미지"라고 말한다. 사라진 것이 배경이어도 사람은 제품
 *     이미지를 뒤진다.
 *
 * 이제 **끊어진 연결만 빼고 저장하고, 무엇을 뺐는지 말한다.** 빼고 저장하는 것은
 * 손상이 아니다 — 그 자리에 그림이 없다는 것은 지금 화면의 사실이고, 파일은 그
 * 사실을 그대로 적을 뿐이다. 조용히 빼는 것이 진짜 손상이다.
 */

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { packageEventDocument } from '../services/eventBriefExport'
import { dropMissingAssets, STUDIO_REF_LABEL, type StudioFileState } from '../domain/studioFile'
import { createEmptyDocument } from '../domain/pageSchema'
import { createEmptyProject } from '../domain/factory'
import type { StoredAsset } from '../services/assetStore'

const KEPT = 'asset_kept'
const GONE = 'asset_44c791e8-ad40-4c75-abd2-abb8661f3684'

function stored(id: string): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    width: 10,
    height: 10,
    byteSize: 4,
  }
}

function fileState(): StudioFileState {
  return {
    version: '0.14.0',
    source: null,
    productImages: { blk_photo: KEPT, blk_lost: GONE },
    backgrounds: { page_1: { assetId: KEPT, source: 'ai' } },
    styleRefs: { page_1: GONE },
    textObjects: {
      page_1: [
        { blockId: 'blk_t1', assetId: KEPT, rect: { x: 0, y: 0, width: 10, height: 10 }, layer: 0 },
        { blockId: 'blk_t2', assetId: GONE, rect: { x: 0, y: 0, width: 10, height: 10 }, layer: 1 },
      ],
    },
    imageObjects: {
      page_1: [{ blockId: 'blk_photo', assetId: GONE, rect: { x: 0, y: 0, width: 10, height: 10 }, layer: 0 }],
    },
    blockOrders: { blk_t1: { note: '둥근 라벨 위에 굵게', referenceAssetId: GONE } },
    blink: { page_1: { strength: 0.25, assetId: GONE } },
  }
}

describe('§H1 끊어진 연결만 빼낸다', () => {
  const has = (id: string) => id === KEPT

  it('사라진 것은 자리와 갈래까지 함께 알려 준다', () => {
    const { dropped } = dropMissingAssets(fileState(), has)
    // 일곱 갈래 중 여섯이 걸렸다. 배경은 살아 있으므로 이 목록에 없다.
    expect(dropped.map((d) => `${d.kind}:${d.at}`).toSorted()).toEqual([
      'blink:page_1',
      'blockReference:blk_t1',
      'imageObject:blk_photo',
      'productImage:blk_lost',
      'styleRef:page_1',
      'textObject:blk_t2',
    ])
    // 사라진 것은 전부 그 하나의 번호다.
    expect(dropped.every((d) => d.assetId === GONE)).toBe(true)
    // 갈래마다 사람이 읽는 이름이 있다 — 화면이 "제품 이미지"로 뭉뚱그리지 않게.
    for (const ref of dropped) expect(STUDIO_REF_LABEL[ref.kind].length).toBeGreaterThan(0)
  })

  it('살아 있는 것은 하나도 건드리지 않는다', () => {
    const { state } = dropMissingAssets(fileState(), has)
    expect(state.productImages).toEqual({ blk_photo: KEPT })
    expect(state.backgrounds?.page_1?.assetId).toBe(KEPT)
    expect(state.textObjects?.page_1?.map((o) => o.blockId)).toEqual(['blk_t1'])
    expect(state.imageObjects?.page_1).toEqual([])
    expect(state.styleRefs).toEqual({})
  })

  /**
   * 사라진 것은 참고 그림 한 장이지 적어 둔 말이 아니다. 켜 둔 깜빡임도 사람의
   * 뜻이고, 그림은 화면이 다시 만들 수 있다.
   */
  it('주문 글과 깜빡임 설정은 남고 그림만 빠진다', () => {
    const { state } = dropMissingAssets(fileState(), has)
    expect(state.blockOrders?.blk_t1?.note).toBe('둥근 라벨 위에 굵게')
    expect(state.blockOrders?.blk_t1?.referenceAssetId).toBeUndefined()
    expect('referenceAssetId' in (state.blockOrders?.blk_t1 ?? {})).toBe(false)
    expect(state.blink?.page_1).toEqual({ strength: 0.25 })
  })

  it('뺄 것이 없으면 받은 것을 그대로 돌려준다', () => {
    const state = fileState()
    const answer = dropMissingAssets(state, () => true)
    expect(answer.dropped).toEqual([])
    expect(answer.state).toBe(state)
  })
})

describe('§H2 저장은 성공하고, 무엇이 빠졌는지 말한다', () => {
  async function save() {
    const doc = createEmptyDocument(createEmptyProject('인질 시험'))
    doc.pages[0]!.id = 'page_1'
    return await packageEventDocument({
      doc,
      assets: [stored(KEPT)],
      previews: [],
      createdAt: '2026-08-11T00:00:00Z',
      studio: fileState(),
    })
  }

  it('그림 하나가 없어도 파일이 나온다', async () => {
    const pkg = await save()
    expect(pkg.blob.size).toBeGreaterThan(0)
    expect(pkg.dropped?.length).toBe(6)
  })

  it('저장된 작업 상태에는 끊어진 연결이 없다', async () => {
    const pkg = await save()
    const zip = await JSZip.loadAsync(pkg.blob)
    const text = await zip.file('studio.json')!.async('string')
    // 사라진 번호가 파일 어디에도 남지 않는다 — 남으면 다시 열 때 또 걸린다.
    expect(text).not.toContain(GONE)
    const state = JSON.parse(text) as StudioFileState
    expect(state.productImages).toEqual({ blk_photo: KEPT })
    // 살아 있는 그림의 실물은 그대로 담긴다.
    expect(zip.file(/products\//).length + zip.file(/assets\//).length).toBeGreaterThan(0)
  })
})
