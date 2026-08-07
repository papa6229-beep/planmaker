/**
 * 한방 완성 이미지 생성 + 종이 테두리 두께 집중검사.
 *
 * 구현 **전에** 실패로 고정한다. 새 모듈은 검사 안에서 부르므로, 없는 모듈이
 * 파일 전체를 무너뜨리지 않고 몇 항목이 빨간지 세어진다.
 *
 * 실물 이미지는 fixture로 넣지 않는다. 자산은 손으로 만든 바이트다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'
import { clearAll, getAsset, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
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
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>(
    '../features/assets/imageUtils',
  )
  return { ...actual, readImageSize: async () => ({ width: 800, height: 800 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }),
}))
// jsdom에는 2D 캔버스가 없다. 그리는 일은 브라우저에서 보고, 여기서는 **무엇을
// 보내고 무엇을 남기는가**를 본다.
vi.mock('../services/photoContent', () => ({
  PHOTO_MEASURE_MAX_SIDE: 256,
  measurePhoto: async () => ({ natural: { width: 800, height: 800 }, box: { x: 0, y: 0, width: 1, height: 1 } }),
}))
vi.mock('../services/paperCutoutShape', () => ({
  buildPaperShape: async () => ({ url: 'data:image/png;base64,AA', pad: 6, content: { width: 100, height: 100 } }),
  buildPaperCanvas: async () => null,
}))
// 분석은 캔버스에서 픽셀을 읽는 일이다. jsdom에서는 그림이 아예 디코딩되지
// 않아 `Image`가 load도 error도 내지 않으므로, 진짜 함수를 부르면 영영 기다린다.
vi.mock('../services/imageAnalysisRunner', () => ({
  ANALYSIS_MAX_SIDE: 256,
  analyzeImageBlob: async () => null,
}))
vi.mock('../services/compositeRenderer', () => ({
  renderComposite: async () => new Blob([new Uint8Array([5, 5, 5, 5, 5])], { type: 'image/png' }),
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

vi.mock('../services/textLayerKey', () => ({
  removeKeyBackground: async (blob: Blob) => ({ blob, opaqueRatio: 0.2 }),
}))
// 여백을 잘라 내는 일은 캔버스의 몫이다. 규칙은 순수 검사에서 재고, 여기서는
// 흐름만 본다. 돌려주는 크기는 블록 상자와 같은 비율로 둔다.
vi.mock('../services/trimToContent', () => ({
  trimToContent: async (blob: Blob) => ({ blob, width: 400, height: 100 }),
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

/** 컷아웃 후보 하나, 일반 이미지 하나, 문구 하나. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('한방 생성 시험'))
  doc.pages[0]!.id = 'page_1'
  doc.activePageId = 'page_1'
  doc.pages[0]!.blocks = [
    createBlock('main_product_image', {
      id: 'blk_cut',
      label: '컷아웃 제품',
      position: { x: 100, y: 500, width: 400, height: 400 },
    }),
    createBlock('sub_product_image', {
      id: 'blk_plain',
      label: '일반 이미지',
      position: { x: 540, y: 500, width: 240, height: 240 },
    }),
    createBlock('free_text', {
      id: 'blk_text',
      label: '문구',
      content: '여름 감사제 40% + 사은품',
      position: { x: 120, y: 180, width: 500, height: 140 },
    }),
  ]
  doc.pages[0]!.canvasHeight = 1000
  return doc
}

async function seedJob(extra: Record<string, unknown> = {}) {
  const doc = sampleDoc()
  const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '한방.eventbrief')
  await saveStudioJob({
    ...job,
    productImages: { blk_cut: 'asset_cut', blk_plain: 'asset_plain' },
    styleRefs: { page_1: 'asset_style' },
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

/** 상단 버튼 한 번 → 확인창 실행. 응답은 stub이라 실제 결제는 없다. */
async function generateOnce(): Promise<FormData> {
  sessionStorage.setItem('planmaker.openai-key', 'sk-stub')
  fetchSpy.mockResolvedValue(
    new Response(
      JSON.stringify({ image: { b64: btoa('plate-bytes'), mimeType: 'image/png' }, metadata: { requestedSize: '832x992' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
  fireEvent.click(await screen.findByRole('button', { name: /이미지 생성하기|다시 생성/ }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: /생성 시작|만들기|시작/ }))
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
  return fetchSpy.mock.calls[0]![1].body as FormData
}

const fileNames = (form: FormData) =>
  form.getAll('images[]').filter((v): v is File => typeof v !== 'string').map((f) => f.name)

beforeEach(async () => {
  fetchSpy.mockReset()
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
  await putAsset(storedAsset('asset_plain', 2))
  await putAsset(storedAsset('asset_style', 3))
})

// ── 1. 메인 흐름은 상단 버튼 하나 ────────────────────────────────────────────

describe('§1 상단 버튼 하나가 메인 실행이다', () => {
  it('두 단계 버튼과 생성 방식 카드는 화면에 없다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)

    expect(await screen.findByRole('button', { name: /이미지 생성하기/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'AI로 배경 생성' })).toBeNull()
    expect(screen.queryByRole('button', { name: '원본 합성으로 저장' })).toBeNull()
    expect(screen.queryByRole('region', { name: '생성 방식' })).toBeNull()
  })
})

// ── 2. 무엇을 보내고 무엇을 보내지 않는가 ────────────────────────────────────

describe('§2 컷아웃이 없으면 기존 전체 AI 흐름', () => {
  it('배치도와 제품 원본을 지금까지처럼 보낸다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    const form = await generateOnce()

    const names = fileNames(form)
    expect(names.some((n) => n.includes('page-layout'))).toBe(true)
    expect(names.some((n) => n.includes('product_image'))).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('§2 컷아웃이 있으면 원본 보존 완성 디자인', () => {
  it('사용자 이미지는 한 장도 보내지 않고, 스타일 레퍼런스만 보낸다', async () => {
    await seedJob({ effects: { blk_cut: { paperCutout: true } } })
    const { container } = renderStudio()
    await documentReady(container)
    const form = await generateOnce()

    const names = fileNames(form)
    // 배치도에는 사용자의 그림이 그려져 있다 — 그래서 이 흐름에서는 아예 보내지
    // 않는다. 일반 이미지도 더는 보내지 않는다: 보내면 모델이 그것을 다시 그리고,
    // 그 순간 좌표·크기 계약이 깨진다 (한방 생성 Patch 2 §1).
    expect(names).toEqual(['1-style-reference.png'])
    for (const banned of ['page-layout', 'cut', 'plain']) {
      expect(names.some((n) => n.includes(banned))).toBe(false)
    }
  })

  it('보낼 수 있는 자산 목록에 사용자 이미지가 들어갈 길이 없다', async () => {
    const { preserveAttachmentIds } = await load('domain/preserveDesign')
    // 인자가 스타일 레퍼런스 하나뿐이라, 컷아웃도 제품도 낄 자리가 없다.
    expect(preserveAttachmentIds('asset_style')).toEqual(['asset_style'])
    expect(preserveAttachmentIds(undefined)).toEqual([])
  })
})

// ── 3. 프롬프트가 말하는 것 ──────────────────────────────────────────────────

describe('§3 두 겹의 주문', () => {
  it('배경 주문에는 문구가 없고, 문구 주문에는 원문이 그대로 있다', async () => {
    const { buildPlatePrompt, buildTextLayerPrompt } = await load('domain/preserveDesign')
    const size = { width: 840, height: 1000 }
    const fixed = [
      { blockId: 'blk_cut', assetId: 'asset_cut', rect: { x: 100, y: 500, width: 400, height: 400 }, layer: 0, cutout: true },
      { blockId: 'blk_plain', assetId: 'asset_plain', rect: { x: 540, y: 500, width: 240, height: 240 }, layer: 1, cutout: false },
    ]
    const block = {
      blockId: 'blk_text',
      content: '여름 감사제 40% + 사은품',
      kind: 'text' as const,
      rect: { x: 120, y: 180, width: 500, height: 140 },
      align: 'center' as const,
      layer: 2,
      overlapsImage: false,
      lines: ['여름 감사제 40% + 사은품'],
    }

    const plate = buildPlatePrompt({ size, styleReferenceAssetId: 'asset_style', fixed, note: '가을 느낌으로' })
    expect(plate).not.toContain('여름 감사제 40% + 사은품')
    expect(plate).toContain('비워 둘 자리')
    expect(plate).toContain('복제하지 않습니다')
    expect(plate).toContain('가을 느낌으로')

    const text = buildTextLayerPrompt({
      size,
      styleReferenceAssetId: 'asset_style',
      backgroundAssetId: 'asset_plate',
      block,
      siblings: [block],
      fixed,
    })
    expect(text).toContain('여름 감사제 40% + 사은품')
    expect(text).toContain('문자·숫자·띄어쓰기·기호·줄바꿈')
    expect(text).toContain('복제하지 않습니다')
    expect(text).toContain('사람, 제품, 로고')
    // 자리를 지키라고 시키지 않는다 — 자리는 이 도구가 잡는다.
    // 줄 나눔은 기획서가 정한 그대로 못 박는다.
    expect(text).toContain('정확히 1줄입니다')
    expect(text).toContain('1행: "여름 감사제 40% + 사은품"')
    expect(text).toContain('글자를 기울이지 마세요')

    // 어느 쪽도 자산 번호나 파일명을 싣지 않는다.
    for (const prompt of [plate, text]) {
      expect(prompt).not.toContain('asset_cut')
      expect(prompt).not.toContain('asset_plate')
      expect(prompt).not.toContain('.png')
    }
  })
})

// ── 4. 결과: 컷아웃은 브라우저가 얹는다 ──────────────────────────────────────

describe('§4 최종 합성', () => {
  it('AI 배경 위에 이미지 전부를 얹고 문구는 다시 그리지 않는다', async () => {
    const { planLocalComposite } = await load('domain/composite')
    const doc = sampleDoc()
    const plan = planLocalComposite({
      page: doc.pages[0]!,
      background: { assetId: 'asset_plate', source: 'ai' },
      productImages: { blk_cut: 'asset_cut', blk_plain: 'asset_plain' },
      effects: { blk_cut: { paperCutout: true } },
      onlyBlockIds: ['blk_cut', 'blk_plain'],
      includeTexts: false,
    })
    expect(plan.background?.assetId).toBe('asset_plate')
    expect(plan.layers.map((l: { blockId: string }) => l.blockId)).toEqual(['blk_cut', 'blk_plain'])
    expect(plan.layers[0]!.rect).toEqual({ x: 100, y: 500, width: 400, height: 400 })
    expect(plan.layers[0]!.effects.paperCutout).toBe(true)
    // 문구는 AI가 이미 그렸다 — 두 번 그리지 않는다.
    expect(plan.texts).toEqual([])
    expect(plan.externalCalls).toBe(0)
  })

  it('생성이 끝나면 합성한 결과가 이 페이지의 결과로 남고 원본은 그대로다', async () => {
    await seedJob({ effects: { blk_cut: { paperCutout: true } } })
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.results?.page_1?.assetId).toBeTruthy()
    }, { timeout: 8000 })

    // 컷아웃 원본 바이트는 손대지 않는다.
    const cut = await getAsset('asset_cut')
    expect(cut?.byteSize).toBe(5)
    expect(cut?.fileName).toBe('asset_cut.png')
  })
})

// ── 5. 종이 테두리 두께·진하기 ───────────────────────────────────────────────

describe('§5 종이 테두리 두께와 진하기', () => {
  it('두께는 배율이고, 예전 세 단계는 그때 뜻하던 값으로 읽힌다', async () => {
    const { paperPad, paperWeightOf, paperOpacityOf, DEFAULT_PAPER_WEIGHT, PAPER_WEIGHT_MIN, PAPER_WEIGHT_MAX } =
      await load('domain/paperCutout')
    const box = { width: 400, height: 400 }

    // 기본은 지금까지의 `보통`이다 — 예전 작업을 열어도 결과가 달라지지 않는다.
    expect(DEFAULT_PAPER_WEIGHT).toBe(1)
    expect(paperWeightOf('normal')).toBe(1)
    expect(paperWeightOf('thin')).toBe(0.6)
    expect(paperWeightOf('thick')).toBe(1.7)
    expect(paperWeightOf(undefined)).toBe(1)

    // 예전 `얇게`보다 더 얇게 갈 수 있다 — 이 Patch가 연 자리다.
    expect(PAPER_WEIGHT_MIN).toBeLessThan(0.6)
    expect(paperPad(box, PAPER_WEIGHT_MIN)).toBeLessThan(paperPad(box, 0.6))
    expect(paperPad(box, 0.6)).toBeLessThan(paperPad(box, 1))
    expect(paperPad(box, 1)).toBeLessThan(paperPad(box, 1.7))
    // 범위 밖은 경계로 접는다.
    expect(paperWeightOf(99)).toBe(PAPER_WEIGHT_MAX)
    expect(paperWeightOf(-3)).toBe(PAPER_WEIGHT_MIN)
    // 아무것도 주지 않으면 지금까지와 같다.
    expect(paperPad(box)).toBe(paperPad(box, 1))

    // 진하기는 0..1이고 기본은 1이다.
    expect(paperOpacityOf(undefined)).toBe(1)
    expect(paperOpacityOf(0)).toBe(0)
    expect(paperOpacityOf(2)).toBe(1)
    expect(paperOpacityOf(-1)).toBe(0)
  })

  it('컷아웃을 켠 블록에만 두 슬라이더가 나오고, 움직이면 저장된다', async () => {
    await seedJob({ effects: { blk_cut: { paperCutout: true } } })
    const { container } = renderStudio()
    await documentReady(container)

    const card = Array.from(container.querySelectorAll<HTMLElement>('.canvas__sheet .block-card')).find((el) =>
      (el.getAttribute('aria-label') ?? '').startsWith('컷아웃 제품'),
    )!
    fireEvent.pointerDown(card, { button: 0 })
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))

    const thickness = within(card).getByLabelText('종이 테두리 두께')
    const opacity = within(card).getByLabelText('종이 테두리 진하기')
    expect(thickness.getAttribute('value')).toBe('100')
    expect(opacity.getAttribute('value')).toBe('100')

    // 예전 `얇게`(0.6)보다 얇게 내린다.
    fireEvent.change(thickness, { target: { value: '25' } })
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.effects?.blk_cut?.paperWeight).toBeCloseTo(0.25, 5)
    })

    // 진하기 0 — 보이지 않지만 컷아웃은 켜진 채로 남는다.
    fireEvent.change(opacity, { target: { value: '0' } })
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.effects?.blk_cut?.paperOpacity).toBe(0)
      expect(job?.effects?.blk_cut?.paperCutout).toBe(true)
    })

    // 컷아웃을 켜지 않은 블록에는 조절이 없다.
    const plain = Array.from(container.querySelectorAll<HTMLElement>('.canvas__sheet .block-card')).find((el) =>
      (el.getAttribute('aria-label') ?? '').startsWith('일반 이미지'),
    )!
    fireEvent.pointerDown(plain, { button: 0 })
    await waitFor(() => expect(plain.getAttribute('aria-pressed')).toBe('true'))
    expect(within(plain).queryByLabelText('종이 테두리 두께')).toBeNull()
  })

  it('작업 파일 왕복에서 두께·진하기가 남고, 예전 파일도 그대로 읽힌다', async () => {
    const mod = await load('domain/studioFile')
    const studioJob = await load('domain/studioJob')
    const doc = sampleDoc()
    const job = studioJob.withBlockEffects(
      createStudioJob(doc, 1_000, STUDIO_JOB_ID),
      'blk_cut',
      { paperCutout: true, paperWeight: 0.2, paperOpacity: 0.35 },
      2_000,
    )
    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(mod.toStudioFileState(job))))
    expect(parsed?.effects?.blk_cut?.paperWeight).toBeCloseTo(0.2, 5)
    expect(parsed?.effects?.blk_cut?.paperOpacity).toBeCloseTo(0.35, 5)

    // 예전 파일의 문자열 두께는 그때 뜻하던 배율로 읽히고, 진하기는 1이다.
    const old = mod.parseStudioFileState({
      version: '0.5.0',
      source: null,
      productImages: {},
      effects: { blk_cut: { paperCutout: true, paperWeight: 'thin' } },
    })
    expect(old?.effects?.blk_cut?.paperWeight).toBe(0.6)
    expect(old?.effects?.blk_cut?.paperOpacity).toBe(1)
  })
})
