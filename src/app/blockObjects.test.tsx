/**
 * 편집 오브젝트를 기획서 블록과 잇는다 (블록 연결 Patch §최소 검증).
 *
 * fixture는 서로 가깝거나 일부 겹치는 문구 셋, 일반 이미지 하나, 종이 컷아웃
 * 하나다. 실물 이미지는 넣지 않는다 — 픽셀이 필요한 자리는 손으로 심는다.
 *
 * 여기서 묻는 것은 하나다. **오브젝트의 이름이 `blockId`인가.** 픽셀 덩어리나
 * 글자 간격이 이름이 되면 가까운 둘이 하나로 붙고 하나가 둘로 갈라진다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'
import { clearAll, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import {
  clearAllStudioJobs,
  loadStudioJob,
  resetStudioStoreForTests,
  saveStudioJob,
  STUDIO_JOB_ID,
} from '../services/studioStore'
import { createStudioJob, withSource } from '../domain/studioJob'
import { normalizeEffects } from '../domain/compositeEffects'
import type { BriefDocument } from '../domain/pageSchema'
import type { LayoutRect } from '../domain/imageLayout'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>(
    '../features/assets/imageUtils',
  )
  return { ...actual, readImageSize: async () => ({ width: 800, height: 800 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([9])], { type: 'image/png' }),
}))
vi.mock('../services/photoContent', () => ({
  PHOTO_MEASURE_MAX_SIDE: 256,
  measurePhoto: async () => ({ natural: { width: 800, height: 800 }, box: { x: 0, y: 0, width: 1, height: 1 } }),
}))
vi.mock('../services/paperCutoutShape', () => ({
  buildPaperShape: async () => null,
  buildPaperCanvas: async () => null,
}))
vi.mock('../services/imageAnalysisRunner', () => ({
  ANALYSIS_MAX_SIDE: 256,
  analyzeImageBlob: async () => null,
}))
vi.mock('../services/textLayerKey', () => ({
  removeKeyBackground: async (blob: Blob) => ({ blob, opaqueRatio: 0.2 }),
}))
// 자르는 규칙 자체는 아래 §1 순수 검사에서 픽셀로 잰다. 여기서는 "블록마다
// 하나"라는 약속만 그대로 흘려보낸다.
vi.mock('../services/textLayerSplit', () => ({
  sliceTextLayer: async (_blob: Blob, blocks: { blockId: string; rect: unknown; layer: number }[]) =>
    blocks.map((b) => ({
      blockId: b.blockId,
      layer: b.layer,
      rect: b.rect as LayoutRect,
      blob: new Blob([new Uint8Array([7, 7])], { type: 'image/png' }),
    })),
}))
const composed = vi.fn()
vi.mock('../services/compositeRenderer', () => ({
  renderComposite: async (plan: unknown) => {
    composed(plan)
    return new Blob([new Uint8Array([5, 5, 5])], { type: 'image/png' })
  },
}))
vi.mock('../services/workingImage', async () => {
  const actual = await vi.importActual<typeof import('../services/workingImage')>('../services/workingImage')
  return {
    ...actual,
    toWorkingImage: async (blob: Blob, target: { width: number; height: number }) => ({
      blob,
      width: target.width,
      height: target.height,
      reencoded: false,
    }),
  }
})

// 칸대로 자르는 일은 캔버스의 몫이다. 자르는 좌표의 규칙은 순수 검사에서 숫자로
// 재고, 여기서는 흐름만 본다.
vi.mock('../services/stickerSheetSlice', () => ({
  sliceStickerSheet: async (_blob: Blob, cells: { blockId: string; index: number }[]) => ({
    pieces: cells.map((c) => ({
      blockId: c.blockId,
      index: c.index,
      blob: new Blob([new Uint8Array([7, 7])], { type: 'image/png' }),
    })),
    inks: cells.map((c) => ({ index: c.index, blockId: c.blockId, guardRatio: 0 })),
  }),
}))
vi.mock('../services/regionTone', () => ({
  REGION_MAX_SIDE: 512,
  analyzeRegions: async (_blob: Blob, rects: unknown[]) => rects.map(() => null),
}))

const fetchSpy = vi.fn()
globalThis.fetch = fetchSpy as unknown as typeof fetch

const PARENT = '../'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): Promise<any> => import(/* @vite-ignore */ `${PARENT}${name}`)

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

const PHOTO_RECT: LayoutRect = { x: 40, y: 620, width: 320, height: 320 }
const CUT_RECT: LayoutRect = { x: 420, y: 700, width: 360, height: 360 }

/** 일반 이미지 1 · 컷아웃 1 · 서로 가깝거나 겹치는 문구 3. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('블록 연결 시험'))
  doc.pages[0]!.id = 'page_1'
  doc.activePageId = 'page_1'
  doc.pages[0]!.blocks = [
    createBlock('main_product_image', { id: 'blk_photo', label: '일반 이미지', position: { ...PHOTO_RECT } }),
    createBlock('main_product_image', { id: 'blk_cut', label: '컷아웃', position: { ...CUT_RECT } }),
    createBlock('free_text', {
      id: 'blk_t1',
      label: '큰 문구',
      content: '여름 감사제 40%',
      position: { x: 80, y: 100, width: 400, height: 120 },
    }),
    createBlock('free_text', {
      id: 'blk_t2',
      // 위 문구의 아래 끝과 맞닿는다.
      label: '가까운 문구',
      content: '전 품목 균일가',
      position: { x: 80, y: 220, width: 400, height: 90 },
    }),
    createBlock('free_text', {
      id: 'blk_t3',
      // 앞 두 문구와 가로로 겹친다.
      label: '겹치는 문구',
      content: '선착순 300명',
      position: { x: 300, y: 170, width: 300, height: 110 },
    }),
  ]
  doc.pages[0]!.canvasHeight = 1200
  return doc
}

const TEXT_IDS = ['blk_t1', 'blk_t2', 'blk_t3']
const IMAGE_IDS = ['blk_photo', 'blk_cut']

async function seedJob() {
  const doc = sampleDoc()
  const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '연결.eventbrief')
  await saveStudioJob({
    ...job,
    productImages: { blk_photo: 'asset_photo', blk_cut: 'asset_cut' },
    // 컷아웃은 하나뿐이다 — 나머지 하나는 일반 이미지로 남는다.
    effects: { blk_cut: normalizeEffects({ paperCutout: true }) },
  })
}

function StudioHarness() {
  const studio = useStudioJob()
  if (studio === null) return null
  return <AppShell mode="studio" binding={studio.binding} />
}

function renderStudio() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <StudioJobProvider>
        <StudioHarness />
      </StudioJobProvider>
    </MemoryRouter>,
  )
}

async function documentReady(container: HTMLElement) {
  await waitFor(() => expect(container.querySelectorAll('.canvas__sheet .block-card').length).toBe(5), {
    timeout: 5000,
  })
}

async function generateOnce() {
  sessionStorage.setItem('planmaker.openai-key', 'sk-stub')
  fetchSpy.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          image: { b64: btoa('layer'), mimeType: 'image/png' },
          metadata: { requestedSize: '832x1184' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  )
  fireEvent.click(await screen.findByRole('button', { name: /이미지 생성하기|다시 생성/ }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(
    // eslint-disable-next-line testing-library/no-node-access
    Array.from(dialog.querySelectorAll('button')).find((b) => /생성 시작|저장하고 계속/.test(b.textContent ?? ''))!,
  )
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2), { timeout: 8000 })
  await waitFor(async () => {
    const job = await loadStudioJob(STUDIO_JOB_ID)
    expect((job?.imageObjects?.page_1 ?? []).length).toBe(2)
    expect((job?.textObjects?.page_1 ?? []).length).toBe(3)
  }, { timeout: 8000 })
}

/** 화면에 걸린 편집 상자들 — 이미지가 앞, 문구가 뒤(= 위)다. */
async function objectBoxes(container: HTMLElement) {
  return await waitFor(() => {
    const found = container.querySelectorAll<HTMLElement>('.result-object')
    expect(found.length).toBe(5)
    return found
  }, { timeout: 5000 })
}

const labelOf = (el: HTMLElement) => el.getAttribute('aria-label') ?? ''

/** 지금 저장된 작업 — provider가 내주는 최신 값. */
const jobRefOf = (api: NonNullable<ReturnType<typeof useStudioJob>>) => api.currentJob()

beforeEach(async () => {
  fetchSpy.mockReset()
  composed.mockReset()
  resetAssetStoreForTests()
  resetDocumentStoreForTests()
  resetRequestStoreForTests()
  resetStudioStoreForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
  await clearAllStudioJobs()
  sessionStorage.clear()
  await putAsset(storedAsset('asset_photo', 1))
  await putAsset(storedAsset('asset_cut', 2))
})

// ── §1 문구의 임자는 상자이지 덩어리가 아니다 ────────────────────────────────

describe('§1 가까운 문구가 합쳐지지도 쪼개지지도 않는다', () => {
  it('이어진 획은 상자 경계에서 갈리고, 떨어진 낱글자는 한 블록으로 모인다', async () => {
    const { splitTextLayer } = await load('domain/textObjects')

    const width = 60
    const height = 30
    const data = new Uint8ClampedArray(width * height * 4)
    const put = (x: number, y: number) => {
      data[(y * width + x) * 4 + 3] = 255
    }

    // A: 서로 **떨어진** 낱글자 두 덩어리. 덩어리를 세는 규칙이면 여기서 쪼개진다.
    for (let y = 3; y <= 8; y += 1) for (let x = 2; x <= 5; x += 1) put(x, y)
    for (let y = 3; y <= 8; y += 1) for (let x = 10; x <= 15; x += 1) put(x, y)
    // A와 B를 **잇는** 획 한 줄. 덩어리를 세는 규칙이면 여기서 둘이 합쳐진다.
    for (let x = 16; x <= 21; x += 1) put(x, 6)
    // B
    for (let y = 3; y <= 8; y += 1) for (let x = 21; x <= 37; x += 1) put(x, y)
    // C
    for (let y = 3; y <= 8; y += 1) for (let x = 42; x <= 55; x += 1) put(x, y)
    // 배경 장식(별) — 어느 상자에서도 멀다.
    put(30, 25)
    put(31, 26)

    const { owner, slices } = splitTextLayer(
      { data, width, height },
      [
        { blockId: 'a', rect: { x: 0, y: 0, width: 18, height: 12 }, layer: 0 },
        { blockId: 'b', rect: { x: 20, y: 0, width: 18, height: 12 }, layer: 1 },
        { blockId: 'c', rect: { x: 40, y: 0, width: 18, height: 12 }, layer: 2 },
      ],
      { x: 1, y: 1 },
    )

    // 블록 셋 → 조각 셋. 이름도 블록 이름 그대로다.
    expect(slices.map((s: { blockId: string }) => s.blockId)).toEqual(['a', 'b', 'c'])

    const box = (id: string) =>
      (slices.find((s: { blockId: string }) => s.blockId === id) as { box: LayoutRect }).box
    // 떨어진 두 낱글자가 한 조각 안에 함께 든다 (쪼개짐 없음).
    expect(box('a')).toEqual({ x: 2, y: 3, width: 18, height: 6 })
    // 이어진 획인데도 상자 경계에서 갈린다 (합쳐짐 없음).
    expect(box('b')).toEqual({ x: 20, y: 3, width: 18, height: 6 })
    expect(box('c')).toEqual({ x: 42, y: 3, width: 14, height: 6 })

    expect(owner[5 * width + 4]).toBe(0)
    expect(owner[5 * width + 30]).toBe(1)
    expect(owner[5 * width + 50]).toBe(2)
    // 별은 누구의 것도 아니고, 어느 조각의 상자 안에도 들지 않는다.
    expect(owner[25 * width + 30]).toBe(-1)
    expect(owner[26 * width + 31]).toBe(-1)
    for (const id of ['a', 'b', 'c']) {
      const b = box(id)
      expect(25 >= b.y && 25 < b.y + b.height).toBe(false)
    }
  })
})

// ── §3 블록 하나에 오브젝트 하나 ────────────────────────────────────────────

describe('§3 기획서 블록과 편집 오브젝트가 1:1이다', () => {
  it('이미지 둘·문구 셋이 각자의 blockId로 남고, 화면에서 각각 잡힌다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const job = await loadStudioJob(STUDIO_JOB_ID)
    const images = job?.imageObjects?.page_1 ?? []
    const texts = job?.textObjects?.page_1 ?? []

    // 수도 이름도 기획서 그대로다 — 합쳐짐도 쪼개짐도 없다.
    expect(images.map((o) => o.blockId)).toEqual(IMAGE_IDS)
    expect(texts.map((o) => o.blockId).toSorted()).toEqual(TEXT_IDS.toSorted())
    // 이미지 오브젝트는 자기 블록의 자리에서 시작한다.
    expect(images.find((o) => o.blockId === 'blk_photo')?.rect).toEqual(PHOTO_RECT)
    expect(images.find((o) => o.blockId === 'blk_cut')?.rect).toEqual(CUT_RECT)
    // 일반 이미지와 컷아웃 모두 오브젝트다 — 컷아웃만 잡히던 화면이 아니다.
    expect(images.find((o) => o.blockId === 'blk_photo')?.assetId).toBe('asset_photo')

    const boxes = await objectBoxes(container)
    // 이미지가 먼저, 문구가 뒤(= 위)에 놓인다. 겹친 자리를 누르면 문구가 잡힌다.
    expect(Array.from(boxes).map(labelOf)).toEqual([
      '이미지 blk_photo',
      '이미지 blk_cut',
      ...TEXT_IDS.map((id) => `꾸며진 문구 ${id}`),
    ])

    // 다섯을 하나씩 고를 수 있고, 한 번에 하나만 골라진다.
    for (const box of boxes) {
      fireEvent.pointerDown(box, { button: 0, clientX: 10, clientY: 10 })
      await waitFor(() => expect(box.getAttribute('aria-pressed')).toBe('true'))
      expect(Array.from(boxes).filter((b) => b.getAttribute('aria-pressed') === 'true').length).toBe(1)
      fireEvent.pointerUp(window)
    }
  })
})

// ── §3 옮기기·크기 조절 ─────────────────────────────────────────────────────

describe('§3 하나를 손대도 나머지는 그대로다', () => {
  it('이미지를 옮기고 문구 크기를 바꾸는 동안 외부 호출은 0건이다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const before = await loadStudioJob(STUDIO_JOB_ID)
    const beforeTexts = before?.textObjects?.page_1 ?? []
    const calls = fetchSpy.mock.calls.length

    const boxes = await objectBoxes(container)
    const photoBox = Array.from(boxes).find((b) => labelOf(b) === '이미지 blk_photo')!

    // ① 일반 이미지를 끌어 옮긴다.
    fireEvent.pointerDown(photoBox, { button: 0, clientX: 0, clientY: 0 })
    await waitFor(() => expect(photoBox.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.pointerMove(window, { clientX: 50, clientY: 30 })
    fireEvent.pointerUp(window)

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.imageObjects?.page_1?.find((o) => o.blockId === 'blk_photo')?.rect).toEqual({
        ...PHOTO_RECT,
        x: PHOTO_RECT.x + 50,
        y: PHOTO_RECT.y + 30,
      })
    }, { timeout: 5000 })

    let job = await loadStudioJob(STUDIO_JOB_ID)
    // 옆 이미지도, 문구 셋도 손대지 않았다.
    expect(job?.imageObjects?.page_1?.find((o) => o.blockId === 'blk_cut')?.rect).toEqual(CUT_RECT)
    expect(job?.textObjects?.page_1?.map((o) => o.rect)).toEqual(beforeTexts.map((o) => o.rect))
    // 기획서 블록의 좌표는 건드리지 않는다 — 결과를 손본 일이 기획서 수정이 되면 안 된다.
    const page = job?.doc.pages.find((p) => p.id === 'page_1')
    expect(page?.blocks.find((b) => b.id === 'blk_photo')?.position).toEqual(PHOTO_RECT)

    // ② 문구 하나의 크기를 모서리로 바꾼다.
    const textBox = Array.from(boxes).find((b) => labelOf(b) === '꾸며진 문구 blk_t2')!
    fireEvent.pointerDown(textBox, { button: 0, clientX: 0, clientY: 0 })
    await waitFor(() => expect(textBox.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.pointerUp(window)
    const handle = await waitFor(() => {
      // eslint-disable-next-line testing-library/no-node-access
      const found = textBox.querySelector<HTMLElement>('.result-object__handle--se')
      expect(found).not.toBeNull()
      return found!
    })
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 40, clientY: 20 })
    fireEvent.pointerUp(window)

    await waitFor(async () => {
      const now = await loadStudioJob(STUDIO_JOB_ID)
      const t2 = now?.textObjects?.page_1?.find((o) => o.blockId === 'blk_t2')
      expect(t2?.rect.width).toBe(440)
      expect(t2?.rect.height).toBe(110)
    }, { timeout: 5000 })

    job = await loadStudioJob(STUDIO_JOB_ID)
    // 나머지 두 문구는 처음 값 그대로다.
    for (const id of ['blk_t1', 'blk_t3']) {
      expect(job?.textObjects?.page_1?.find((o) => o.blockId === id)?.rect).toEqual(
        beforeTexts.find((o) => o.blockId === id)?.rect,
      )
    }
    // 옮기고 늘리는 내내 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })
})

// ── §4 합성 순서와 지금 자리 ────────────────────────────────────────────────

describe('§4 배경 → 이미지·컷아웃 → 문구', () => {
  it('다시 합칠 때 옮긴 이미지가 새 자리로, 문구가 맨 앞으로 실린다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const boxes = await objectBoxes(container)
    const cutBox = Array.from(boxes).find((b) => labelOf(b) === '이미지 blk_cut')!

    composed.mockClear()
    fireEvent.pointerDown(cutBox, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: -20, clientY: 60 })
    fireEvent.pointerUp(window)

    await waitFor(() => expect(composed).toHaveBeenCalled(), { timeout: 5000 })
    const plan = composed.mock.calls.at(-1)![0] as {
      background?: { assetId: string }
      layers: { blockId: string; rect: LayoutRect }[]
      texts: unknown[]
      textObjects?: { rect: LayoutRect }[]
      externalCalls: number
    }

    expect(plan.background).toBeDefined()
    // 이미지 둘이 기획서 차례 그대로 배경 뒤에 온다.
    expect(plan.layers.map((l) => l.blockId)).toEqual(IMAGE_IDS)
    // 옮긴 컷아웃은 새 자리로 실린다. 종이 테두리와 그림자는 이 자리에서 함께 그려진다.
    expect(plan.layers.find((l) => l.blockId === 'blk_cut')?.rect).toEqual({
      ...CUT_RECT,
      x: CUT_RECT.x - 20,
      y: CUT_RECT.y + 60,
    })
    // 옮기지 않은 이미지는 기획서 자리 그대로다.
    expect(plan.layers.find((l) => l.blockId === 'blk_photo')?.rect).toEqual(PHOTO_RECT)
    // 문구는 맨 앞 한 겹이고, 기획서 문구를 다시 그리지 않는다.
    expect(plan.textObjects?.length).toBe(3)
    expect(plan.texts).toEqual([])
    expect(plan.externalCalls).toBe(0)
  })
})

// ── 저장 파일 왕복 ──────────────────────────────────────────────────────────

describe('작업 파일이 두 갈래 오브젝트를 모두 지킨다', () => {
  it('자리와 크기가 담기고, 자산 재번호를 따라가며, 예전 파일은 빈 값으로 읽힌다', async () => {
    const mod = await load('domain/studioFile')
    const doc = sampleDoc()
    const base = createStudioJob(doc, 1_000, STUDIO_JOB_ID)
    const job = {
      ...base,
      imageObjects: {
        page_1: [{ blockId: 'blk_photo', assetId: 'asset_photo', rect: { x: 11, y: 22, width: 33, height: 44 }, layer: 0 }],
      },
      textObjects: {
        page_1: [{ blockId: 'blk_t1', assetId: 'asset_text', rect: { x: 1, y: 2, width: 3, height: 4 }, layer: 2 }],
      },
    }

    const state = mod.toStudioFileState(job)
    expect(mod.studioFileAssetIds(state)).toContain('asset_photo')
    expect(mod.studioFileAssetIds(state)).toContain('asset_text')

    const remapped = mod.remapStudioFileState(state, new Map([['asset_photo', 'asset_photo_2']]))
    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(remapped)))
    expect(parsed?.imageObjects?.page_1?.[0]?.assetId).toBe('asset_photo_2')
    expect(parsed?.imageObjects?.page_1?.[0]?.rect).toEqual({ x: 11, y: 22, width: 33, height: 44 })
    expect(parsed?.textObjects?.page_1?.[0]?.rect).toEqual({ x: 1, y: 2, width: 3, height: 4 })

    const old = mod.parseStudioFileState({ version: '0.6.0', source: null, productImages: {} })
    expect(old?.imageObjects ?? {}).toEqual({})
  })

  it('파일을 채택하면 옮겨 둔 자리가 그대로 돌아온다', async () => {
    await seedJob()

    const moved = { x: 90, y: 640, width: 320, height: 320 }
    const grown = { x: 130, y: 150, width: 460, height: 150 }
    const parsed = (await load('domain/studioFile')).parseStudioFileState({
      version: '0.7.0',
      source: null,
      productImages: { blk_photo: 'asset_photo', blk_cut: 'asset_cut' },
      imageObjects: {
        page_1: [{ blockId: 'blk_photo', assetId: 'asset_photo', rect: moved, layer: 0 }],
      },
      textObjects: {
        page_1: [{ blockId: 'blk_t1', assetId: 'asset_text', rect: grown, layer: 2 }],
      },
    })

    // 채택 경로를 그대로 지난다 — 이 길이 오브젝트를 빠뜨리면 파일을 다시 연
    // 순간 옮겨 둔 자리가 제자리로 튄다.
    let api: ReturnType<typeof useStudioJob> = null
    function Probe() {
      api = useStudioJob()
      return null
    }
    render(
      <MemoryRouter initialEntries={['/studio']}>
        <StudioJobProvider>
          <Probe />
        </StudioJobProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(api).not.toBeNull())
    await api!.adoptFile(sampleDoc(), parsed)

    await waitFor(() => {
      const job = jobRefOf(api!)
      expect(job.imageObjects?.page_1?.[0]?.rect).toEqual(moved)
      expect(job.textObjects?.page_1?.[0]?.rect).toEqual(grown)
    })
    // 저장소에도 같은 값이 남는다.
    const saved = await loadStudioJob(STUDIO_JOB_ID)
    expect(saved?.imageObjects?.page_1?.[0]?.rect).toEqual(moved)
    expect(saved?.textObjects?.page_1?.[0]?.rect).toEqual(grown)
  })
})
