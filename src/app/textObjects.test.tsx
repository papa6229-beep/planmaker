/**
 * 꾸며진 문구를 블록별 오브젝트로 (텍스트 오브젝트 Patch §6).
 *
 * 실물 이미지는 fixture로 넣지 않는다. 픽셀은 손으로 심는다.
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
// 캔버스가 필요한 두 서비스는 규칙을 순수 검사에서 재고, 여기서는 흐름만 본다.
vi.mock('../services/textLayerKey', () => ({
  removeKeyBackground: async (blob: Blob) => ({ blob, opaqueRatio: 0.2 }),
}))
vi.mock('../services/textLayerSplit', () => ({
  sliceTextLayer: async (_blob: Blob, blocks: { blockId: string; rect: unknown; layer: number }[]) =>
    blocks.map((b) => ({
      blockId: b.blockId,
      layer: b.layer,
      rect: b.rect as { x: number; y: number; width: number; height: number },
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

/** 컷아웃 하나와 문구 둘. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('문구 오브젝트 시험'))
  doc.pages[0]!.id = 'page_1'
  doc.activePageId = 'page_1'
  doc.pages[0]!.blocks = [
    createBlock('main_product_image', {
      id: 'blk_cut',
      label: '컷아웃',
      position: { x: 60, y: 600, width: 400, height: 400 },
    }),
    createBlock('free_text', {
      id: 'blk_title',
      label: '큰 문구',
      content: '여름 감사제 40%',
      position: { x: 80, y: 120, width: 600, height: 180 },
    }),
    createBlock('free_text', {
      id: 'blk_note',
      label: '작은 문구',
      content: '선착순 300명',
      position: { x: 80, y: 360, width: 280, height: 60 },
    }),
  ]
  doc.pages[0]!.canvasHeight = 1200
  return doc
}

async function seedJob(extra: Record<string, unknown> = {}) {
  const doc = sampleDoc()
  const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '문구.eventbrief')
  await saveStudioJob({
    ...job,
    productImages: { blk_cut: 'asset_cut' },
    effects: { blk_cut: normalizeEffects({ paperCutout: true }) },
    ...extra,
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
  await waitFor(() => expect(container.querySelectorAll('.canvas__sheet .block-card').length).toBe(3), {
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
    expect((job?.textObjects?.page_1 ?? []).length).toBe(2)
  }, { timeout: 8000 })
}

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
  await putAsset(storedAsset('asset_cut', 1))
})

// ── §1 자르는 규칙 ──────────────────────────────────────────────────────────

describe('§1 한 장을 블록별로 자른다', () => {
  it('덩어리를 쪼개지 않고, 가까운 블록이 가져간다', async () => {
    const { splitTextLayer } = await load('domain/textObjects')

    // 40×20. 왼쪽에 글자 덩어리(그림자가 아래로 삐져나옴), 오른쪽에 다른 글자.
    const width = 40
    const height = 20
    const data = new Uint8ClampedArray(width * height * 4)
    const put = (x: number, y: number) => {
      data[(y * width + x) * 4 + 3] = 255
    }
    // 왼쪽 덩어리: 2..9 × 4..8, 그리고 아래로 이어진 그림자 한 줄 (9행).
    for (let y = 4; y <= 8; y += 1) for (let x = 2; x <= 9; x += 1) put(x, y)
    for (let x = 3; x <= 8; x += 1) put(x, 9)
    // 오른쪽 덩어리: 28..35 × 4..8
    for (let y = 4; y <= 8; y += 1) for (let x = 28; x <= 35; x += 1) put(x, y)

    const { owner, slices } = splitTextLayer(
      { data, width, height },
      [
        { blockId: 'left', rect: { x: 0, y: 0, width: 12, height: 10 }, layer: 0 },
        { blockId: 'right', rect: { x: 26, y: 0, width: 12, height: 10 }, layer: 1 },
      ],
      { x: 1, y: 1 },
    )

    expect(slices.map((s: { blockId: string }) => s.blockId)).toEqual(['left', 'right'])
    const left = slices.find((s: { blockId: string }) => s.blockId === 'left')!
    // 그림자까지 품는다 — 사각형으로 자르지 않았다는 뜻이다.
    expect(left.box).toEqual({ x: 2, y: 4, width: 8, height: 6 })
    const right = slices.find((s: { blockId: string }) => s.blockId === 'right')!
    expect(right.box).toEqual({ x: 28, y: 4, width: 8, height: 5 })
    // 임자가 갈린다 — 옆 문구의 픽셀은 딸려 오지 않는다.
    expect(owner[6 * width + 5]).toBe(0)
    expect(owner[6 * width + 30]).toBe(1)
    // 빈 자리는 누구의 것도 아니다.
    expect(owner[0]).toBe(-1)
  })
})

// ── §1 생성 뒤 오브젝트로 남는다 ────────────────────────────────────────────

describe('§1 생성 결과가 블록별 오브젝트로 남는다', () => {
  it('문구 두 개가 각자의 자산과 자리를 갖는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const job = await loadStudioJob(STUDIO_JOB_ID)
    const objects = job?.textObjects?.page_1 ?? []
    expect(objects.map((o) => o.blockId).sort()).toEqual(['blk_note', 'blk_title'])
    // 처음 자리는 기획서 블록의 자리다.
    const title = objects.find((o) => o.blockId === 'blk_title')!
    expect(title.rect).toEqual({ x: 80, y: 120, width: 600, height: 180 })
    // 저마다 다른 그림이다.
    expect(new Set(objects.map((o) => o.assetId)).size).toBe(2)
    // 문구 생성 호출은 페이지당 한 번뿐이다 (배경 1 + 문구 1).
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

// ── §2 옮기기·크기 변경 ─────────────────────────────────────────────────────

describe('§2 문구를 골라 옮기고 크기를 바꾼다', () => {
  it('두 오브젝트를 각각 고를 수 있고, 하나를 옮겨도 나머지는 그대로다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const before = await loadStudioJob(STUDIO_JOB_ID)
    const beforeNote = before?.textObjects?.page_1?.find((o) => o.blockId === 'blk_note')!.rect
    const calls = fetchSpy.mock.calls.length

    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.text-object')
      expect(found.length).toBe(2)
      return found
    }, { timeout: 5000 })

    // 첫 번째를 고른다.
    fireEvent.pointerDown(boxes[0]!, { button: 0, clientX: 100, clientY: 100 })
    await waitFor(() => expect(boxes[0]!.getAttribute('aria-pressed')).toBe('true'))
    expect(boxes[1]!.getAttribute('aria-pressed')).toBe('false')

    // 끌어 옮긴다.
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 })
    fireEvent.pointerUp(window)

    const after = await loadStudioJob(STUDIO_JOB_ID)
    const list = after?.textObjects?.page_1 ?? []
    const movedId = boxes[0]!.getAttribute('aria-label')!.replace('꾸며진 문구 ', '')
    const moved = list.find((o) => o.blockId === movedId)!
    const stillNote = list.find((o) => o.blockId === 'blk_note')!.rect

    // 옮긴 것만 자리가 달라진다.
    if (movedId !== 'blk_note') expect(stillNote).toEqual(beforeNote)
    expect(moved.rect.x !== 80 || moved.rect.y !== 120 || movedId === 'blk_note').toBe(true)

    // 이미지 블록의 좌표는 그대로다.
    const page = after?.doc.pages.find((p) => p.id === 'page_1')
    expect(page?.blocks.find((b) => b.id === 'blk_cut')?.position).toEqual({
      x: 60, y: 600, width: 400, height: 400,
    })
    // 옮기는 동안 외부로 나간 요청은 없다.
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })

  it('두 번째 오브젝트를 고르면 첫 번째 선택이 풀린다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.text-object')
      expect(found.length).toBe(2)
      return found
    }, { timeout: 5000 })

    fireEvent.pointerDown(boxes[0]!, { button: 0, clientX: 10, clientY: 10 })
    await waitFor(() => expect(boxes[0]!.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.pointerUp(window)

    fireEvent.pointerDown(boxes[1]!, { button: 0, clientX: 20, clientY: 20 })
    await waitFor(() => expect(boxes[1]!.getAttribute('aria-pressed')).toBe('true'))
    expect(boxes[0]!.getAttribute('aria-pressed')).toBe('false')
    fireEvent.pointerUp(window)
  })
})

// ── §4 합성 순서와 지금 자리 ────────────────────────────────────────────────

describe('§4 배경 → 이미지·컷아웃 → 문구', () => {
  it('합성 계획이 문구를 지금 자리로 맨 앞에 싣는다', async () => {
    const { planLocalComposite } = await load('domain/composite')
    const doc = sampleDoc()
    const plan = planLocalComposite({
      page: doc.pages[0]!,
      background: { assetId: 'asset_plate', source: 'ai' },
      textObjects: [{ assetId: 'asset_text', rect: { x: 12, y: 34, width: 56, height: 78 } }],
      productImages: { blk_cut: 'asset_cut' },
      effects: {},
      onlyBlockIds: ['blk_cut'],
      includeTexts: false,
    })
    expect(plan.background?.assetId).toBe('asset_plate')
    expect(plan.layers.map((l: { blockId: string }) => l.blockId)).toEqual(['blk_cut'])
    // 기획서 문구는 다시 그리지 않는다 — 꾸며진 그림이 대신한다.
    expect(plan.texts).toEqual([])
    expect(plan.textObjects).toEqual([{ assetId: 'asset_text', rect: { x: 12, y: 34, width: 56, height: 78 } }])
    // 자산 목록에도 든다 — 빠지면 합성이 그림을 찾지 못한다.
    const { compositeAssetIds } = await load('domain/composite')
    expect(compositeAssetIds(plan)).toContain('asset_text')
    expect(plan.externalCalls).toBe(0)
  })

  it('옮긴 뒤 다시 합칠 때 바뀐 자리가 계획에 실린다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    const boxes = await waitFor(() => {
      const found = container.querySelectorAll<HTMLElement>('.text-object')
      expect(found.length).toBe(2)
      return found
    }, { timeout: 5000 })

    composed.mockClear()
    fireEvent.pointerDown(boxes[0]!, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 40 })
    fireEvent.pointerUp(window)

    await waitFor(() => expect(composed).toHaveBeenCalled(), { timeout: 5000 })
    const plan = composed.mock.calls.at(-1)![0] as {
      textObjects?: { rect: { x: number; y: number } }[]
    }
    const job = await loadStudioJob(STUDIO_JOB_ID)
    const saved = job?.textObjects?.page_1 ?? []
    expect(plan.textObjects?.map((t) => t.rect)).toEqual(saved.map((o) => o.rect))
  })
})

// ── 저장 파일 왕복 ──────────────────────────────────────────────────────────

describe('작업 파일이 문구 오브젝트를 지킨다', () => {
  it('담기고, 자산 재번호를 따라가며, 예전 파일은 빈 값으로 읽힌다', async () => {
    const mod = await load('domain/studioFile')
    const doc = sampleDoc()
    const base = createStudioJob(doc, 1_000, STUDIO_JOB_ID)
    const job = {
      ...base,
      textObjects: {
        page_1: [{ blockId: 'blk_title', assetId: 'asset_text', rect: { x: 1, y: 2, width: 3, height: 4 }, layer: 0 }],
      },
    }

    const state = mod.toStudioFileState(job)
    expect(mod.studioFileAssetIds(state)).toContain('asset_text')

    const remapped = mod.remapStudioFileState(state, new Map([['asset_text', 'asset_text_2']]))
    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(remapped)))
    expect(parsed?.textObjects?.page_1?.[0]?.assetId).toBe('asset_text_2')
    expect(parsed?.textObjects?.page_1?.[0]?.rect).toEqual({ x: 1, y: 2, width: 3, height: 4 })

    const old = mod.parseStudioFileState({ version: '0.5.0', source: null, productImages: {} })
    expect(old?.textObjects ?? {}).toEqual({})
  })
})
