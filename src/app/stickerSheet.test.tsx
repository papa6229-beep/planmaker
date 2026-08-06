/**
 * 배경을 먼저 완성하고 블록별 문구·버튼을 독립 생성 (스티커판 Patch §최소 확인).
 *
 * fixture는 서로 가까이 붙은 문구 셋과 버튼 하나, 그리고 일반 이미지 하나와 종이
 * 컷아웃 하나다. 실물 이미지는 넣지 않는다 — 픽셀이 필요한 자리는 손으로 심는다.
 *
 * 여기서 묻는 것은 하나다. **자를 자리가 요청보다 먼저 정해져 있는가.** 먼저
 * 정해져 있으면 픽셀 모양을 볼 일이 없고, 합쳐지거나 쪼개질 일도 없다.
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

/** 칸마다 완충 띠에 얼마나 묻었다고 할 것인가 — 침범을 흉내 내는 손잡이다. */
const ink = vi.hoisted(() => ({ ratios: {} as Record<number, number> }))

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
// 캔버스가 필요한 두 서비스. 자를 좌표의 규칙은 §4 순수 검사에서 숫자로 재고,
// 여기서는 그 좌표가 흐름을 타고 그대로 도착하는지만 본다.
vi.mock('../services/stickerSheetSlice', () => ({
  sliceStickerSheet: async (_blob: Blob, cells: { blockId: string; index: number }[]) => ({
    pieces: cells.map((c) => ({
      blockId: c.blockId,
      index: c.index,
      blob: new Blob([new Uint8Array([7, 7])], { type: 'image/png' }),
    })),
    inks: cells.map((c) => ({
      index: c.index,
      blockId: c.blockId,
      guardRatio: ink.ratios[c.index] ?? 0,
    })),
  }),
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
const SHEET_IDS = ['blk_t1', 'blk_t2', 'blk_t3', 'blk_btn']
const IMAGE_IDS = ['blk_photo', 'blk_cut']

/** 일반 이미지 1 · 컷아웃 1 · 가까이 붙은 문구 3 · 버튼 1. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('스티커판 시험'))
  doc.pages[0]!.id = 'page_1'
  doc.activePageId = 'page_1'
  doc.pages[0]!.blocks = [
    createBlock('sub_product_image', { id: 'blk_photo', label: '일반 이미지', position: { ...PHOTO_RECT } }),
    createBlock('main_product_image', { id: 'blk_cut', label: '컷아웃', position: { ...CUT_RECT } }),
    // 아래 셋은 서로 맞닿거나 겹친다 — 픽셀로 가르면 반드시 섞이는 배치다.
    createBlock('free_text', { id: 'blk_t1', label: '큰 문구', content: '여름 감사제 40%', position: { ...TEXT_RECTS.blk_t1! } }),
    createBlock('free_text', { id: 'blk_t2', label: '가까운 문구', content: '전 품목 균일가', position: { ...TEXT_RECTS.blk_t2! } }),
    createBlock('free_text', { id: 'blk_t3', label: '겹치는 문구', content: '선착순 300명', position: { ...TEXT_RECTS.blk_t3! } }),
    createBlock('cta_button', { id: 'blk_btn', label: '버튼', content: '지금 신청하기', position: { ...TEXT_RECTS.blk_btn! } }),
  ]
  doc.pages[0]!.canvasHeight = 1200
  return doc
}

async function seedJob() {
  const doc = sampleDoc()
  const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '스티커판.eventbrief')
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

/** 한 번 누르고, 나간 요청 두 건이 끝날 때까지 기다린다. */
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
    expect(job?.results?.page_1).toBeDefined()
  }, { timeout: 8000 })
}

const labelOf = (el: HTMLElement) => el.getAttribute('aria-label') ?? ''

beforeEach(async () => {
  ink.ratios = {}
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

// ── §4 칸 나누기 ────────────────────────────────────────────────────────────

describe('§4 자를 자리는 요청보다 먼저 정해진다', () => {
  it('블록 수만큼의 칸이 겹치지 않게 생기고, 잘라 낼 상자는 블록과 같은 비율이다', async () => {
    const { planStickerCells, STICKER_GUARD } = await load('domain/stickerSheet')
    const sheet = { width: 832, height: 1184 }
    const blocks = SHEET_IDS.map((blockId, i) => ({
      blockId,
      content: blockId,
      kind: blockId === 'blk_btn' ? ('button' as const) : ('text' as const),
      rect: TEXT_RECTS[blockId]!,
      align: 'center' as const,
      layer: i,
      overlapsImage: false,
    }))

    const cells = planStickerCells(blocks, sheet)
    // 칸 수 = 블록 수. 칸 번호와 blockId가 1:1로 묶인다.
    expect(cells.map((c: { blockId: string }) => c.blockId)).toEqual(SHEET_IDS)
    expect(cells.map((c: { index: number }) => c.index)).toEqual([1, 2, 3, 4])

    for (const [i, cell] of cells.entries()) {
      // 칸은 판을 넷으로 나눈 가로줄이다.
      expect(cell.cell).toEqual({ x: 0, y: i * 0.25, width: 1, height: 0.25 })

      // 잘라 낼 상자는 그 블록과 같은 가로세로비다 — 원래 자리에 그대로 앉혀도
      // 글자가 눌리거나 늘어나지 않는다.
      const block = blocks[i]!
      const cropAspect = (cell.crop.width * sheet.width) / (cell.crop.height * sheet.height)
      expect(cropAspect).toBeCloseTo(block.rect.width / block.rect.height, 3)

      // 상자는 칸 안에 있고, 가장자리에 완충 띠가 남는다.
      expect(cell.crop.x).toBeGreaterThanOrEqual(cell.cell.x)
      expect(cell.crop.y).toBeGreaterThanOrEqual(cell.cell.y)
      expect(cell.crop.x + cell.crop.width).toBeLessThanOrEqual(cell.cell.x + cell.cell.width + 1e-9)
      expect(cell.crop.y + cell.crop.height).toBeLessThanOrEqual(cell.cell.y + cell.cell.height + 1e-9)
      const guardTop = (cell.crop.y - cell.cell.y) * sheet.height
      expect(guardTop).toBeGreaterThanOrEqual(STICKER_GUARD * (sheet.height / 4) - 1e-6)
    }

    // 칸끼리 겹치지 않는다.
    for (let a = 0; a < cells.length; a += 1) {
      for (let b = a + 1; b < cells.length; b += 1) {
        const x = cells[a]!.crop
        const y = cells[b]!.crop
        const overlaps = x.x < y.x + y.width && y.x < x.x + x.width && x.y < y.y + y.height && y.y < x.y + x.height
        expect(overlaps).toBe(false)
      }
    }
  })

  it('완충 띠에 잉크가 묻은 칸만 침범으로 센다', async () => {
    const { spilledCells, STICKER_SPILL_LIMIT } = await load('domain/stickerSheet')
    const inks = [
      { index: 1, blockId: 'blk_t1', guardRatio: 0 },
      { index: 2, blockId: 'blk_t2', guardRatio: STICKER_SPILL_LIMIT },
      { index: 3, blockId: 'blk_t3', guardRatio: STICKER_SPILL_LIMIT + 0.05 },
    ]
    expect(spilledCells(inks).map((s: { index: number }) => s.index)).toEqual([3])
  })
})

// ── §5 blockId로 바로 배치 ──────────────────────────────────────────────────

describe('§5 문구 셋과 버튼 하나가 각각 독립 오브젝트로 남는다', () => {
  it('오브젝트는 정확히 넷이고, 자리는 기획서 원래 자리다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const job = await loadStudioJob(STUDIO_JOB_ID)
    const texts = job?.textObjects?.page_1 ?? []

    // 넷. 합쳐지지도, 쪼개지지도 않았다.
    expect(texts).toHaveLength(4)
    expect(texts.map((o) => o.blockId)).toEqual(SHEET_IDS)
    // 저마다 다른 그림이고, 자리는 기획서 원래 자리다.
    expect(new Set(texts.map((o) => o.assetId)).size).toBe(4)
    for (const object of texts) expect(object.rect).toEqual(TEXT_RECTS[object.blockId])

    // 이미지·컷아웃은 생성 전 좌표 그대로다.
    const images = job?.imageObjects?.page_1 ?? []
    expect(images.map((o) => o.blockId)).toEqual(IMAGE_IDS)
    expect(images.find((o) => o.blockId === 'blk_photo')?.rect).toEqual(PHOTO_RECT)
    expect(images.find((o) => o.blockId === 'blk_cut')?.rect).toEqual(CUT_RECT)
    const page = job?.doc.pages.find((p) => p.id === 'page_1')
    expect(page?.blocks.find((b) => b.id === 'blk_photo')?.position).toEqual(PHOTO_RECT)
    expect(page?.blocks.find((b) => b.id === 'blk_cut')?.position).toEqual(CUT_RECT)

    // 외부 호출은 정확히 두 번. 스스로 다시 부른 자리가 없다.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('두 번째 요청에는 실제로 생성된 배경과 칸별 주문이 실린다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const bodies = fetchSpy.mock.calls.map((c) => c[1].body as FormData)
    const names = (form: FormData) =>
      form.getAll('images[]').filter((v): v is File => typeof v !== 'string').map((f) => f.name)
    const prompt = (form: FormData) => String(form.get('prompt'))

    // ① 배경 요청 — 붙는 것은 스타일 레퍼런스뿐(여기서는 없음)이고, 문구는 없다.
    expect(names(bodies[0]!)).toEqual([])
    expect(prompt(bodies[0]!)).toContain('배경 레이어')
    expect(prompt(bodies[0]!)).not.toContain('여름 감사제 40%')

    // ② 스티커판 요청 — 1단계에서 만들어진 배경 한 장만 붙는다. 사용자 이미지는
    //    어느 쪽에도 실리지 않고, 합성 페이지도 실리지 않는다.
    expect(names(bodies[1]!)).toEqual(['1-background-plate.png'])
    const sheet = prompt(bodies[1]!)
    for (const banned of ['asset_photo', 'asset_cut', 'photo', 'cut', 'data:', 'base64']) {
      expect(sheet).not.toContain(banned)
    }
    // 칸 넷과 원문 넷, 그리고 버튼 지시.
    for (const i of [1, 2, 3, 4]) expect(sheet).toContain(`cell ${String(i)}`)
    for (const text of ['여름 감사제 40%', '전 품목 균일가', '선착순 300명', '지금 신청하기']) {
      expect(sheet).toContain(text)
    }
    expect(sheet).toContain('버튼 — "지금 신청하기"')
    expect(sheet).toContain('배경판·테두리·글자를 한 덩어리로')
    // 자리별 색은 숫자로만 간다 (§3).
    expect(sheet).toContain('R120')
    expect(sheet).toContain('대비 0.30')
  })

  it('넷을 각각 고르고, 하나를 옮기거나 늘려도 나머지 셋은 그대로다', async () => {
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

    // 넷을 하나씩 고를 수 있고, 한 번에 하나만 골라진다.
    const sheetBoxes = Array.from(boxes).filter((b) => labelOf(b).startsWith('꾸며진 문구'))
    expect(sheetBoxes.map(labelOf)).toEqual(SHEET_IDS.map((id) => `꾸며진 문구 ${id}`))
    for (const box of sheetBoxes) {
      fireEvent.pointerDown(box, { button: 0, clientX: 5, clientY: 5 })
      await waitFor(() => expect(box.getAttribute('aria-pressed')).toBe('true'))
      expect(Array.from(boxes).filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
      fireEvent.pointerUp(window)
    }

    // ① 버튼을 끌어 옮긴다.
    const buttonBox = sheetBoxes.at(-1)!
    fireEvent.pointerDown(buttonBox, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 30, clientY: -40 })
    fireEvent.pointerUp(window)
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.textObjects?.page_1?.find((o) => o.blockId === 'blk_btn')?.rect).toEqual({
        ...TEXT_RECTS.blk_btn!,
        x: TEXT_RECTS.blk_btn!.x + 30,
        y: TEXT_RECTS.blk_btn!.y - 40,
      })
    }, { timeout: 5000 })

    // ② 가운데 문구를 모서리로 늘린다.
    const middle = sheetBoxes[1]!
    fireEvent.pointerDown(middle, { button: 0, clientX: 0, clientY: 0 })
    await waitFor(() => expect(middle.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.pointerUp(window)
    const handle = await waitFor(() => {
      // eslint-disable-next-line testing-library/no-node-access
      const found = middle.querySelector<HTMLElement>('.result-object__handle--se')
      expect(found).not.toBeNull()
      return found!
    })
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 20 })
    fireEvent.pointerUp(window)
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      const t2 = job?.textObjects?.page_1?.find((o) => o.blockId === 'blk_t2')
      expect(t2?.rect.width).toBe(TEXT_RECTS.blk_t2!.width + 60)
      expect(t2?.rect.height).toBe(TEXT_RECTS.blk_t2!.height + 20)
    }, { timeout: 5000 })

    // 손대지 않은 둘은 처음 값 그대로다.
    const job = await loadStudioJob(STUDIO_JOB_ID)
    for (const id of ['blk_t1', 'blk_t3']) {
      expect(job?.textObjects?.page_1?.find((o) => o.blockId === id)?.rect).toEqual(TEXT_RECTS[id])
    }
    // 이미지·컷아웃도 그대로다.
    expect(job?.imageObjects?.page_1?.find((o) => o.blockId === 'blk_cut')?.rect).toEqual(CUT_RECT)
    // 옮기고 늘리는 내내 외부로 나간 요청은 없다.
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
    // 문구·버튼은 맨 앞 한 겹이고, 기획서 문구를 다시 그리지 않는다.
    expect(plan.textObjects?.map((t) => t.rect)).toEqual(SHEET_IDS.map((id) => TEXT_RECTS[id]))
    expect(plan.texts).toEqual([])
    expect(plan.externalCalls).toBe(0)
  })
})

// ── 실패 처리 ───────────────────────────────────────────────────────────────

describe('칸을 넘으면 얹지 않고 어느 칸인지만 말한다', () => {
  it('침범한 칸을 이름으로 알리고, 다시 부르지 않는다', async () => {
    // cell 2가 자기 자리를 넘었다고 해 둔다.
    ink.ratios = { 2: 0.4 }
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const message = await screen.findByText(/지정된 칸을 넘었습니다/)
    expect(message.textContent).toContain('cell 2(blk_t2)')

    const job = await loadStudioJob(STUDIO_JOB_ID)
    // 문구는 하나도 얹지 않았다 — 픽셀을 보고 다시 나누지 않는다.
    expect(job?.textObjects?.page_1 ?? []).toEqual([])
    // 값을 치른 배경과 이미지까지는 남는다.
    expect(job?.backgrounds?.page_1).toBeDefined()
    expect(job?.imageObjects?.page_1?.map((o) => o.blockId)).toEqual(IMAGE_IDS)
    // 자동 재시도 0회 — 나간 요청은 여전히 두 번뿐이다.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
