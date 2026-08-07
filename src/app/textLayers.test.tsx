/**
 * 문구·버튼을 블록마다 한 장씩 (블록별 문구 Patch §최소 확인).
 *
 * fixture는 서로 가까이 붙은 문구 셋과 버튼 하나, 그리고 일반 이미지 하나와 종이
 * 컷아웃 하나다. 실물 이미지는 넣지 않는다 — 픽셀이 필요한 자리는 손으로 심는다.
 *
 * 여기서 묻는 것은 하나다. **자르는 자리가 없는가.** 블록 하나에 그림 한 장이면
 * 어느 픽셀이 누구 것인지 고를 일이 없고, 합쳐지거나 쪼개질 일도 없다.
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

/** 잘라 낸 그림이 실패했다고 할 문구 — 한 장이 실패해도 나머지가 가는지 본다. */
const trim = vi.hoisted(() => ({ failFor: null as string | null, size: { width: 400, height: 100 } }))

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
// 캔버스가 필요한 두 서비스. 규칙은 §1 순수 검사에서 숫자로 재고, 여기서는 흐름만
// 본다. `failFor`가 켜진 요청 하나만 "글자를 못 찾았다"로 만든다.
vi.mock('../services/trimToContent', () => ({
  trimToContent: async (blob: Blob) => {
    if (trim.failFor !== null) {
      const at = trim.failFor
      trim.failFor = null
      if (at === 'now') return null
    }
    return { blob, width: trim.size.width, height: trim.size.height }
  },
}))
vi.mock('../services/regionTone', () => ({
  REGION_MAX_SIDE: 512,
  analyzeRegions: async (_blob: Blob, rects: unknown[]) =>
    rects.map(() => ({ average: { r: 120, g: 90, b: 60 }, brightness: 0.4, contrast: 0.3 })),
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
const TEXT_RECTS: Record<string, LayoutRect> = {
  blk_t1: { x: 60, y: 100, width: 420, height: 120 },
  blk_t2: { x: 60, y: 220, width: 420, height: 90 },
  blk_t3: { x: 300, y: 170, width: 300, height: 110 },
  blk_btn: { x: 280, y: 980, width: 280, height: 80 },
}
const CONTENTS: Record<string, string> = {
  blk_t1: '여름 감사제 40%',
  blk_t2: '전 품목 균일가',
  blk_t3: '선착순 300명',
  blk_btn: '지금 신청하기',
}
const SHEET_IDS = ['blk_t1', 'blk_t2', 'blk_t3', 'blk_btn']
const IMAGE_IDS = ['blk_photo', 'blk_cut']
/** 배경 1 + 문구·버튼 4. */
const CALLS = 1 + SHEET_IDS.length

/** 일반 이미지 1 · 컷아웃 1 · 가까이 붙은 문구 3 · 버튼 1. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('블록별 문구 시험'))
  doc.pages[0]!.id = 'page_1'
  doc.activePageId = 'page_1'
  doc.pages[0]!.blocks = [
    createBlock('sub_product_image', { id: 'blk_photo', label: '일반 이미지', position: { ...PHOTO_RECT } }),
    createBlock('main_product_image', { id: 'blk_cut', label: '컷아웃', position: { ...CUT_RECT } }),
    // 아래 셋은 서로 맞닿거나 겹친다 — 한 장으로 받아 가르면 반드시 섞이는 배치다.
    createBlock('free_text', { id: 'blk_t1', label: '큰 문구', content: CONTENTS.blk_t1!, position: { ...TEXT_RECTS.blk_t1! } }),
    createBlock('free_text', { id: 'blk_t2', label: '가까운 문구', content: CONTENTS.blk_t2!, position: { ...TEXT_RECTS.blk_t2! } }),
    createBlock('free_text', { id: 'blk_t3', label: '겹치는 문구', content: CONTENTS.blk_t3!, position: { ...TEXT_RECTS.blk_t3! } }),
    createBlock('cta_button', { id: 'blk_btn', label: '버튼', content: CONTENTS.blk_btn!, position: { ...TEXT_RECTS.blk_btn! } }),
  ]
  doc.pages[0]!.canvasHeight = 1200
  return doc
}

async function seedJob() {
  const doc = sampleDoc()
  const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '블록문구.eventbrief')
  await saveStudioJob({
    ...job,
    productImages: { blk_photo: 'asset_photo', blk_cut: 'asset_cut' },
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
  await waitFor(() => expect(container.querySelectorAll('.canvas__sheet .block-card').length).toBe(6), {
    timeout: 5000,
  })
}

/** 한 번 누르고, 나간 요청이 다 끝날 때까지 기다린다. */
async function generateOnce(calls = CALLS) {
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
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(calls), { timeout: 10000 })
  await waitFor(async () => {
    const job = await loadStudioJob(STUDIO_JOB_ID)
    expect(job?.results?.page_1).toBeDefined()
  }, { timeout: 10000 })
}

const labelOf = (el: HTMLElement) => el.getAttribute('aria-label') ?? ''
const bodies = () => fetchSpy.mock.calls.map((c) => c[1].body as FormData)
const promptOf = (form: FormData) => String(form.get('prompt'))
const namesOf = (form: FormData) =>
  form.getAll('images[]').filter((v): v is File => typeof v !== 'string').map((f) => f.name)

beforeEach(async () => {
  trim.failFor = null
  trim.size = { width: 400, height: 100 }
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

// ── §1 상자 안에 앉히는 규칙 ────────────────────────────────────────────────

describe('§1 받은 그림은 기획서 상자를 넘지 않는다', () => {
  it('비율을 지키면서 상자 안에 가장 크게, 가운데로 앉는다', async () => {
    const { containRect } = await load('domain/textLayers')

    // 상자보다 세로가 모자란 경우 → 높이가 상자에 닿고 좌우가 남는다.
    expect(containRect({ width: 400, height: 100 }, { x: 60, y: 220, width: 420, height: 90 })).toEqual({
      x: 90, y: 220, width: 360, height: 90,
    })
    // 가로가 먼저 닿는 경우 → 폭이 상자에 닿고 위아래가 남는다.
    expect(containRect({ width: 400, height: 100 }, { x: 60, y: 100, width: 420, height: 200 })).toEqual({
      x: 60, y: 148, width: 420, height: 105,
    })
    // 세로로 더 긴 그림 → 높이가 상자에 닿고 좌우가 남는다.
    expect(containRect({ width: 100, height: 400 }, { x: 0, y: 0, width: 200, height: 200 })).toEqual({
      x: 75, y: 0, width: 50, height: 200,
    })
    // 어떤 그림이든 상자를 넘지 않는다 — 이것이 이 함수의 계약이다.
    for (const content of [{ width: 3000, height: 20 }, { width: 20, height: 3000 }, { width: 7, height: 7 }]) {
      const box = { x: 10, y: 20, width: 300, height: 120 }
      const fitted = containRect(content, box)
      expect(fitted.width).toBeLessThanOrEqual(box.width)
      expect(fitted.height).toBeLessThanOrEqual(box.height)
      expect(fitted.x).toBeGreaterThanOrEqual(box.x)
      expect(fitted.y).toBeGreaterThanOrEqual(box.y)
    }
  })

  it('넓은 상자부터 중요도 1위다', async () => {
    const { importanceRanks } = await load('domain/textLayers')
    const blocks = SHEET_IDS.map((blockId, i) => ({
      blockId,
      content: CONTENTS[blockId]!,
      kind: 'text' as const,
      rect: TEXT_RECTS[blockId]!,
      align: 'center' as const,
      layer: i,
      overlapsImage: false,
    }))
    const ranks = importanceRanks(blocks, { width: 840, height: 1200 })
    // 420×120 > 420×90 > 300×110 > 280×80
    expect(ranks.get('blk_t1')).toBe(1)
    expect(ranks.get('blk_btn')).toBe(4)
  })
})

// ── §2 블록마다 한 장 ───────────────────────────────────────────────────────

describe('§2 문구 셋과 버튼 하나가 각각 한 장씩 만들어진다', () => {
  it('오브젝트는 정확히 넷이고, 자리는 기획서 상자 안이다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const job = await loadStudioJob(STUDIO_JOB_ID)
    const texts = job?.textObjects?.page_1 ?? []

    // 넷. 합쳐지지도, 쪼개지지도 않았다.
    expect(texts).toHaveLength(4)
    expect(texts.map((o) => o.blockId)).toEqual(SHEET_IDS)
    expect(new Set(texts.map((o) => o.assetId)).size).toBe(4)

    // 자리는 기획서 상자를 넘지 않는다.
    for (const object of texts) {
      const box = TEXT_RECTS[object.blockId]!
      expect(object.rect.width).toBeLessThanOrEqual(box.width)
      expect(object.rect.height).toBeLessThanOrEqual(box.height)
      expect(object.rect.x).toBeGreaterThanOrEqual(box.x)
      expect(object.rect.y).toBeGreaterThanOrEqual(box.y)
    }

    // 이미지·컷아웃은 생성 전 좌표 그대로다.
    const images = job?.imageObjects?.page_1 ?? []
    expect(images.map((o) => o.blockId)).toEqual(IMAGE_IDS)
    expect(images.find((o) => o.blockId === 'blk_photo')?.rect).toEqual(PHOTO_RECT)
    expect(images.find((o) => o.blockId === 'blk_cut')?.rect).toEqual(CUT_RECT)
    const page = job?.doc.pages.find((p) => p.id === 'page_1')
    expect(page?.blocks.find((b) => b.id === 'blk_cut')?.position).toEqual(CUT_RECT)

    // 배경 1 + 문구 4 = 5회. 스스로 다시 부른 자리가 없다.
    expect(fetchSpy).toHaveBeenCalledTimes(CALLS)
  })

  it('요청 한 건에 문구 하나씩만 실리고, 배경 그림이 함께 붙는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const [plate, ...texts] = bodies()

    // ① 배경 요청 — 문구 원문이 없다.
    expect(promptOf(plate!)).toContain('배경 레이어')
    for (const content of Object.values(CONTENTS)) expect(promptOf(plate!)).not.toContain(content)

    // ② 문구 요청 넷 — 각각 자기 문구 하나만, 그리고 1단계 배경 한 장을 붙인다.
    expect(texts).toHaveLength(4)
    for (const [i, form] of texts.entries()) {
      const prompt = promptOf(form!)
      const mine = CONTENTS[SHEET_IDS[i]!]!
      expect(prompt).toContain(mine)
      for (const other of Object.values(CONTENTS)) {
        if (other !== mine) expect(prompt).not.toContain(other)
      }
      // 줄 나눔은 기획서가 끊는 그대로, 그리고 기울이지 않는다.
      expect(prompt).toContain('정확히 1줄입니다')
      expect(prompt).toContain(`1행: "${mine}"`)
      expect(prompt).toContain('글자를 기울이지 마세요')
      // 자리별 색은 숫자로만 간다.
      expect(prompt).toContain('R120')
      // 사용자 이미지는 어느 요청에도 실리지 않는다.
      expect(namesOf(form!)).toEqual(['1-background-plate.png'])
      for (const banned of ['asset_photo', 'asset_cut', 'data:', 'base64']) {
        expect(prompt).not.toContain(banned)
      }
    }
    // 버튼은 배경판까지 한 덩어리로 주문한다.
    expect(promptOf(texts[3]!)).toContain('배경판·테두리·글자를 한 덩어리로')
  })

  it('한 장이 실패해도 나머지 셋은 그대로 남는다', async () => {
    trim.failFor = 'now'
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const job = await loadStudioJob(STUDIO_JOB_ID)
    const texts = job?.textObjects?.page_1 ?? []
    expect(texts.map((o) => o.blockId)).toEqual(['blk_t2', 'blk_t3', 'blk_btn'])
    // 무엇이 빠졌는지 말한다.
    expect((await screen.findByText(/얹지 못했습니다/)).textContent).toContain(CONTENTS.blk_t1!)
    // 배경과 이미지는 남는다. 자동 재시도는 없다.
    expect(job?.backgrounds?.page_1).toBeDefined()
    expect(job?.imageObjects?.page_1?.map((o) => o.blockId)).toEqual(IMAGE_IDS)
    expect(fetchSpy).toHaveBeenCalledTimes(CALLS)
  })
})

// ── §3 만든 뒤 따로 움직인다 ────────────────────────────────────────────────

describe('§3 넷을 각각 고르고 따로 움직인다', () => {
  it('하나를 옮기거나 늘려도 나머지는 그대로고, 모서리는 비율을 지킨다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const calls = fetchSpy.mock.calls.length
    const boxes = await waitFor(() => {
      // 이미지 둘 + 문구·버튼 넷.
      const found = container.querySelectorAll<HTMLElement>('.result-object')
      expect(found.length).toBe(6)
      return found
    }, { timeout: 5000 })

    const sheetBoxes = Array.from(boxes).filter((b) => labelOf(b).startsWith('꾸며진 문구'))
    expect(sheetBoxes.map(labelOf)).toEqual(SHEET_IDS.map((id) => `꾸며진 문구 ${id}`))
    for (const box of sheetBoxes) {
      fireEvent.pointerDown(box, { button: 0, clientX: 5, clientY: 5 })
      await waitFor(() => expect(box.getAttribute('aria-pressed')).toBe('true'))
      expect(Array.from(boxes).filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
      fireEvent.pointerUp(window)
    }

    const before = await loadStudioJob(STUDIO_JOB_ID)
    const rectOf = (job: typeof before, id: string) =>
      job?.textObjects?.page_1?.find((o) => o.blockId === id)?.rect

    // 버튼을 끌어 옮긴다.
    const buttonBox = sheetBoxes.at(-1)!
    const beforeButton = rectOf(before, 'blk_btn')!
    fireEvent.pointerDown(buttonBox, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 30, clientY: -40 })
    fireEvent.pointerUp(window)
    await waitFor(async () => {
      expect(rectOf(await loadStudioJob(STUDIO_JOB_ID), 'blk_btn')).toEqual({
        ...beforeButton,
        x: beforeButton.x + 30,
        y: beforeButton.y - 40,
      })
    }, { timeout: 5000 })

    // 모서리를 잡으면 가로세로 비율이 유지된다 — 그림이 찌그러지지 않는다.
    const first = sheetBoxes[0]!
    const beforeT1 = rectOf(before, 'blk_t1')!
    fireEvent.pointerDown(first, { button: 0, clientX: 0, clientY: 0 })
    await waitFor(() => expect(first.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.pointerUp(window)
    const handle = await waitFor(() => {
      // eslint-disable-next-line testing-library/no-node-access
      const found = first.querySelector<HTMLElement>('.result-object__handle--se')
      expect(found).not.toBeNull()
      return found!
    })
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 })
    // 가로로만 끌어도 세로가 같은 비율로 따라온다.
    fireEvent.pointerMove(window, { clientX: 120, clientY: 0 })
    fireEvent.pointerUp(window)
    await waitFor(async () => {
      const now = rectOf(await loadStudioJob(STUDIO_JOB_ID), 'blk_t1')!
      expect(now.width).toBeGreaterThan(beforeT1.width)
      expect(now.width / now.height).toBeCloseTo(beforeT1.width / beforeT1.height, 3)
    }, { timeout: 5000 })

    // 손대지 않은 둘은 처음 값 그대로다.
    const after = await loadStudioJob(STUDIO_JOB_ID)
    for (const id of ['blk_t2', 'blk_t3']) {
      expect(rectOf(after, id)).toEqual(rectOf(before, id))
    }
    expect(after?.imageObjects?.page_1?.find((o) => o.blockId === 'blk_cut')?.rect).toEqual(CUT_RECT)
    // 옮기는 동안 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })

  it('합성은 배경 → 이미지·컷아웃 → 문구·버튼 차례다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const plan = composed.mock.calls.at(-1)![0] as {
      background?: { assetId: string }
      layers: { blockId: string; rect: LayoutRect }[]
      texts: unknown[]
      textObjects?: { rect: LayoutRect }[]
      externalCalls: number
    }
    expect(plan.background).toBeDefined()
    expect(plan.layers.map((l) => l.blockId)).toEqual(IMAGE_IDS)
    expect(plan.layers.find((l) => l.blockId === 'blk_cut')?.rect).toEqual(CUT_RECT)
    expect(plan.textObjects).toHaveLength(4)
    expect(plan.texts).toEqual([])
    expect(plan.externalCalls).toBe(0)
  })
})
