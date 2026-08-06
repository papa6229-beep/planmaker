/**
 * 디자인 스타일 레퍼런스 집중검사.
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
import { AppShell, AppShellProviders } from './AppShell'
import { BackgroundDialog } from '../components/studio/BackgroundDialog'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
import { useBackgroundComposite } from '../features/studio/useBackgroundComposite'
import { useBriefDocument } from '../features/document/useBriefDocument'
import { DocumentsProvider } from '../features/documents/useDocuments'
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
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>(
    '../features/assets/imageUtils',
  )
  return { ...actual, readImageSize: async () => ({ width: 800, height: 1000 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))
vi.mock('../services/imageAnalysisRunner', () => ({
  ANALYSIS_MAX_SIDE: 256,
  analyzeImageBlob: async () => ({
    palette: [{ hex: '#b47040', share: 1 }],
    average: { r: 180, g: 112, b: 64 },
    brightness: 0.5,
    contrast: 0.4,
    saturation: 0.6,
    temperature: 0.3,
    opaqueRatio: 0.25,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    light: { x: -0.3, y: 0, confidence: 'low' },
  }),
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

/** 제품 하나, 로고 하나, 문구 하나. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('스타일 레퍼런스 시험'))
  doc.pages[0]!.id = 'page_1'
  doc.activePageId = 'page_1'
  doc.pages[0]!.blocks = [
    createBlock('main_product_image', {
      id: 'blk_product',
      label: '제품',
      position: { x: 120, y: 420, width: 400, height: 400 },
    }),
    createBlock('logo', { id: 'blk_logo', label: '로고', position: { x: 340, y: 80, width: 160, height: 120 } }),
    createBlock('free_text', {
      id: 'blk_text',
      label: '문구',
      content: '여름 감사제',
      position: { x: 160, y: 240, width: 320, height: 100 },
    }),
  ]
  doc.pages[0]!.canvasHeight = 1000
  return doc
}

async function seedJob(extra: Record<string, unknown> = {}) {
  const doc = sampleDoc()
  const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '스타일.eventbrief')
  await saveStudioJob({
    ...job,
    productImages: { blk_product: 'asset_product', blk_logo: 'asset_logo' },
    method: 'background_composite',
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

/**
 * 배경 생성 + 원본 합성을 **화면 없이** 부르는 자리.
 *
 * 한방 생성 Patch §1에서 이 방식은 새 화면의 기본 경로가 아니게 됐다 — 상단
 * `이미지 생성하기` 하나가 메인 실행이고, `생성 방식` 카드와 두 단계 버튼은
 * 화면에서 내렸다. 코드는 그대로 있으므로, 이 검사도 그대로 남아 **같은 경계**를
 * 본다: 요청에 무엇이 실리고 무엇이 실리지 않는가.
 */
function CompositeControls() {
  const composite = useBackgroundComposite()
  const { document: doc } = useBriefDocument()
  if (composite === null) return null
  const page = doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0]
  return (
    <div>
      <span data-testid="composite-blocks">{page?.blocks.length ?? 0}</span>
      <button type="button" onClick={composite.beginGenerate}>AI로 배경 생성</button>
      <BackgroundDialog />
    </div>
  )
}

function CompositeHost() {
  const studio = useStudioJob()
  if (studio === null) return null
  return (
    <AppShellProviders binding={studio.binding} freePlacement>
      <CompositeControls />
    </AppShellProviders>
  )
}

function renderComposite() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <StudioJobProvider>
        <CompositeHost />
      </StudioJobProvider>
    </MemoryRouter>,
  )
}

/** 문서가 붙기 전에 누르면 아직 이 페이지가 아니다. 블록이 선 뒤에 시작한다. */
async function compositeReady() {
  await waitFor(() => expect(screen.getByTestId('composite-blocks').textContent).toBe('3'), { timeout: 5000 })
}

/**
 * 불러온 기획서가 화면에 붙을 때까지 기다린다.
 *
 * 작업판은 빈 문서로 먼저 서고 저장된 작업을 뒤이어 읽는다. 그 사이에 손을
 * 대면 아직 없는 페이지에 쓰게 되므로, 캔버스에 블록이 선 뒤에 시작한다.
 */
async function documentReady(container: HTMLElement) {
  await waitFor(() => expect(container.querySelectorAll('.canvas__sheet .block-card').length).toBe(3), {
    timeout: 5000,
  })
}

/** 생성 승인까지 눌러 준다. 응답은 stub — 실제 결제는 일어나지 않는다. */
async function generate() {
  sessionStorage.setItem('planmaker.openai-key', 'sk-stub')
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ image: { b64: btoa('plate'), mimeType: 'image/png' }, metadata: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
  fireEvent.click(await screen.findByRole('button', { name: 'AI로 배경 생성' }))
  const dialog = await screen.findByRole('dialog', { name: '배경 생성 확인' })
  fireEvent.click(within(dialog).getByRole('button', { name: '배경 만들기' }))
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
  return fetchSpy.mock.calls[0]![1].body as FormData
}

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
  await putAsset(storedAsset('asset_product', 1))
  await putAsset(storedAsset('asset_logo', 2))
  await putAsset(storedAsset('asset_style', 3))
})

// ── 1·2·3. 화면 ──────────────────────────────────────────────────────────────

describe('화면 Studio의 스타일 레퍼런스 자리', () => {
  it('Studio 왼쪽에 스타일 레퍼런스 한 칸만 있고, 예전 참고 도구는 없다', async () => {
    await seedJob()
    renderStudio()

    const panel = await screen.findByRole('region', { name: '디자인 스타일 레퍼런스' })
    expect(panel.textContent).toContain('AI가 색감·질감·그래픽 분위기를 참고합니다.')
    expect(panel.textContent).toContain('제품·인물 원본과는 다른 자료입니다.')
    expect(within(panel).getByRole('button', { name: '스타일 이미지 추가' })).toBeTruthy()

    // 레이아웃 참고용 도구와 오버레이 조작은 작업판에서 사라진다.
    expect(screen.queryByRole('region', { name: '참고 이미지 도구' })).toBeNull()
    expect(screen.queryByRole('button', { name: '참고 이미지 추가' })).toBeNull()
    expect(screen.queryByRole('radio', { name: '오버레이' })).toBeNull()
  })

  it('작성기에는 기존 참고 이미지 도구가 그대로다', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <DocumentsProvider>
          <AppShell mode="brief" />
        </DocumentsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('region', { name: '참고 이미지 도구' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '참고 이미지 추가' })).toBeTruthy()
    // 보기 조작 두 가지도 작성기에 그대로 남는다 (없어진 `나란히 보기`는 여전히 없다).
    expect(screen.getByRole('radio', { name: '캔버스만' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '오버레이' })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '나란히 보기' })).toBeNull()
    expect(screen.queryByRole('region', { name: '디자인 스타일 레퍼런스' })).toBeNull()
  })

  it('추가하면 미리보기와 교체·제거가 나타나고, 제거하면 되돌아간다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await documentReady(container)
    const panel = await screen.findByRole('region', { name: '디자인 스타일 레퍼런스' })
    expect(panel.textContent).toContain('이미지 없음')

    const file = new File([new Uint8Array([137, 80, 78, 71, 9])], 'style.png', { type: 'image/png' })
    fireEvent.change(panel.querySelector('input[type="file"]')!, { target: { files: [file] } })

    await waitFor(() => expect(within(panel).getByRole('button', { name: '교체' })).toBeTruthy())
    expect(within(panel).getByRole('button', { name: '제거' })).toBeTruthy()
    expect(within(panel).getByAltText('디자인 스타일 레퍼런스')).toBeTruthy()

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.styleRefs?.page_1).toBeTruthy()
    })

    fireEvent.click(within(panel).getByRole('button', { name: '제거' }))
    await waitFor(() => expect(within(panel).getByRole('button', { name: '스타일 이미지 추가' })).toBeTruthy())
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.styleRefs?.page_1).toBeUndefined()
    })
  })
})

// ── 4. 페이지마다 한 장 ──────────────────────────────────────────────────────

describe('페이지당 한 장', () => {
  it('페이지별로 따로 기억하고, 새 페이지는 비어 있다', async () => {
    const mod = await load('domain/studioJob')
    const doc = sampleDoc()
    let job = createStudioJob(doc, 1_000, STUDIO_JOB_ID)

    expect(mod.styleReferenceOf(job, 'page_1')).toBeUndefined()
    job = mod.withStyleReference(job, 'page_1', 'asset_style', 2_000)
    expect(mod.styleReferenceOf(job, 'page_1')).toBe('asset_style')
    // 다른 페이지는 비어 있다.
    expect(mod.styleReferenceOf(job, 'page_2')).toBeUndefined()

    // 한 장뿐이다 — 새로 넣으면 갈아 끼운다.
    job = mod.withStyleReference(job, 'page_1', 'asset_other', 3_000)
    expect(Object.keys(job.styleRefs ?? {})).toHaveLength(1)
    expect(mod.styleReferenceOf(job, 'page_1')).toBe('asset_other')

    // 자산 정리가 지우면 안 되는 목록에 든다.
    expect(mod.studioLiveAssetIds(job)).toContain('asset_other')

    job = mod.withoutStyleReference(job, 'page_1', 4_000)
    expect(mod.styleReferenceOf(job, 'page_1')).toBeUndefined()
  })
})

// ── 5·6. 요청에 무엇이 실리는가 ──────────────────────────────────────────────

describe('요청 레퍼런스만 가고 원본은 가지 않는다', () => {
  it('레퍼런스가 없으면 지금까지처럼 이미지 0장으로 나간다', async () => {
    await seedJob()
    renderComposite()
    await compositeReady()
    const form = await generate()
    expect(form.getAll('images[]')).toHaveLength(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('레퍼런스가 있으면 그 한 장만 실린다', async () => {
    await seedJob({ styleRefs: { page_1: 'asset_style' } })
    renderComposite()
    await compositeReady()
    const form = await generate()

    const files = form.getAll('images[]').filter((v): v is File => typeof v !== 'string')
    expect(files).toHaveLength(1)
    // 이름으로 무엇을 보냈는지 말한다 — 제품·로고 자산은 이름부터 다르다.
    expect(files[0]!.name).toBe('style-reference.png')
    expect(files.some((f) => f.name.includes('product') || f.name.includes('logo'))).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('붙일 수 있는 것은 스타일 레퍼런스 하나뿐이다', async () => {
    const { backgroundAttachmentIds } = await load('domain/backgroundRequest')
    // 제품·로고·컷아웃 자산이 끼어들 인자가 아예 없다.
    expect(backgroundAttachmentIds(undefined)).toEqual([])
    expect(backgroundAttachmentIds('asset_style')).toEqual(['asset_style'])
  })
})

// ── 7. 프롬프트가 말하는 것 ──────────────────────────────────────────────────

describe('프롬프트 스타일 참고만, 복제는 아니다', () => {
  it('레퍼런스가 있을 때의 주문에 의도와 금지가 함께 들어간다', async () => {
    const { buildBackgroundPrompt } = await load('domain/backgroundPrompt')
    const prompt = buildBackgroundPrompt({
      wish: '',
      size: { width: 840, height: 1000 },
      analysis: null,
      reserved: [{ x: 120, y: 420, width: 400, height: 400 }],
      styleReference: true,
    })
    for (const phrase of ['색감', '질감', '그래픽 밀도', '참고']) expect(prompt).toContain(phrase)
    for (const banned of ['사람', '제품', '로고', '글자', '가격', '버튼']) expect(prompt).toContain(banned)
    expect(prompt).toContain('비워')
    expect(prompt).toContain('가독성')
    // "똑같이 복제하라"는 말은 쓰지 않는다.
    for (const forbidden of ['복제', '똑같이', '그대로 따라']) expect(prompt).not.toContain(forbidden)
  })

  it('레퍼런스가 없으면 그 문단이 아예 없다', async () => {
    const { buildBackgroundPrompt } = await load('domain/backgroundPrompt')
    const prompt = buildBackgroundPrompt({
      wish: '따뜻한 베이지',
      size: { width: 840, height: 1000 },
      analysis: null,
      reserved: [],
    })
    expect(prompt).not.toContain('레퍼런스')
  })

  it('문구가 놓일 자리는 좌표로만 가고 원문은 가지 않는다', async () => {
    await seedJob({ styleRefs: { page_1: 'asset_style' } })
    renderComposite()
    await compositeReady()
    const form = await generate()
    const prompt = String(form.get('prompt'))
    expect(prompt).not.toContain('여름 감사제')
    // 그 자리는 비워 달라고 말한다.
    expect(prompt).toContain('비워')
  })
})

// ── 8. 저장과 왕복 ───────────────────────────────────────────────────────────

describe('저장 파일 왕복에서 살아남는다', () => {
  it('작업 파일에 담기고 자산 재번호를 따라가며, 예전 파일은 없음으로 읽힌다', async () => {
    const mod = await load('domain/studioFile')
    const studioJob = await load('domain/studioJob')
    const doc = sampleDoc()
    const job = studioJob.withStyleReference(createStudioJob(doc, 1_000, STUDIO_JOB_ID), 'page_1', 'asset_style', 2_000)

    const state = mod.toStudioFileState(job)
    expect(mod.studioFileAssetIds(state)).toContain('asset_style')

    const remapped = mod.remapStudioFileState(state, new Map([['asset_style', 'asset_style_2']]))
    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(remapped)))
    expect(parsed?.styleRefs?.page_1).toBe('asset_style_2')

    const old = mod.parseStudioFileState({
      version: '0.3.0',
      source: null,
      productImages: { blk_product: 'asset_product' },
    })
    expect(old?.styleRefs ?? {}).toEqual({})
    expect(old?.productImages.blk_product).toBe('asset_product')
  })
})

// ── 9·10. 호출과 합성 ────────────────────────────────────────────────────────

describe('호출과 합성', () => {
  it('승인 뒤 정확히 1회 나가고 자동 재시도는 없다', async () => {
    await seedJob({ styleRefs: { page_1: 'asset_style' } })
    renderComposite()
    await compositeReady()
    await generate()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 300))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('만든 플레이트 위에 제품·로고·문구가 원래 좌표 그대로 남는다', async () => {
    const { planLocalComposite } = await load('domain/composite')
    const doc = sampleDoc()
    const plan = planLocalComposite({
      page: doc.pages[0]!,
      background: { assetId: 'asset_plate', source: 'ai' },
      productImages: { blk_product: 'asset_product', blk_logo: 'asset_logo' },
      effects: { blk_product: { paperCutout: true } },
    })
    expect(plan.background?.assetId).toBe('asset_plate')
    const product = plan.layers.find((l: { blockId: string }) => l.blockId === 'blk_product')
    expect(product.assetId).toBe('asset_product')
    expect(product.rect).toEqual({ x: 120, y: 420, width: 400, height: 400 })
    expect(product.effects.paperCutout).toBe(true)
    expect(plan.layers.find((l: { blockId: string }) => l.blockId === 'blk_logo').assetId).toBe('asset_logo')
    const text = plan.texts.find((t: { blockId: string }) => t.blockId === 'blk_text')
    expect(text.content).toBe('여름 감사제')
    expect(text.rect).toEqual({ x: 160, y: 240, width: 320, height: 100 })
  })
})
