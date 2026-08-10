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
import { cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'
import { clearAll, getAllAssets, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
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
import { resetFoldsForTests } from '../components/studio/PanelFold'
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
vi.mock('../services/referenceUpload', () => ({
  // 참고 그림 줄이기는 캔버스를 쓴다. 규칙은 §순수 검사에서 숫자로 재고, 여기서는
  // 원본을 그대로 흘려 보내 "무엇을 보냈는가"만 본다.
  shrinkReference: async (blob: Blob) => blob,
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
  analyzeImageBlob: async () => ({
    palette: [{ hex: '#f2c9d8', share: 0.5 }, { hex: '#3a2b2f', share: 0.3 }],
    average: { r: 210, g: 170, b: 185 },
    brightness: 0.72,
    contrast: 0.48,
    saturation: 0.31,
    temperature: 0.26,
    opaqueRatio: 0.6,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    light: { x: 0, y: 0, confidence: 'low' },
  }),
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
/** 참이면 합성이 실패한다 — 자동 합치기가 실패를 되풀이하는지 보려고. */
let composeFails = false
vi.mock('../services/compositeRenderer', () => ({
  renderComposite: async (plan: unknown) => {
    composed(plan)
    if (composeFails) throw new Error('합성 실패')
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


/**
 * 접혀 있는 우측 패널 칸을 편다 (우측 패널 정리 Patch).
 *
 * 이미 펴져 있으면 그대로 둔다 — 열림 상태는 이 파일 안에서 이어지므로, 앞선
 * 검사가 펴 둔 칸을 다시 눌러 접어 버리지 않게 한다.
 */
async function openFold(name: RegExp) {
  const head = await screen.findByRole('button', { name })
  if (head.getAttribute('aria-expanded') === 'false') fireEvent.click(head)
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
  composeFails = false
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

// ── §4 앞뒤 순서 ────────────────────────────────────────────────────────────

describe('§4 이미지와 문구가 한 줄에 선다', () => {
  it('순서 계산은 한 칸씩 옮기고 끝에서 멈춘다', async () => {
    const { reorderLayers, layerOrderOf } = await load('domain/textLayers')

    // 뒤에서 앞 차례. 배열 끝이 맨 앞이다.
    const order = ['a', 'b', 'c', 'd']
    expect(reorderLayers(order, 'a', 'front')).toEqual(['b', 'c', 'd', 'a'])
    expect(reorderLayers(order, 'a', 'forward')).toEqual(['b', 'a', 'c', 'd'])
    expect(reorderLayers(order, 'd', 'backward')).toEqual(['a', 'b', 'd', 'c'])
    expect(reorderLayers(order, 'd', 'back')).toEqual(['d', 'a', 'b', 'c'])
    // 끝에 닿으면 그대로다. 없는 이름도 그대로다.
    expect(reorderLayers(order, 'd', 'front')).toEqual(order)
    expect(reorderLayers(order, 'a', 'back')).toEqual(order)
    expect(reorderLayers(order, 'zz', 'front')).toEqual(order)

    // 두 갈래가 같은 번호 체계로 한 줄에 선다. 같은 번호면 이미지가 뒤다.
    expect(
      layerOrderOf(
        [{ blockId: 'img', layer: 1 }],
        [{ blockId: 'txt', layer: 1 }, { blockId: 'top', layer: 5 }],
      ),
    ).toEqual(['img', 'txt', 'top'])
  })

  it('문구를 맨 뒤로 보내면 합성도 그 차례로 그린다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.result-object')
      expect(found.length).toBe(6)
      return found
    }, { timeout: 5000 })

    // 처음 차례: 이미지 둘이 뒤, 문구·버튼 넷이 앞.
    expect(Array.from(boxes).map(labelOf)).toEqual([
      '이미지 blk_photo',
      '이미지 blk_cut',
      ...SHEET_IDS.map((id) => `꾸며진 문구 ${id}`),
    ])

    const calls = fetchSpy.mock.calls.length
    const title = Array.from(boxes).find((b) => labelOf(b) === '꾸며진 문구 blk_t1')!
    fireEvent.pointerDown(title, { button: 0, clientX: 5, clientY: 5 })
    await waitFor(() => expect(title.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.pointerUp(window)

    composed.mockClear()
    fireEvent.click(await within(title).findByRole('button', { name: '맨 뒤로' }))

    // 저장된 번호가 그 문구를 맨 뒤로 보낸다.
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      const t1 = job?.textObjects?.page_1?.find((o) => o.blockId === 'blk_t1')
      const photo = job?.imageObjects?.page_1?.find((o) => o.blockId === 'blk_photo')
      expect(t1?.layer).toBe(0)
      expect(photo!.layer).toBeGreaterThan(t1!.layer)
    }, { timeout: 5000 })

    // 화면 차례도 따라 바뀐다 — 맨 뒤가 목록의 처음이다.
    await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.result-object')
      expect(labelOf(found[0]!)).toBe('꾸며진 문구 blk_t1')
    }, { timeout: 5000 })

    // 합성 계획도 같은 번호를 받는다 — 이미지가 그 문구보다 앞이다.
    await waitFor(() => expect(composed).toHaveBeenCalled(), { timeout: 5000 })
    const plan = composed.mock.calls.at(-1)![0] as {
      layers: { blockId: string; order: number }[]
      textObjects?: { order: number }[]
    }
    const back = Math.min(...(plan.textObjects ?? []).map((t) => t.order))
    expect(back).toBe(0)
    for (const layer of plan.layers) expect(layer.order).toBeGreaterThan(back)

    // 순서를 바꾸는 데 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })
})

// ── §5 배경이 사진 색을 알고 만들어진다 ──────────────────────────────────────

describe('§5 배경 주문이 그 자리에 놓일 사진의 색을 안다', () => {
  it('색은 숫자로만 실리고, 그림·자산 번호는 나가지 않는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const plate = promptOf(bodies()[0]!)
    // 그 자리에 무엇이 놓이는지, 그리고 어떤 색인지.
    expect(plate).toContain('오려 붙인 컷아웃')
    expect(plate).toContain('그 자리에 놓일 것의 색')
    expect(plate).toContain('#f2c9d8')
    expect(plate).toContain('R210')
    expect(plate).toContain('밝기 0.72')
    expect(plate).toContain('대비 0.48')
    expect(plate).toContain('채도 0.31')
    expect(plate).toContain('색온도 0.26')
    expect(plate).toContain('그 사진이 배경 위에서 살도록')

    // 그림도 자산 번호도 파일명도 나가지 않는다.
    expect(namesOf(bodies()[0]!)).toEqual([])
    for (const banned of ['asset_photo', 'asset_cut', '.png', 'data:', 'base64']) {
      expect(plate).not.toContain(banned)
    }
    // 배경을 만드는 데 든 호출은 여전히 한 번이다.
    expect(fetchSpy).toHaveBeenCalledTimes(CALLS)
  })

  it('레퍼런스 배경 그대로 스위치가 주문을 바꾸고, 작업 파일에 남는다', async () => {
    const { buildPlatePrompt } = await load('domain/preserveDesign')
    const fixed = [
      { blockId: 'b', assetId: 'a', rect: PHOTO_RECT, layer: 0, cutout: false },
    ]
    const size = { width: 840, height: 1200 }

    const off = buildPlatePrompt({ size, styleReferenceAssetId: 'asset_style', fixed })
    expect(off).toContain('복제하지 않습니다')
    expect(off).not.toContain('배경 구성을 최대한 그대로')

    const on = buildPlatePrompt({ size, styleReferenceAssetId: 'asset_style', fixed, keepReferenceBackground: true })
    expect(on).toContain('배경 구성을 최대한 그대로')
    // 켜더라도 비워 둘 자리는 여전히 지킨다.
    expect(on).toContain('비워 둘 자리')

    // 작업 파일 왕복에서 스위치가 남는다.
    const mod = await load('domain/studioFile')
    const studioJob = await load('domain/studioJob')
    const job = studioJob.withKeepReferenceBg(
      createStudioJob(sampleDoc(), 1_000, STUDIO_JOB_ID),
      'page_1',
      true,
      2_000,
    )
    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(mod.toStudioFileState(job))))
    expect(parsed?.keepReferenceBg?.page_1).toBe(true)
    // 예전 파일에는 없다 — 없으면 꺼진 것으로 읽는다.
    const old = mod.parseStudioFileState({ version: '0.7.0', source: null, productImages: {} })
    expect(old?.keepReferenceBg ?? {}).toEqual({})
  })
})

// ── §6 고른 문구만 하나씩 다시 만든다 ───────────────────────────────────────

describe('§6 부분수정은 고른 것만 건드린다', () => {
  it('둘을 고르면 두 번 나가고, 고르지 않은 것과 배경·이미지는 그대로다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const before = await loadStudioJob(STUDIO_JOB_ID)
    const assetOf = (job: typeof before, id: string) =>
      job?.textObjects?.page_1?.find((o) => o.blockId === id)?.assetId
    const rectOf = (job: typeof before, id: string) =>
      job?.textObjects?.page_1?.find((o) => o.blockId === id)?.rect
    const madeCalls = fetchSpy.mock.calls.length

    // 문구 둘을 고르고 각자의 지시를 적는다.
    for (const content of [CONTENTS.blk_t1!, CONTENTS.blk_t3!]) {
      fireEvent.click(await screen.findByRole('checkbox', { name: new RegExp(content) }))
    }
    for (const label of [/여름 감사제 40% 수정 지시/, /선착순 300명 수정 지시/]) {
      fireEvent.change(await screen.findByLabelText(label), { target: { value: '더 굵게' } })
    }

    fireEvent.click(await screen.findByRole('button', { name: 'AI 부분수정 실행' }))
    const dialog = await screen.findByRole('dialog')
    // 확인창이 나갈 횟수를 그대로 말한다.
    expect(dialog.textContent).toContain('2회')
    fireEvent.click(
      // eslint-disable-next-line testing-library/no-node-access
      Array.from(dialog.querySelectorAll('button')).find((b) => /실행|시작|계속/.test(b.textContent ?? ''))!,
    )

    // 고른 둘만 그림이 바뀐다.
    await waitFor(async () => {
      const now = await loadStudioJob(STUDIO_JOB_ID)
      expect(assetOf(now, 'blk_t1')).not.toBe(assetOf(before, 'blk_t1'))
      expect(assetOf(now, 'blk_t3')).not.toBe(assetOf(before, 'blk_t3'))
    }, { timeout: 10000 })

    const after = await loadStudioJob(STUDIO_JOB_ID)
    // 고르지 않은 문구는 그림도 자리도 그대로다 — 별개 파일이라 바뀔 수가 없다.
    for (const id of ['blk_t2', 'blk_btn']) {
      expect(assetOf(after, id)).toBe(assetOf(before, id))
      expect(rectOf(after, id)).toEqual(rectOf(before, id))
    }
    // 고친 것도 자리와 크기는 그대로다. 바뀌는 것은 그림뿐이다.
    for (const id of ['blk_t1', 'blk_t3']) {
      expect(rectOf(after, id)).toEqual(rectOf(before, id))
    }
    // 배경과 이미지·컷아웃은 손대지 않는다.
    expect(after?.backgrounds?.page_1).toEqual(before?.backgrounds?.page_1)
    expect(after?.imageObjects?.page_1).toEqual(before?.imageObjects?.page_1)

    // 고른 개수만큼만 나갔다. 통이미지를 다시 그리지 않았다.
    expect(fetchSpy.mock.calls.length).toBe(madeCalls + 2)
    for (const call of fetchSpy.mock.calls.slice(madeCalls)) {
      expect(String((call[1].body as FormData).get('prompt'))).toContain('문구 **한 개**만 새로 디자인')
    }
  })

  it('고치는 요청도 첫 생성과 같은 재료를 본다 — 레퍼런스·배경·그 자리의 색', async () => {
    await seedJob()
    // 이 블록에만 참고 그림을 붙여 둔다 — 고칠 때도 같은 그림을 본다.
    await putAsset(storedAsset('asset_ref', 9))
    const seeded = await loadStudioJob(STUDIO_JOB_ID)
    await saveStudioJob({ ...seeded!, blockOrders: { blk_t1: { referenceAssetId: 'asset_ref' } } })

    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()
    const madeCalls = fetchSpy.mock.calls.length

    fireEvent.click(await screen.findByRole('checkbox', { name: new RegExp(CONTENTS.blk_t1!) }))
    fireEvent.change(await screen.findByLabelText(/여름 감사제 40% 수정 지시/), {
      target: { value: '배경과 어울리는 색으로' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'AI 부분수정 실행' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      // eslint-disable-next-line testing-library/no-node-access
      Array.from(dialog.querySelectorAll('button')).find((b) => /실행|시작|계속/.test(b.textContent ?? ''))!,
    )
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBe(madeCalls + 1), { timeout: 10000 })

    const form = bodies()[madeCalls]!
    // 앞선 판은 여기서 **한 장도** 보내지 않았다. 이제 지금 그림과 생성된 배경,
    // 그리고 이 블록의 참고 그림이 함께 간다. (이 fixture에는 스타일
    // 레퍼런스가 없어 그 자리는 비어 있다.)
    expect(namesOf(form)).toEqual(['1-current-text.png', '2-background-plate.png', '3-block-reference.png'])

    const prompt = promptOf(form)
    // 그 자리에 실제로 깔려 있는 색이 숫자로 간다 (`analyzeRegions` 대역값).
    expect(prompt).toContain('실제로 깔려 있는 색')
    expect(prompt).toContain('R120 G90 B60')
    // 배경 그림이 무엇인지 말해 준다. 첫 생성과 같은 근거다.
    expect(prompt).toContain('놓여 있는 배경')
    expect(prompt).toContain('이 문구만을 위한 참고 그림')
    // 자리는 페이지 기준의 백분율이다 — 블록 크기로 나누던 예전 값이 아니다.
    expect(prompt).toContain('실제 페이지에서의 자리')
    // 줄 나눔은 그대로 지킨다. 고치다가 한 줄이 두 줄이 되지 않게.
    expect(prompt).toContain('줄 나눔 — 정확히 1줄입니다')
  })
})

// ── §7 기울이기 ─────────────────────────────────────────────────────────────

describe('§7 오브젝트를 기울인다', () => {
  it('기울기가 저장되고 합성 계획에 실리며, 작업 파일에도 남는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const calls = fetchSpy.mock.calls.length
    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.result-object')
      expect(found.length).toBe(6)
      return found
    }, { timeout: 5000 })

    const title = Array.from(boxes).find((b) => labelOf(b) === '꾸며진 문구 blk_t1')!
    fireEvent.pointerDown(title, { button: 0, clientX: 5, clientY: 5 })
    await waitFor(() => expect(title.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.pointerUp(window)

    composed.mockClear()
    // 방향키로 15도. 눈으로 끄는 것과 같은 값을 쓴다.
    const spin = await within(title).findByRole('slider', { name: '기울기' })
    fireEvent.keyDown(spin, { key: 'ArrowRight', shiftKey: true })
    // 다시 합치는 것은 **손을 뗄 때** 한 번이다 — 누르고 있는 동안 지면을 몇십 번
    // 다시 그리지 않는다 (회전 크기 Patch).
    fireEvent.keyUp(spin, { key: 'ArrowRight' })

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.textObjects?.page_1?.find((o) => o.blockId === 'blk_t1')?.angle).toBe(15)
    }, { timeout: 5000 })

    // 합성 계획이 그 각도를 받는다.
    await waitFor(() => expect(composed).toHaveBeenCalled(), { timeout: 5000 })
    const plan = composed.mock.calls.at(-1)![0] as { textObjects?: { angle?: number }[] }
    expect((plan.textObjects ?? []).some((t) => t.angle === 15)).toBe(true)
    // 손대지 않은 것에는 각도가 없다 — 예전 결과가 열려도 달라지지 않는 이유다.
    expect((plan.textObjects ?? []).filter((t) => t.angle !== undefined)).toHaveLength(1)
    // 기울이는 데 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)

    // 작업 파일 왕복에서 각도가 남고, 예전 파일에는 없다.
    const mod = await load('domain/studioFile')
    const job = await loadStudioJob(STUDIO_JOB_ID)
    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(mod.toStudioFileState(job!))))
    expect(parsed?.textObjects?.page_1?.find((o: { blockId: string }) => o.blockId === 'blk_t1')?.angle).toBe(15)
    const old = mod.parseStudioFileState({
      version: '0.7.0',
      source: null,
      productImages: {},
      textObjects: { page_1: [{ blockId: 'b', assetId: 'a', rect: { x: 0, y: 0, width: 1, height: 1 }, layer: 0 }] },
    })
    expect(old?.textObjects?.page_1?.[0]?.angle).toBeUndefined()
  })
})

// ── §8 여럿을 함께 ──────────────────────────────────────────────────────────

describe('§8 여럿을 골라 함께 옮기고 늘린다', () => {
  it('감싸는 상자 계산', async () => {
    const { boundsOf, scaleWithin } = await load('domain/textLayers')
    const a = { x: 10, y: 10, width: 100, height: 50 }
    const b = { x: 200, y: 40, width: 100, height: 60 }
    expect(boundsOf([a, b])).toEqual({ x: 10, y: 10, width: 290, height: 90 })
    expect(boundsOf([])).toBeNull()

    // 감싸는 상자가 두 배가 되면 안의 상자도 자리와 크기가 두 배가 된다.
    const from = { x: 0, y: 0, width: 100, height: 100 }
    const to = { x: 0, y: 0, width: 200, height: 200 }
    expect(scaleWithin({ x: 50, y: 50, width: 20, height: 20 }, from, to)).toEqual({
      x: 100, y: 100, width: 40, height: 40,
    })
  })

  it('둘을 골라 하나를 끌면 둘 다 같은 만큼 움직인다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const calls = fetchSpy.mock.calls.length
    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.result-object')
      expect(found.length).toBe(6)
      return found
    }, { timeout: 5000 })
    const one = Array.from(boxes).find((b) => labelOf(b) === '꾸며진 문구 blk_t1')!
    const two = Array.from(boxes).find((b) => labelOf(b) === '꾸며진 문구 blk_t2')!

    const before = await loadStudioJob(STUDIO_JOB_ID)
    const rectOf = (job: typeof before, id: string) =>
      job?.textObjects?.page_1?.find((o) => o.blockId === id)?.rect

    // 하나를 고르고, Shift로 하나를 더한다.
    fireEvent.pointerDown(one, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    fireEvent.pointerDown(two, { button: 0, clientX: 0, clientY: 0, shiftKey: true })
    fireEvent.pointerUp(window)
    await waitFor(() => {
      expect(one.getAttribute('aria-pressed')).toBe('true')
      expect(two.getAttribute('aria-pressed')).toBe('true')
    })

    // 그중 하나를 끌면 둘 다 같은 만큼 움직인다.
    fireEvent.pointerDown(two, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 25, clientY: 40 })
    fireEvent.pointerUp(window)

    await waitFor(async () => {
      const now = await loadStudioJob(STUDIO_JOB_ID)
      for (const id of ['blk_t1', 'blk_t2']) {
        expect(rectOf(now, id)).toEqual({
          ...rectOf(before, id)!,
          x: rectOf(before, id)!.x + 25,
          y: rectOf(before, id)!.y + 40,
        })
      }
    }, { timeout: 5000 })

    // 고르지 않은 것은 그대로다.
    const after = await loadStudioJob(STUDIO_JOB_ID)
    for (const id of ['blk_t3', 'blk_btn']) expect(rectOf(after, id)).toEqual(rectOf(before, id))
    // 함께 움직이는 데 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })
})

// ── §9 블록별 사전 주문 ─────────────────────────────────────────────────────

describe('§9 블록마다 미리 주문한다', () => {
  it('그 블록의 요청에만 주문과 참고 그림이 실린다', async () => {
    await seedJob()
    // 문구 하나에만 주문과 참고 그림을 붙여 둔다.
    await putAsset(storedAsset('asset_ref', 9))
    const seeded = await loadStudioJob(STUDIO_JOB_ID)
    await saveStudioJob({
      ...seeded!,
      blockOrders: { blk_t2: { note: '둥근 라벨 위에 굵게', referenceAssetId: 'asset_ref' } },
    })

    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const [, ...texts] = bodies()
    // 붙여 둔 블록의 요청에만 그 그림과 그 주문이 실린다.
    const mine = texts[SHEET_IDS.indexOf('blk_t2')]!
    expect(namesOf(mine)).toEqual(['1-background-plate.png', '2-block-reference.png'])
    expect(promptOf(mine)).toContain('둥근 라벨 위에 굵게')
    expect(promptOf(mine)).toContain('이 문구만을 위한 참고 그림')
    expect(promptOf(mine)).toContain('페이지 전체 지시보다 이 주문이 우선합니다')

    // 나머지 요청에는 없다.
    for (const [i, form] of texts.entries()) {
      if (SHEET_IDS[i] === 'blk_t2') continue
      expect(namesOf(form!)).toEqual(['1-background-plate.png'])
      expect(promptOf(form!)).not.toContain('둥근 라벨 위에 굵게')
    }

    // 호출 수는 그대로다 — 주문을 붙인다고 더 나가지 않는다.
    expect(fetchSpy).toHaveBeenCalledTimes(CALLS)
  })

  it('주문이 작업 파일에 남고, 빈 값은 지워지며, 예전 파일은 빈 값으로 읽힌다', async () => {
    const mod = await load('domain/studioFile')
    const studioJob = await load('domain/studioJob')
    let job = studioJob.withBlockOrder(
      createStudioJob(sampleDoc(), 1_000, STUDIO_JOB_ID),
      'blk_t1',
      { note: '굵게', referenceAssetId: 'asset_ref' },
      2_000,
    )
    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(mod.toStudioFileState(job))))
    expect(parsed?.blockOrders?.blk_t1).toEqual({ note: '굵게', referenceAssetId: 'asset_ref' })
    // 참고 그림도 파일에 담기고 재번호를 따라간다.
    expect(mod.studioFileAssetIds(parsed!)).toContain('asset_ref')
    const remapped = mod.remapStudioFileState(parsed!, new Map([['asset_ref', 'asset_ref_2']]))
    expect(remapped.blockOrders?.blk_t1?.referenceAssetId).toBe('asset_ref_2')

    // 비우면 지워진다 — 없는 것과 빈 문자열이 다른 뜻이 되면 안 된다.
    job = studioJob.withBlockOrder(job, 'blk_t1', { note: '   ', referenceAssetId: '' }, 3_000)
    expect(studioJob.blockOrderOf(job, 'blk_t1')).toEqual({})

    const old = mod.parseStudioFileState({ version: '0.8.0', source: null, productImages: {} })
    expect(old?.blockOrders ?? {}).toEqual({})
  })
})

// ── §10 결과 톤 조절 ────────────────────────────────────────────────────────

describe('§10 완성 결과 전체의 톤', () => {
  it('픽셀 계산이 순서대로 걸리고, 0이면 손대지 않는다', async () => {
    const { applyTone, normalizeTone, toneIsFlat, NO_TONE } = await load('domain/toneAdjust')

    // 넷 다 0이면 한 픽셀도 바뀌지 않는다 — 되돌릴 것이 없다는 뜻이다.
    const flat = new Uint8ClampedArray([100, 120, 140, 255])
    applyTone(flat, NO_TONE)
    expect([...flat]).toEqual([100, 120, 140, 255])
    expect(toneIsFlat(NO_TONE)).toBe(true)

    // 밝기를 올리면 셋 다 같은 만큼 오른다.
    const lifted = new Uint8ClampedArray([100, 120, 140, 255])
    applyTone(lifted, { ...NO_TONE, brightness: 0.5 })
    expect(lifted[0]).toBeGreaterThan(100)
    expect(lifted[1]! - 120).toBe(lifted[0]! - 100)

    // 채도 -1이면 회색이 된다 — 세 채널이 같아진다.
    const gray = new Uint8ClampedArray([200, 60, 20, 255])
    applyTone(gray, { ...NO_TONE, saturation: -1 })
    expect(gray[0]).toBe(gray[1])
    expect(gray[1]).toBe(gray[2])

    // 색온도 +는 붉은 쪽을 올리고 푸른 쪽을 내린다.
    const warm = new Uint8ClampedArray([128, 128, 128, 255])
    applyTone(warm, { ...NO_TONE, temperature: 1 })
    expect(warm[0]!).toBeGreaterThan(128)
    expect(warm[2]!).toBeLessThan(128)

    // 투명한 자리는 건드리지 않는다.
    const clear = new Uint8ClampedArray([10, 20, 30, 0])
    applyTone(clear, { ...NO_TONE, brightness: 1 })
    expect([...clear]).toEqual([10, 20, 30, 0])

    // 범위 밖은 경계로 접고, 모르는 값은 0이다.
    expect(normalizeTone({ brightness: 9, contrast: -9, saturation: 'x', temperature: null })).toEqual({
      brightness: 1, contrast: -1, saturation: 0, temperature: 0,
    })
  })

  it('슬라이더가 합성 계획에 실리고, 작업 파일에 남는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const calls = fetchSpy.mock.calls.length
    composed.mockClear()

    await openFold(/결과 톤 조절/)
    const slider = await screen.findByLabelText('밝기 조절')
    fireEvent.change(slider, { target: { value: '40' } })
    fireEvent.pointerUp(slider)

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.tones?.page_1?.brightness).toBeCloseTo(0.4, 5)
    }, { timeout: 5000 })

    await waitFor(() => expect(composed).toHaveBeenCalled(), { timeout: 5000 })
    const plan = composed.mock.calls.at(-1)![0] as { tone: { brightness: number } }
    expect(plan.tone.brightness).toBeCloseTo(0.4, 5)
    // 톤을 만지는 데 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)

    // 작업 파일에 남고, 예전 파일은 손대지 않은 상태로 읽힌다.
    const mod = await load('domain/studioFile')
    const job = await loadStudioJob(STUDIO_JOB_ID)
    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(mod.toStudioFileState(job!))))
    expect(parsed?.tones?.page_1?.brightness).toBeCloseTo(0.4, 5)
    const old = mod.parseStudioFileState({ version: '0.9.0', source: null, productImages: {} })
    expect(old?.tones ?? {}).toEqual({})
  })
})

// ── §11 완성한 뒤에 종이 테두리를 다듬는다 ──────────────────────────────────

describe('§11 완성 후 종이 테두리', () => {
  it('결과 화면의 슬라이더가 합성 계획을 바꾸고, 외부 호출은 없다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const calls = fetchSpy.mock.calls.length
    composed.mockClear()

    // 컷아웃이 켜진 블록만 나온다 — 일반 이미지에는 다듬을 테두리가 없다.
    // 이름은 부분수정 목록과 같은 번호다. 블록 이름표는 둘 다 `이미지`라 구분되지
    // 않는다 (컷아웃 구분 Patch).
    await openFold(/종이 테두리 다듬기/)
    expect(screen.queryByLabelText('이미지 1 종이 테두리 두께')).toBeNull()

    const weight = await screen.findByLabelText('이미지 2 종이 테두리 두께')
    fireEvent.change(weight, { target: { value: '35' } })
    fireEvent.pointerUp(weight)

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.effects?.blk_cut?.paperWeight).toBeCloseTo(0.35, 5)
    }, { timeout: 5000 })

    await waitFor(() => expect(composed).toHaveBeenCalled(), { timeout: 5000 })
    const plan = composed.mock.calls.at(-1)![0] as {
      layers: { blockId: string; effects: { paperWeight: number; paperOpacity: number } }[]
    }
    expect(plan.layers.find((l) => l.blockId === 'blk_cut')?.effects.paperWeight).toBeCloseTo(0.35, 5)

    // 진하기 0은 컷아웃을 끄는 것과 다르다 — 오브젝트도 자리도 그대로다.
    const opacity = await screen.findByLabelText('이미지 2 종이 테두리 진하기')
    fireEvent.change(opacity, { target: { value: '0' } })
    fireEvent.pointerUp(opacity)
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.effects?.blk_cut?.paperOpacity).toBe(0)
      expect(job?.effects?.blk_cut?.paperCutout).toBe(true)
    }, { timeout: 5000 })
    const after = await loadStudioJob(STUDIO_JOB_ID)
    expect(after?.imageObjects?.page_1?.find((o) => o.blockId === 'blk_cut')?.rect).toEqual(CUT_RECT)

    // 테두리를 다듬는 데 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })
})

// ── §12 완성 결과에서 오브젝트를 지운다 ─────────────────────────────────────

describe('§12 오브젝트 삭제', () => {
  it('두 번 눌러야 지워지고, 기획서 블록은 그대로 남는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.result-object')
      expect(found.length).toBe(6)
      return found
    }, { timeout: 5000 })

    const calls = fetchSpy.mock.calls.length
    const title = Array.from(boxes).find((b) => labelOf(b) === '꾸며진 문구 blk_t1')!
    fireEvent.pointerDown(title, { button: 0, clientX: 5, clientY: 5 })
    await waitFor(() => expect(title.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.pointerUp(window)

    // 한 번 누른 것만으로는 지워지지 않는다 — 되돌리기가 없는 화면이다.
    // 이름은 부분수정 목록과 같다 (이름표 Patch) — 블록 이름표가 아니다.
    fireEvent.click(
      await within(title).findByRole('button', { name: new RegExp(`${CONTENTS.blk_t1!} 지우기`) }),
    )
    const before = await loadStudioJob(STUDIO_JOB_ID)
    expect(before?.textObjects?.page_1?.some((o) => o.blockId === 'blk_t1')).toBe(true)

    composed.mockClear()
    fireEvent.click(
      await within(title).findByRole('button', { name: new RegExp(`${CONTENTS.blk_t1!} 정말 지우기`) }),
    )

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.textObjects?.page_1?.some((o) => o.blockId === 'blk_t1')).toBe(false)
    }, { timeout: 5000 })

    // 화면에서도 빠진다. 나머지 다섯은 그대로다.
    await waitFor(() => {
      expect(container.querySelectorAll('.result-object').length).toBe(5)
    }, { timeout: 5000 })

    // 다시 합칠 때도 빠진 채로 그려진다.
    await waitFor(() => expect(composed).toHaveBeenCalled(), { timeout: 5000 })
    const plan = composed.mock.calls.at(-1)![0] as {
      layers: { blockId: string }[]
      textObjects?: { assetId: string }[]
    }
    expect(plan.textObjects?.length).toBe(SHEET_IDS.length - 1)

    // **기획서 블록은 그대로다.** 다시 생성하면 다시 나온다.
    const after = await loadStudioJob(STUDIO_JOB_ID)
    expect(after?.doc.pages[0]?.blocks.some((b) => b.id === 'blk_t1')).toBe(true)
    // 완성본 화면에서는 기획서가 접혀 있다 (완성본 모드 Patch). 꺼내서 확인한다.
    fireEvent.click(await screen.findByRole('button', { name: '기획서 나란히 보기' }))
    await waitFor(() => {
      expect(container.querySelectorAll('.canvas__sheet .block-card').length).toBe(6)
    }, { timeout: 5000 })

    // 지우는 데 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })

  it('이미지를 전부 지워도 되살아나지 않는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    await waitFor(() => {
      expect(container.querySelectorAll('.result-object').length).toBe(6)
    }, { timeout: 5000 })

    const boxFor = (id: string) =>
      Array.from(container.querySelectorAll<HTMLElement>('.result-object')).find(
        (b) => labelOf(b) === `이미지 ${id}`,
      )!
    for (const id of IMAGE_IDS) {
      const drawn = composed.mock.calls.length
      const name = id === 'blk_photo' ? '이미지 1' : '이미지 2'
      // 매번 다시 찾는다 — 앞의 다시 합치기가 화면을 새로 그렸을 수 있다.
      fireEvent.pointerDown(boxFor(id), { button: 0, clientX: 5, clientY: 5 })
      await waitFor(() => expect(boxFor(id).getAttribute('aria-pressed')).toBe('true'), { timeout: 5000 })
      fireEvent.pointerUp(window)
      fireEvent.click(await within(boxFor(id)).findByRole('button', { name: `${name} 지우기` }))
      fireEvent.click(await within(boxFor(id)).findByRole('button', { name: `${name} 정말 지우기` }))
      await waitFor(async () => {
        const job = await loadStudioJob(STUDIO_JOB_ID)
        expect(job?.imageObjects?.page_1?.some((o) => o.blockId === id)).toBe(false)
      }, { timeout: 5000 })
      // 다음 지우기로 넘어가기 전에 이번 합성이 끝나기를 기다린다.
      await waitFor(() => expect(composed.mock.calls.length).toBeGreaterThan(drawn), { timeout: 5000 })
    }

    // 목록이 비었다고 예전 결과로 읽히면 지운 것이 **전부 되살아난다** — 그러면
    // 빈 계획은 한 번도 나올 수 없다. 마지막 한 건만 보지 않는 것은, 잇달아
    // 지우면 합성 둘이 겹쳐 흐르고 끝나는 차례가 정해져 있지 않기 때문이다.
    await waitFor(async () => {
      await loadStudioJob(STUDIO_JOB_ID)
      const plans = composed.mock.calls.map((c) => c[0] as { layers: { blockId: string }[] })
      expect(plans.some((plan) => plan.layers.length === 0)).toBe(true)
    }, { timeout: 5000 })
  })
})

// ── §13 블록별 톤 ───────────────────────────────────────────────────────────

describe('§13 고른 오브젝트만 톤 조절', () => {
  it('고른 것에만 값이 붙고, 전체 톤과 따로 남으며, 작업 파일에도 남는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.result-object')
      expect(found.length).toBe(6)
      return found
    }, { timeout: 5000 })

    await openFold(/결과 톤 조절/)
    // 아무것도 고르지 않았으면 블록별 슬라이더는 없다.
    expect(screen.queryByLabelText(/큰 문구 밝기 조절/)).toBeNull()

    const calls = fetchSpy.mock.calls.length
    const title = Array.from(boxes).find((b) => labelOf(b) === '꾸며진 문구 blk_t1')!
    fireEvent.pointerDown(title, { button: 0, clientX: 5, clientY: 5 })
    await waitFor(() => expect(title.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.pointerUp(window)

    // 전체는 밝게, 고른 문구 하나는 어둡게 — 한 벌의 값으로는 안 되는 일이다.
    const whole = await screen.findByLabelText('밝기 조절')
    fireEvent.change(whole, { target: { value: '30' } })
    fireEvent.pointerUp(whole)

    const mine = await screen.findByLabelText('큰 문구 밝기 조절')
    fireEvent.change(mine, { target: { value: '-50' } })
    fireEvent.pointerUp(mine)

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.objectTones?.blk_t1?.brightness).toBeCloseTo(-0.5, 5)
      expect(job?.tones?.page_1?.brightness).toBeCloseTo(0.3, 5)
    }, { timeout: 5000 })

    // 합성 계획에서도 둘이 따로 실린다.
    await waitFor(async () => {
      await loadStudioJob(STUDIO_JOB_ID)
      const plan = composed.mock.calls.at(-1)![0] as {
        tone: { brightness: number }
        textObjects?: { tone?: { brightness: number } }[]
      }
      expect(plan.tone.brightness).toBeCloseTo(0.3, 5)
      const mineTone = (plan.textObjects ?? []).map((t) => t.tone?.brightness ?? 0)
      expect(mineTone.filter((v) => v !== 0)).toEqual([-0.5])
    }, { timeout: 5000 })

    // 톤을 만지는 데 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)

    // 작업 파일에 남고, 예전 파일은 손대지 않은 상태로 읽힌다.
    const mod = await load('domain/studioFile')
    const job = await loadStudioJob(STUDIO_JOB_ID)
    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(mod.toStudioFileState(job!))))
    expect(parsed?.objectTones?.blk_t1?.brightness).toBeCloseTo(-0.5, 5)
    const old = mod.parseStudioFileState({ version: '0.10.0', source: null, productImages: {} })
    expect(old?.objectTones ?? {}).toEqual({})
  })
})

// ── §14 결과 화면의 실행 취소 ───────────────────────────────────────────────

describe('§14 결과를 되돌린다', () => {
  it('오브젝트를 옮긴 뒤 실행 취소하면 기획서가 아니라 그 오브젝트가 돌아온다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.result-object')
      expect(found.length).toBe(6)
      return found
    }, { timeout: 5000 })

    const before = await loadStudioJob(STUDIO_JOB_ID)
    const rectOf = (job: typeof before, id: string) =>
      job?.textObjects?.page_1?.find((o) => o.blockId === id)?.rect
    const blocksOf = (job: typeof before) => job?.doc.pages[0]?.blocks.map((b) => b.id)
    const was = rectOf(before, 'blk_t1')!
    const calls = fetchSpy.mock.calls.length

    // 한 번 끌어 옮긴다 — 옮기는 동안 수십 번 고쳐 써도 되돌릴 칸은 하나다.
    const title = Array.from(boxes).find((b) => labelOf(b) === '꾸며진 문구 blk_t1')!
    fireEvent.pointerDown(title, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 40, clientY: 30 })
    fireEvent.pointerMove(window, { clientX: 70, clientY: 60 })
    fireEvent.pointerUp(window)

    await waitFor(async () => {
      const now = await loadStudioJob(STUDIO_JOB_ID)
      expect(rectOf(now, 'blk_t1')).not.toEqual(was)
    }, { timeout: 5000 })

    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))

    // 옮기기 전 자리로 돌아온다.
    await waitFor(async () => {
      const now = await loadStudioJob(STUDIO_JOB_ID)
      expect(rectOf(now, 'blk_t1')).toEqual(was)
    }, { timeout: 5000 })

    // **기획서는 손대지 않는다.** 앞선 판은 여기서 기획서가 한 단계 뒤로 갔다.
    const after = await loadStudioJob(STUDIO_JOB_ID)
    expect(blocksOf(after)).toEqual(blocksOf(before))
    fireEvent.click(await screen.findByRole('button', { name: '기획서 나란히 보기' }))
    await waitFor(() => {
      expect(container.querySelectorAll('.canvas__sheet .block-card').length).toBe(6)
    }, { timeout: 5000 })

    // 되돌리는 데 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })
})

// ── §15 무엇을 잡았는지 화면이 말한다 ───────────────────────────────────────

describe('§15 잡은 것의 이름', () => {
  it('잡으면 이름표가 붙고 목록의 그 줄이 강조되며, 목록에서도 잡을 수 있다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.result-object')
      expect(found.length).toBe(6)
      return found
    }, { timeout: 5000 })

    // 아무것도 안 잡았으면 이름표도, 강조된 줄도 없다.
    expect(container.querySelectorAll('.result-object__name').length).toBe(0)
    expect(container.querySelectorAll('.edit-panel__targets > li.is-held').length).toBe(0)

    const cut = Array.from(boxes).find((b) => labelOf(b) === '이미지 blk_cut')!
    fireEvent.pointerDown(cut, { button: 0, clientX: 5, clientY: 5 })
    await waitFor(() => expect(cut.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.pointerUp(window)

    // 상자에 붙는 이름은 **부분수정 목록과 같은 이름**이다.
    const tag = await waitFor(() => {
      const found = container.querySelector('.result-object__name')
      expect(found).not.toBeNull()
      return found!
    }, { timeout: 5000 })
    expect(tag.textContent).toBe('이미지 2')

    // 그 줄이 강조된다.
    await waitFor(() => {
      const held = container.querySelectorAll<HTMLElement>('.edit-panel__targets > li.is-held')
      expect(held.length).toBe(1)
      expect(held[0]!.textContent).toContain('이미지 2')
    }, { timeout: 5000 })

    // 반대 방향 — 목록에서 다른 것을 잡으면 캔버스의 선택이 그리로 옮겨간다.
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(`${CONTENTS.blk_t1!} 화면에서 잡기`) }),
    )
    await waitFor(() => {
      expect(container.querySelector('.result-object__name')?.textContent).toContain(CONTENTS.blk_t1!)
    }, { timeout: 5000 })
    expect(cut.getAttribute('aria-pressed')).toBe('false')
  })
})

// ── §16 완성본 모드 ─────────────────────────────────────────────────────────

describe('§16 완성본이 가운데를 다 쓴다', () => {
  it('기획서는 접혀 있고, 배율은 완성본의 것이며, 판의 폭이 그 배율을 탄다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    // 만들고 나면 완성본 화면이다. 기획서 캔버스는 접혀 있다.
    await waitFor(() => {
      // 완성본을 보는 동안에는 중앙 보기 줄이 아예 없다 (기획서 탭 감추기 Patch).
      // 그래서 "완성본으로 넘어갔는가"는 그 화면의 제목으로 묻는다.
      expect(screen.getByRole('heading', { name: '완성본' })).toBeTruthy()
    }, { timeout: 5000 })
    expect(container.querySelectorAll('.canvas__sheet .block-card').length).toBe(0)

    // 확대·축소는 **완성본의 것**이다. 기획서 막대는 이 화면에 없다.
    expect(screen.queryByLabelText('축소')).toBeNull()
    const stage = () => container.querySelector<HTMLElement>('.compare__stage')!
    await waitFor(() => expect(stage()).not.toBeNull(), { timeout: 5000 })
    expect(stage().style.width).toBe('840px')

    // 100%로 두면 페이지 폭 그대로, 확대하면 판이 그만큼 넓어진다.
    fireEvent.click(screen.getByRole('button', { name: '100%' }))
    await waitFor(() => expect(stage().style.width).toBe('840px'), { timeout: 5000 })
    fireEvent.click(screen.getByLabelText('완성본 확대'))
    await waitFor(() => {
      expect(Number.parseInt(stage().style.width, 10)).toBeGreaterThan(840)
    }, { timeout: 5000 })

    // 기획서는 필요할 때만 꺼낸다.
    fireEvent.click(screen.getByRole('button', { name: '기획서 나란히 보기' }))
    await waitFor(() => {
      expect(container.querySelectorAll('.canvas__sheet .block-card').length).toBe(6)
    }, { timeout: 5000 })

    // 우측은 완성본 도구만 — 생성 전 도구는 이 화면에 없다.
    expect(screen.getByRole('region', { name: 'AI 부분수정' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /이 문구 디자인 주문/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /합성 효과/ })).toBeNull()
  })
})

describe('§16-B 생성 전 블록별 주문은 펴진 채로 있다', () => {
  /**
   * 접어 두었더니 제목 한 줄만 남아, 기획서를 불러온 작업자가 기능이 통째로
   * 사라진 줄 알았다 — "왜 없어진 거야?" 블록을 고르면 접기를 누르지 않고도
   * 적을 칸이 바로 나와야 한다.
   */
  it('문구 블록을 고르면 주문 칸과 참고 그림이 곧바로 나온다', async () => {
    resetFoldsForTests()
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)

    // 순서는 sampleDoc 그대로 — 사진 · 컷아웃 · 문구 셋 · 버튼.
    const cards = container.querySelectorAll<HTMLElement>('.canvas__sheet .block-card')
    fireEvent.pointerDown(cards[2]!, { button: 0 })

    // 접기를 누르지 않았는데도 적을 칸이 있다.
    expect(await screen.findByLabelText('큰 문구 디자인 주문')).toBeTruthy()
    expect(screen.getByRole('button', { name: '참고 그림 추가' })).toBeTruthy()
  })
})

// ── §17 페이지를 오가도 화면이 맞는 것을 가리킨다 ───────────────────────────

describe('§17 페이지 전환', () => {
  it('결과 없는 페이지로 가면 기획서로 돌아오고, 돌아오면 다시 완성본이다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    // 1페이지: 완성본 화면.
    await waitFor(() => {
      // 완성본을 보는 동안에는 중앙 보기 줄이 아예 없다 (기획서 탭 감추기 Patch).
      // 그래서 "완성본으로 넘어갔는가"는 그 화면의 제목으로 묻는다.
      expect(screen.getByRole('heading', { name: '완성본' })).toBeTruthy()
    }, { timeout: 5000 })

    const calls = fetchSpy.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '+ 페이지 추가' }))

    // 2페이지에는 결과가 없다. 완성본을 가리킨 채로 두면 빈 화면만 남으므로
    // 기획서로 돌아온다 — 탭도, 완성본 배율도 이 화면에는 없다.
    await waitFor(() => {
      expect(screen.queryByRole('radio', { name: '완성본' })).toBeNull()
    }, { timeout: 5000 })
    expect(screen.queryByText('아직 생성한 결과가 없습니다.')).toBeNull()
    expect(screen.queryByLabelText('완성본 확대')).toBeNull()
    // 기획서 캔버스가 서 있어야 2페이지 작업을 시작할 수 있다.
    expect(container.querySelector('.canvas__sheet')).not.toBeNull()
    // 생성 전 도구가 우측에 돌아온다.
    expect(screen.getByLabelText('축소')).toBeTruthy()

    // 1페이지로 돌아오면 만들어 둔 결과가 그대로다.
    // 작업 목록에도 같은 이름의 칩이 선다 (작업 목록 Patch). 여기서 누르려는 것은
    // 페이지 탭이므로 그 안에서 찾는다.
    fireEvent.click(
      within(screen.getByRole('group', { name: '기획 페이지' })).getByRole('button', { name: '1페이지' }),
    )
    await waitFor(() => {
      // 완성본을 보는 동안에는 중앙 보기 줄이 아예 없다 (기획서 탭 감추기 Patch).
      // 그래서 "완성본으로 넘어갔는가"는 그 화면의 제목으로 묻는다.
      expect(screen.getByRole('heading', { name: '완성본' })).toBeTruthy()
    }, { timeout: 5000 })
    const job = await loadStudioJob(STUDIO_JOB_ID)
    expect(job?.results?.page_1).toBeDefined()
    expect(job?.textObjects?.page_1?.length).toBe(SHEET_IDS.length)

    // 페이지를 오가는 데 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })
})

// ── §18 파일에 담기지 않는 것을 저장 전에 말한다 ────────────────────────────

describe('§18 저장 전 안내', () => {
  it('완성본이 있으면 담기지 않는다고 알리고, 없으면 알리지 않는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)

    const NOTE = /합쳐진 완성 이미지가 담기지 않습니다/
    // 작업판에서 위 칸의 `저장`은 만든 이미지를 내놓는 일이다. 작업 파일 저장은
    // 돌아올 수 있는 유일한 저장이라 상단 바에 있다.
    const openSave = async () => {
      fireEvent.click(await screen.findByRole('button', { name: '작업 파일 저장' }))
      return await screen.findByRole('dialog', { name: '기획서 파일로 저장' })
    }

    // 아직 만든 것이 없으면 잃을 것도 없다 — 알리지 않는다.
    let dialog = await openSave()
    expect(within(dialog).queryByText(NOTE)).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))

    await generateOnce()

    // 만들어 둔 뒤에는 저장하기 **전에** 말한다.
    dialog = await openSave()
    expect(within(dialog).getByText(NOTE)).toBeTruthy()
  })
})

// ── §19 재료에서 완성본을 되살린다 ─────────────────────────────────────────

describe('§19 다시 합치기', () => {
  it('완성본만 잃은 상태에서 남은 재료로 되살아나고, 외부 호출은 0건이다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const made = await loadStudioJob(STUDIO_JOB_ID)
    const objects = made?.textObjects?.page_1 ?? []
    expect(objects.length).toBe(SHEET_IDS.length)

    // 작업 파일을 열었을 때의 모습: 재료는 남고 **완성본만 없다**.
    await saveStudioJob({ ...made!, results: {} })
    const calls = fetchSpy.mock.calls.length
    composed.mockClear()

    const { container: reopened } = renderStudio()
    await documentReady(reopened)

    // **누르지 않는다.** 재료가 다 있는데 완성본만 없는 자리는 하나뿐이고 —
    // 방금 작업 파일을 연 참이다 — 그때 사람에게 버튼을 누르게 할 이유가 없다.
    // 다시 합치는 일은 외부 호출 0건이라, 누르든 안 누르든 결과가 같다
    // (자동 합치기 Patch).
    await waitFor(async () => {
      const now = await loadStudioJob(STUDIO_JOB_ID)
      expect(now?.results?.page_1).toBeDefined()
    }, { timeout: 5000 })

    const back = await loadStudioJob(STUDIO_JOB_ID)
    const result = back!.results!.page_1!
    // 줄은 처음부터 세운다 — 없는 이력을 지어내지 않는다.
    expect(result.revisions?.length).toBe(1)
    expect(result.cursor).toBe(0)
    expect(result.editCount).toBe(0)
    expect(result.originalAssetId).toBe(result.assetId)
    // 고칠 대상 목록도 함께 선다 — 이것이 없으면 부분수정을 시작할 수 없다.
    expect((result.targets ?? []).length).toBeGreaterThan(0)
    // 조각은 그대로다. 되살리기가 재료를 건드리지 않는다.
    expect(back?.textObjects?.page_1?.length).toBe(SHEET_IDS.length)

    // **공짜다.** 합치기는 브라우저가 했고 밖으로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)
    // 그리고 **한 번만** 합친다. 자동으로 걸리는 길이라, 되풀이하면 화면이 영영
    // `합치는 중…`이고 아무도 그것을 멈추지 못한다.
    expect(composed).toHaveBeenCalledTimes(1)
  })

  it('배경이 없으면 되살릴 재료도 없다 — 그 자리를 내밀지 않는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    expect(screen.queryByRole('button', { name: /완성본 다시 합치기/ })).toBeNull()
  })

  it('합치기가 실패해도 되풀이하지 않는다', async () => {
    // 자동으로 걸리는 길이라 되풀이하면 화면이 영영 `합치는 중…`이고, 아무도
    // 그것을 멈추지 못한다. 실패하면 한 번으로 그치고 버튼을 남긴다.
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()
    const made = await loadStudioJob(STUDIO_JOB_ID)
    await saveStudioJob({ ...made!, results: {} })
    cleanup()

    composed.mockClear()
    composeFails = true
    const { container: reopened } = renderStudio()
    await documentReady(reopened)
    // 한 번 시도하고 멈춘다. 사람이 다시 누를 수 있게 버튼은 남는다.
    await waitFor(() => expect(composed).toHaveBeenCalled(), { timeout: 8000 })
    await waitFor(
      () => expect(screen.getByRole('button', { name: /완성본 다시 합치기/ })).toBeTruthy(),
      { timeout: 8000 },
    )
    const tried = composed.mock.calls.length
    await waitFor(() => expect(composed.mock.calls.length).toBe(tried), { timeout: 1500 })
    expect(tried).toBe(1)
  }, 30000)

  it('되살아난 뒤에는 버튼도 사라진다', async () => {
    // 자동으로 합쳤으므로 누를 것이 없다. 남아 있으면 사람이 "아직 안 됐나" 한다.
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()
    const made = await loadStudioJob(STUDIO_JOB_ID)
    await saveStudioJob({ ...made!, results: {} })
    cleanup()

    const { container: reopened } = renderStudio()
    await documentReady(reopened)
    await waitFor(async () => {
      expect((await loadStudioJob(STUDIO_JOB_ID))?.results?.page_1).toBeDefined()
    }, { timeout: 8000 })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /완성본 다시 합치기/ })).toBeNull()
    }, { timeout: 5000 })
  }, 25000)
})

// ── §20 결과 줄은 값을 치른 것만 담는다 ────────────────────────────────────

describe('§20 결과 줄이 자라지 않는다', () => {
  it('옮기고 톤을 만져도 줄은 한 칸이고, 밀려난 그림은 저장소에서 사라진다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const lineOf = async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      return job!.results!.page_1!
    }
    const first = await lineOf()
    expect(first.revisions?.length).toBe(1)

    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.result-object')
      expect(found.length).toBe(6)
      return found
    }, { timeout: 5000 })

    // 세 번 손본다 — 앞선 판이라면 줄이 넷으로 늘어났을 자리다.
    const title = Array.from(boxes).find((b) => labelOf(b) === '꾸며진 문구 blk_t1')!
    // **직전 값**과 달라지기를 기다린다. 맨 처음 값과 비교하면 두 번째부터는 이미
    // 참이라 기다리지 않고 지나가, 아직 끝나지 않은 합성 위에서 확인하게 된다.
    let seen = first.assetId
    const displaced: string[] = []
    for (const dx of [20, 40, 60]) {
      fireEvent.pointerDown(title, { button: 0, clientX: 10, clientY: 10 })
      fireEvent.pointerMove(window, { clientX: 10 + dx, clientY: 10 })
      fireEvent.pointerUp(window)
      await waitFor(async () => {
        expect((await lineOf()).assetId).not.toBe(seen)
      }, { timeout: 5000 })
      if (seen !== first.assetId) displaced.push(seen)
      seen = (await lineOf()).assetId
    }

    const after = await lineOf()
    // 줄은 그대로 한 칸이다. 값을 치른 것이 하나뿐이니까.
    expect(after.revisions?.length).toBe(1)
    expect(after.cursor).toBe(0)
    // 최초 생성본은 줄에 그대로 남아 있어 언제든 돌아갈 수 있다.
    expect(after.revisions?.[0]?.assetId).toBe(first.assetId)
    expect(after.originalAssetId).toBe(first.assetId)
    // 보고 있는 것은 방금 합친 그림이다.
    expect(after.assetId).not.toBe(first.assetId)

    // 밀려난 합성본은 저장소에서 사라진다. 지우기는 저장 뒤에 이어지므로 기다린다.
    expect(displaced.length).toBe(2)
    await waitFor(async () => {
      const ids = new Set((await getAllAssets()).map((a) => a.id))
      for (const gone of displaced) expect(ids.has(gone)).toBe(false)
    }, { timeout: 5000 })

    // 값을 치른 최초 생성본과 지금 보고 있는 그림은 남아 있다.
    const kept = new Set((await getAllAssets()).map((a) => a.id))
    expect(kept.has(first.assetId)).toBe(true)
    expect(kept.has(after.assetId)).toBe(true)
  })
})

// ── §21 돌아간 오브젝트의 크기 조절 ────────────────────────────────────────

describe('§21 돌아간 상자를 늘린다', () => {
  /** 화면에 실제로 찍히는 모서리 — 가운데를 축으로 돌린 뒤의 자리다. */
  const cornerOnScreen = (r: LayoutRect, sx: number, sy: number, angle: number) => {
    const rad = (angle * Math.PI) / 180
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2
    const ox = (sx * r.width) / 2
    const oy = (sy * r.height) / 2
    return {
      x: cx + ox * Math.cos(rad) - oy * Math.sin(rad),
      y: cy + ox * Math.sin(rad) + oy * Math.cos(rad),
    }
  }

  it('손가락 방향을 상자의 축으로 옮긴다', async () => {
    const { toLocalDelta } = await load('domain/textLayers')
    // 안 돌아간 상자는 화면 방향이 곧 제 방향이다.
    expect(toLocalDelta(10, 4, 0)).toEqual({ dx: 10, dy: 4 })
    // 90도 돌아간 상자에게 "화면의 오른쪽"은 제 축의 아래쪽이다.
    const q = toLocalDelta(10, 0, 90)
    expect(q.dx).toBeCloseTo(0, 6)
    expect(q.dy).toBeCloseTo(-10, 6)
    // 어느 각도든 길이는 변하지 않는다 — 방향만 바꾸는 계산이다.
    const t = toLocalDelta(3, 4, 37)
    expect(Math.hypot(t.dx, t.dy)).toBeCloseTo(5, 6)
  })

  it('잡지 않은 모서리가 화면에서 제자리에 남는다', async () => {
    const { spunResize } = await load('domain/textLayers')
    const from: LayoutRect = { x: 100, y: 200, width: 300, height: 120 }

    for (const angle of [0, 15, 30, -45, 90, 170]) {
      for (const [handle, sx, sy] of [
        ['se', -1, -1],
        ['sw', 1, -1],
        ['ne', -1, 1],
        ['nw', 1, 1],
      ] as const) {
        // 안 돌아간 축에서 계산된 결과 — 잡지 않은 모서리를 그 축에서 묶어 둔
        // 모양이다. 손잡이마다 묶이는 모서리가 달라 자리도 다르다.
        const w = 380
        const h = 170
        const grown: LayoutRect = {
          x: handle === 'se' || handle === 'ne' ? from.x : from.x + from.width - w,
          y: handle === 'se' || handle === 'sw' ? from.y : from.y + from.height - h,
          width: w,
          height: h,
        }
        const fixed = spunResize(from, grown, handle, angle)
        const before = cornerOnScreen(from, sx, sy, angle)
        const after = cornerOnScreen(fixed, sx, sy, angle)
        // 반올림 한 칸 안에서 제자리다.
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1)
        // 크기는 계산된 그대로 지킨다.
        expect(fixed.width).toBe(380)
        expect(fixed.height).toBe(170)
      }
    }
  })

  it('각도가 0이면 지금까지의 자리를 한 칸도 바꾸지 않는다', async () => {
    const { spunResize } = await load('domain/textLayers')
    const from: LayoutRect = { x: 10, y: 20, width: 100, height: 50 }
    const to: LayoutRect = { x: 10, y: 20, width: 140, height: 80 }
    expect(spunResize(from, to, 'se', 0)).toEqual(to)
  })
})

// ── §22 페이지를 복제해도 설정이 따라온다 ───────────────────────────────────

describe('§22 페이지 복제', () => {
  it('컷아웃 설정과 제품 이미지 연결이 사본 페이지로 따라온다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)

    const before = await loadStudioJob(STUDIO_JOB_ID)
    // fixture에서 컷아웃이 켜져 있고 제품 이미지가 연결된 블록.
    expect(before?.effects?.blk_cut?.paperCutout).toBe(true)
    expect(before?.productImages?.blk_cut).toBe('asset_cut')

    fireEvent.click(await screen.findByRole('button', { name: /1페이지 페이지 메뉴/ }))
    fireEvent.click(await screen.findByRole('button', { name: '복제' }))

    // 사본 페이지의 블록은 **새 이름**을 받는다. 그 새 이름으로 설정이 서 있어야 한다.
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      const pages = job?.doc.pages ?? []
      expect(pages.length).toBe(2)
      const copy = pages[1]!
      const cutout = copy.blocks.find((b) => b.label === '컷아웃')!
      expect(cutout.id).not.toBe('blk_cut')
      expect(job?.effects?.[cutout.id]?.paperCutout).toBe(true)
      expect(job?.productImages?.[cutout.id]).toBe('asset_cut')
    }, { timeout: 5000 })

    // 원본 페이지의 설정은 그대로다.
    const after = await loadStudioJob(STUDIO_JOB_ID)
    expect(after?.effects?.blk_cut?.paperCutout).toBe(true)
    expect(after?.productImages?.blk_cut).toBe('asset_cut')
  })
})

