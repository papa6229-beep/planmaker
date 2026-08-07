/**
 * 파일에 적은 것은 열 때 **전부 돌아온다** (파일 왕복 Patch).
 *
 * 저장하는 쪽(`toStudioFileState`)과 여는 쪽(`adoptFile`)이 서로 다른 자리에 있다.
 * 그래서 저장 목록에 값을 하나 더해 놓고 여는 쪽에 한 줄을 안 붙이면, 그 값은
 * **파일 안에 멀쩡히 들어 있는 채로 조용히 버려진다.** 실제로 넷이 그랬다:
 * 레퍼런스 배경 살리기, 블록별 디자인 주문, 결과 톤, 블록별 톤.
 *
 * 아예 안 담는 것보다 나쁘다. 담기지 않았으면 언젠가 눈치채지만, 담겼는데 안
 * 읽히면 저장됐다고 믿은 채로 잃는다.
 *
 * 그래서 이 검사는 두 겹이다.
 *
 *  1. **타입이 강제한다.** 아래 `RESTORED`는 `StudioFileState`의 모든 칸을
 *     빠짐없이 갖는 표다. 파일에 새 칸을 더하고 여기에 안 적으면 `tsc`가 먼저
 *     실패한다 — 검사를 돌리기도 전에.
 *  2. **값이 실제로 돌아오는지 본다.** 전부 채운 작업을 파일 모양으로 바꾸고,
 *     JSON을 한 번 왕복시킨 뒤, 진짜 `adoptFile`로 열어 하나씩 대조한다.
 *
 * 완성본은 파일에 담지 않는다 — 결과 한 장과 되돌리기 줄까지 넣으면 파일이
 * 감당할 수 없는 크기가 된다. 그 대신 **열었을 때 앞 작업의 완성본이 묻어오지
 * 않는지**를 여기서 함께 본다.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor } from '@testing-library/react'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
import { createStudioJob, withSource, type StudioJob } from '../domain/studioJob'
import { normalizeEffects } from '../domain/compositeEffects'
import { toStudioFileState, type StudioFileState } from '../domain/studioFile'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import {
  clearAllStudioJobs,
  loadStudioJob,
  resetStudioStoreForTests,
  saveStudioJob,
  STUDIO_JOB_ID,
} from '../services/studioStore'
import { clearAll, resetAssetStoreForTests } from '../services/assetStore'
import type { BriefDocument } from '../domain/pageSchema'

/**
 * 파일이 나르는 칸 → 열어 낸 작업에서 그 값을 읽는 법.
 *
 * `version`과 `source`는 값이 아니라 파일 자신에 대한 것이라 뺀다. 나머지는
 * **하나도 빠짐없이** 여기 있어야 한다 — 타입이 그것을 강제한다.
 */
type Carried = Exclude<keyof StudioFileState, 'version' | 'source'>

const RESTORED: Record<Carried, (job: StudioJob) => unknown> = {
  productImages: (job) => job.productImages,
  backgrounds: (job) => job.backgrounds,
  effects: (job) => job.effects,
  grain: (job) => job.grain,
  method: (job) => job.method,
  styleRefs: (job) => job.styleRefs,
  textObjects: (job) => job.textObjects,
  imageObjects: (job) => job.imageObjects,
  keepReferenceBg: (job) => job.keepReferenceBg,
  blockOrders: (job) => job.blockOrders,
  tones: (job) => job.tones,
  objectTones: (job) => job.objectTones,
}

function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('파일 왕복'))
  doc.pages[0]!.id = 'page_1'
  doc.activePageId = 'page_1'
  doc.pages[0]!.blocks = [
    createBlock('main_product_image', { id: 'blk_img', label: '컷아웃' }),
    createBlock('free_text', { id: 'blk_txt', label: '문구', content: '여름 감사제' }),
  ]
  return doc
}

/** 파일이 나르는 칸을 **전부** 채운 작업. 빈 칸이 있으면 왕복을 확인할 수 없다. */
function fullJob(): StudioJob {
  const doc = sampleDoc()
  const base = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '왕복.eventbrief')
  return {
    ...base,
    productImages: { blk_img: 'asset_product' },
    backgrounds: { page_1: { assetId: 'asset_bg', source: 'ai', createdAt: 2_000, requestedSize: '832x1104' } },
    effects: { blk_img: normalizeEffects({ paperCutout: true, paperWeight: 0.35, paperOpacity: 0.5 }) },
    styleRefs: { page_1: 'asset_style' },
    textObjects: {
      page_1: [{ blockId: 'blk_txt', assetId: 'asset_text', rect: { x: 1, y: 2, width: 3, height: 4 }, layer: 5, angle: 7 }],
    },
    imageObjects: {
      page_1: [{ blockId: 'blk_img', assetId: 'asset_product', rect: { x: 8, y: 9, width: 10, height: 11 }, layer: 0 }],
    },
    keepReferenceBg: { page_1: true },
    blockOrders: { blk_txt: { note: '둥근 라벨 위에 굵게', referenceAssetId: 'asset_ref' } },
    tones: { page_1: { brightness: 0.4, contrast: -0.2, saturation: 0.1, temperature: -0.3 } },
    objectTones: { blk_txt: { brightness: -0.5, contrast: 0.25, saturation: 0, temperature: 0.6 } },
    grain: 0.2,
    method: 'background_composite',
    // 완성본은 파일에 담기지 않는다. 열었을 때 이것이 묻어오면 안 된다.
    results: {
      page_1: {
        pageId: 'page_1',
        assetId: 'asset_result',
        model: 'gpt-image-2',
        quality: 'medium',
        requestedSize: '832x1104',
        sourceFingerprint: 'fp',
        createdAt: 3_000,
        targets: [],
      },
    },
  }
}

/** provider를 세우고 그 안의 진짜 `adoptFile`을 쓴다 — 흉내가 아니라 그 함수다. */
function Harness({ onReady }: { onReady: (api: ReturnType<typeof useStudioJob>) => void }) {
  const studio = useStudioJob()
  if (studio !== null) onReady(studio)
  return null
}

async function adopt(state: StudioFileState | null): Promise<StudioJob | null> {
  let api: ReturnType<typeof useStudioJob> = null
  render(
    <StudioJobProvider>
      <Harness onReady={(value) => { api = value }} />
    </StudioJobProvider>,
  )
  await waitFor(() => expect(api).not.toBeNull(), { timeout: 5000 })
  await api!.adoptFile(sampleDoc(), state)
  return await loadStudioJob(STUDIO_JOB_ID)
}

beforeEach(async () => {
  resetAssetStoreForTests()
  resetStudioStoreForTests()
  await clearAll()
  await clearAllStudioJobs()
})

describe('파일에 적은 것은 열 때 전부 돌아온다', () => {
  it('칸마다 저장한 값이 그대로 복원된다', async () => {
    const state = toStudioFileState(fullJob())
    // 실제 파일을 지나는 길과 같게 — JSON 한 번 왕복.
    const onDisk = JSON.parse(JSON.stringify(state)) as StudioFileState
    const opened = await adopt(onDisk)
    expect(opened).not.toBeNull()

    const lost: string[] = []
    for (const key of Object.keys(RESTORED) as Carried[]) {
      const saved = onDisk[key]
      const restored = RESTORED[key](opened!)
      // 실패하면 `adoptFile`에 그 칸을 적용하는 줄이 빠진 것이다.
      if (JSON.stringify(restored) !== JSON.stringify(saved)) {
        lost.push(`${key}: 저장 ${JSON.stringify(saved)} → 복원 ${JSON.stringify(restored)}`)
      }
    }
    expect(lost).toEqual([])
  })

  it('저장 목록과 복원 표가 같은 칸을 본다', async () => {
    const state = toStudioFileState(fullJob())
    // 파일이 실제로 적은 칸 중 표에 없는 것이 있으면, 그 값은 열 때 버려진다.
    const written = Object.keys(state).filter((k) => k !== 'version' && k !== 'source')
    expect(written.toSorted()).toEqual(Object.keys(RESTORED).toSorted())
  })

  it('완성본은 파일에 담기지 않고, 앞 작업의 완성본이 묻어오지도 않는다', async () => {
    const job = fullJob()
    const state = toStudioFileState(job)
    // 담지 않는 것이 정해진 방침이다 — 결과 한 장과 되돌리기 줄은 파일이 감당할
    // 크기가 아니다. 완성본은 `이미지 저장`으로 따로 뽑는다.
    expect('results' in state).toBe(false)

    // 앞 작업을 열어 둔 채로 다른 파일을 연다.
    await saveStudioJob(job)
    const opened = await adopt(JSON.parse(JSON.stringify(state)) as StudioFileState)
    expect(opened?.results ?? {}).toEqual({})
  })

  it('예전 판 파일은 빈 값으로 열린다 — 없는 칸을 지어내지 않는다', async () => {
    const opened = await adopt({ version: '0.1.0', source: null, productImages: { blk_img: 'asset_product' } })
    expect(opened?.productImages).toEqual({ blk_img: 'asset_product' })
    expect(opened?.tones ?? {}).toEqual({})
    expect(opened?.blockOrders ?? {}).toEqual({})
    expect(opened?.keepReferenceBg ?? {}).toEqual({})
    expect(opened?.objectTones ?? {}).toEqual({})
  })
})
