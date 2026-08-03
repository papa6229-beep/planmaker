/**
 * 이미지 생성기 0단계 — 집중검사 (§9.1의 13항목).
 *
 * 이 단계에서 지켜야 할 경계는 셋이다.
 *
 *  1. 불러온 기획서는 원본이다. 디자인팀이 작업판에서 무엇을 연결하든 원본
 *     기획서의 내용은 조용히 바뀌지 않는다 — 실사용 제품 이미지는 문서가 아니라
 *     Studio 작업자료에만 기록된다.
 *  2. 참고 이미지와 실제 사용 제품 이미지는 끝까지 다른 것이다. 참고 이미지가
 *     자동으로 실사용 자산이 되는 경로는 없어야 한다.
 *  3. GPT에게 나가는 것은 원본 파일이 아니라 하나의 해석 결과다. 문구는 원문
 *     그대로, 위치·크기·정렬·강조와 함께, 그리고 연결 주소(URL)는 빠진 채로.
 *
 * 그리고 이번 단계에서는 어떤 외부 API도 호출하지 않는다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import {
  clearAllStudioJobs,
  loadStudioJob,
  resetStudioStoreForTests,
  saveStudioJob,
  allStudioAssetIds,
  STUDIO_JOB_ID,
} from '../services/studioStore'
import {
  createStudioJob,
  linkProductImage,
  productImageOf,
  sourceChanged,
  studioAssetIds,
  unlinkProductImage,
  withSource,
} from '../domain/studioJob'
import { referencedAssetIds } from '../domain/pageOps'
import { buildGenerationRequest, buildGenerationRequests } from '../domain/generationRequest'
import { createEmptyDocument, createPage, PAGE_CANVAS_WIDTH } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { documentFingerprint } from '../domain/documentFingerprint'
import { packageEventDocument } from '../services/eventBriefExport'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 640, height: 640 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

// §9.13 — 이번 작업 동안 외부 API 호출이 0건임을 실제로 센다.
const fetchSpy = vi.fn()
const xhrOpenSpy = vi.fn()
globalThis.fetch = fetchSpy as unknown as typeof fetch
XMLHttpRequest.prototype.open = xhrOpenSpy as unknown as XMLHttpRequest['open']

const PRODUCT_URL = 'https://shop.example.com/goods/12345'

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed, seed, seed, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 8,
  }
}

/**
 * 대표 기획서: 두 페이지, 서로 다른 길이, 문구·참고 이미지가 붙은 이미지 자리,
 * 버튼과 그 연결 주소, 전체 컨셉과 작성팀.
 */
function sampleDoc(): BriefDocument {
  const project = createEmptyProject('가을 신상 예약판매')
  project.concept = '단정하고 신뢰감 있게'
  project.requestTeam = 'product'
  const doc = createEmptyDocument(project)

  const headline = createBlock('free_text', {
    id: 'blk_text',
    content: '가을 신상 예약판매',
    position: { x: 84, y: 100, width: 420, height: 120 },
    layoutHint: { emphasis: 'high', alignment: 'center' },
  })
  const slot = createBlock('main_product_image', {
    id: 'blk_image',
    label: '이미지',
    content: '니트 정면 컷이 들어갑니다',
    assetId: 'asset_ref',
    position: { x: 120, y: 300, width: 600, height: 400 },
  })
  slot.image = { referenceOnly: true }
  const button = createBlock('cta_button', {
    id: 'blk_button',
    content: '지금 예약하기',
    groupId: 'grp_cta',
    position: { x: 300, y: 800, width: 240, height: 80 },
  })
  const url = createBlock('button_url', {
    id: 'blk_url',
    content: PRODUCT_URL,
    groupId: 'grp_cta',
    position: { x: 300, y: 800, width: 240, height: 80 },
  })

  doc.pages[0]!.title = '1페이지'
  doc.pages[0]!.blocks = [headline, slot, button, url]
  doc.pages[0]!.canvasHeight = 1000
  doc.pages[0]!.reference = { ...doc.pages[0]!.reference, assetId: 'asset_page', viewMode: 'overlay', visible: true }

  const second = createPage({ id: 'page_2', title: '2페이지', canvasHeight: 1400 })
  second.blocks = [
    createBlock('free_text', {
      id: 'blk_text2',
      content: '기간 한정 혜택',
      position: { x: 0, y: 60, width: 840, height: 100 },
      layoutHint: { alignment: 'right', emphasis: 'low' },
    }),
  ]
  doc.pages.push(second)
  doc.assets = [
    { id: 'asset_ref', fileName: 'asset_ref.png', mimeType: 'image/png' },
    { id: 'asset_page', fileName: 'asset_page.png', mimeType: 'image/png' },
  ]
  return doc
}

async function briefFile(doc: BriefDocument): Promise<File> {
  const pkg = await packageEventDocument({
    doc,
    assets: [storedAsset('asset_ref', 3), storedAsset('asset_page', 4)],
    previews: doc.pages.map(() => new Blob([new Uint8Array([1])], { type: 'image/png' })),
    createdAt: new Date(0).toISOString(),
  })
  return new File([pkg.blob], '가을신상.eventbrief', { type: 'application/zip' })
}

function renderAt(path: string, surface: 'brief-writer' | 'studio' = 'studio') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes surface={surface} />
    </MemoryRouter>,
  )
}

/**
 * 작업판이 실제로 열릴 때까지 기다린다.
 *
 * 제품 이미지 연결 전용 패널은 첫 사용 흐름 §8에서 없어졌다 — 같은 정보를 두
 * 군데에서 받지 않기 위해서다. 연결은 이제 이미지 블록에서 직접 한다.
 */
async function studioReady() {
  await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 5000 })
}

const openBriefFile = async (file: File) => {
  const input = document.querySelector('.toolbar__file-input') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

/** 이미지 자리 카드(설명으로 찾는다). */
function slotRow(description: string): HTMLElement {
  const rows = [...document.querySelectorAll('.block-card')] as HTMLElement[]
  const row = rows.find((r) => r.textContent?.includes(description))
  if (!row) throw new Error(`이미지 자리를 찾지 못했습니다: ${description}`)
  return row
}

function pngFile(name: string, seed: number): File {
  return new File([new Uint8Array([137, 80, 78, 71, seed, seed, seed, seed])], name, { type: 'image/png' })
}

beforeEach(async () => {
  resetAssetStoreForTests()
  resetDocumentStoreForTests()
  resetRequestStoreForTests()
  resetStudioStoreForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
  await clearAllStudioJobs()
})

describe('§9.1-1·2 기획서를 원문 그대로 열고, 원본과 작업자료를 나눈다', () => {
  it('opens an .eventbrief in the studio with its wording, pages and reference intact', async () => {
    await putAsset(storedAsset('asset_ref', 3))
    await putAsset(storedAsset('asset_page', 4))
    renderAt('/studio')
    await studioReady()

    await openBriefFile(await briefFile(sampleDoc()))

    await waitFor(() => {
      expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('가을 신상 예약판매')
    }, { timeout: 5000 })
    // 문구는 원문 그대로, 페이지는 페이지대로.
    expect(document.body.textContent).toContain('가을 신상 예약판매')
    expect(document.body.textContent).toContain('니트 정면 컷이 들어갑니다')
    expect(screen.getByRole('button', { name: '2페이지' })).toBeTruthy()
    expect((document.querySelector('#concept-input') as HTMLTextAreaElement).value).toBe('단정하고 신뢰감 있게')

    // 원본은 Studio 작업자료에 따로 남는다.
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.source?.fingerprint).toBe(documentFingerprint(job!.doc))
    }, { timeout: 5000 })
  })

  it('keeps the linked product image out of the brief document entirely', () => {
    const doc = sampleDoc()
    const before = documentFingerprint(doc)
    const job = linkProductImage(createStudioJob(doc, 1), 'blk_image', 'asset_cutout')

    expect(productImageOf(job, 'blk_image')).toBe('asset_cutout')
    // 문서는 한 글자도 달라지지 않는다.
    expect(documentFingerprint(job.doc)).toBe(before)
    expect(JSON.stringify(job.doc)).not.toContain('asset_cutout')
    expect(studioAssetIds(job)).toEqual(['asset_cutout'])
  })
})

describe('§9.1-3·4·5 참고 이미지와 실사용 제품 이미지', () => {
  it('never promotes a reference capture into the image to use', () => {
    const doc = sampleDoc()
    const job = createStudioJob(doc, 1)
    const request = buildGenerationRequest(doc, job, doc.pages[0]!.id)
    const slot = request.design.imageSlots.find((s) => s.blockId === 'blk_image')!

    expect(slot.referenceAsset?.assetId).toBe('asset_ref')
    expect(slot.referenceOnly).toBe(true)
    expect(slot.productImage).toBeUndefined()
    expect(slot.status).toBe('missing')
  })

  it('links, replaces and removes the product image without touching the brief', () => {
    const doc = sampleDoc()
    const before = documentFingerprint(doc)
    let job = linkProductImage(createStudioJob(doc, 1), 'blk_image', 'asset_cut_a')
    job = linkProductImage(job, 'blk_image', 'asset_cut_b')
    expect(productImageOf(job, 'blk_image')).toBe('asset_cut_b')

    job = unlinkProductImage(job, 'blk_image')
    expect(productImageOf(job, 'blk_image')).toBeUndefined()
    expect(studioAssetIds(job)).toEqual([])

    // 제거 후에도 설명·참고 이미지·링크·좌표가 그대로다.
    expect(documentFingerprint(job.doc)).toBe(before)
    const request = buildGenerationRequest(job.doc, job, job.doc.pages[0]!.id)
    const slot = request.design.imageSlots.find((s) => s.blockId === 'blk_image')!
    expect(slot.description).toBe('니트 정면 컷이 들어갑니다')
    expect(slot.referenceAsset?.assetId).toBe('asset_ref')
    expect(slot.box).toEqual({ x: 120, y: 300, width: 600, height: 400 })
    expect(request.design.buttons[0]?.hasLink).toBe(true)
  })
})

describe('§9.1-6·7·8·9·10 GPT 제작 요청 해석', () => {
  it('carries every wording verbatim with its box, alignment and emphasis', () => {
    const doc = sampleDoc()
    const request = buildGenerationRequest(doc, createStudioJob(doc, 1), doc.pages[0]!.id)
    const text = request.design.texts.find((t) => t.blockId === 'blk_text')!

    expect(text.content).toBe('가을 신상 예약판매')
    expect(text.verbatim).toBe(true)
    expect(text.printInImage).toBe(true)
    expect(text.align).toBe('center')
    expect(text.emphasis).toBe('high')
    expect(text.box).toEqual({ x: 84, y: 100, width: 420, height: 120 })
    // 픽셀과 함께 페이지 크기에 대한 상대 비율도 준다.
    expect(text.ratio.x).toBeCloseTo(84 / PAGE_CANVAS_WIDTH, 5)
    expect(text.ratio.height).toBeCloseTo(120 / 1000, 5)
  })

  it('sends 전체 컨셉 as direction, never as wording to print', () => {
    const doc = sampleDoc()
    const request = buildGenerationRequest(doc, createStudioJob(doc, 1), doc.pages[0]!.id)

    expect(request.design.document.concept).toBe('단정하고 신뢰감 있게')
    const concept = request.design.instructions.find((i) => i.scope === 'document')!
    expect(concept.content).toBe('단정하고 신뢰감 있게')
    expect(concept.renderAsText).toBe(false)
    expect(request.design.texts.some((t) => t.content.includes('단정하고'))).toBe(false)
  })

  it('excludes the real URL from the design input and keeps it in publishing', () => {
    const doc = sampleDoc()
    const request = buildGenerationRequest(doc, createStudioJob(doc, 1), doc.pages[0]!.id)

    expect(JSON.stringify(request.design)).not.toContain(PRODUCT_URL)
    expect(JSON.stringify(request.design)).not.toContain('http')
    expect(request.publishing.links.map((l) => l.url)).toContain(PRODUCT_URL)
    expect(request.design.buttons.map((b) => b.text)).toEqual(['지금 예약하기'])
  })

  it('splits multiple pages by their own size and content', () => {
    const doc = sampleDoc()
    const requests = buildGenerationRequests(doc, createStudioJob(doc, 1))

    expect(requests).toHaveLength(2)
    expect(requests[0]!.design.document.canvas).toEqual({ width: 840, height: 1000 })
    expect(requests[1]!.design.document.canvas).toEqual({ width: 840, height: 1400 })
    expect(requests[0]!.design.document.pageId).not.toBe(requests[1]!.design.document.pageId)
    expect(requests[1]!.design.texts.map((t) => t.content)).toEqual(['기간 한정 혜택'])
    expect(requests[1]!.design.document.pageCount).toBe(2)
  })

  it('never hides an image slot that has no product image yet', () => {
    const doc = sampleDoc()
    const request = buildGenerationRequest(doc, createStudioJob(doc, 1), doc.pages[0]!.id)

    expect(request.design.missingProductImages).toEqual(['blk_image'])
    expect(request.design.imageSlots).toHaveLength(1)
  })
})

describe('§9.1-4·10 작업판 화면', () => {
  it('links a product cut-out from the panel, shows it, and removes it again', async () => {
    await putAsset(storedAsset('asset_ref', 3))
    await putAsset(storedAsset('asset_page', 4))
    renderAt('/studio')
    await studioReady()
    await openBriefFile(await briefFile(sampleDoc()))
    await waitFor(() => expect(slotRow('니트 정면 컷이 들어갑니다')).toBeTruthy(), { timeout: 5000 })

    const row = () => slotRow('니트 정면 컷이 들어갑니다')
    // 연결 전에는 작성자의 참고 캡처가 참고 캡처라고 적힌 채 보인다.
    expect(row().textContent).toContain('참고용 이미지')

    fireEvent.change(row().querySelector('.block-card__file') as HTMLInputElement, {
      target: { files: [pngFile('cutout.png', 9)] },
    })
    await waitFor(() => expect(row().textContent).toContain('실제 사용 제품 이미지'), { timeout: 5000 })

    // 세는 것은 디자인팀이 연결한 제품 이미지다. 저장소 쪽 `allStudioAssetIds`는
    // 정리가 지우면 안 되는 것 전부(작업본 문서가 쓰는 이미지까지)를 말하므로,
    // 여기서 묻는 것과 다르다.
    await waitFor(async () => {
      expect(studioAssetIds((await loadStudioJob(STUDIO_JOB_ID))!)).toHaveLength(1)
    }, { timeout: 5000 })

    // 정리가 지키는 목록은 그보다 넓다: 연결한 누끼와, 작업본 문서가 쓰는
    // 이미지까지. 작업본은 보관함의 어느 행도 아니어서, 이 목록이 좁으면 다른
    // 쪽 정리가 하던 작업의 참고 이미지를 지운다.
    const protectedIds = await allStudioAssetIds()
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(protectedIds).toContain(job.productImages['blk_image'])
    // 참고 이미지도 페이지 참고 이미지도 — 불러오면서 새 번호를 받았더라도.
    const docIds = referencedAssetIds(job.doc)
    expect(docIds.length).toBeGreaterThan(0)
    for (const id of docIds) expect(protectedIds).toContain(id)

    fireEvent.pointerDown(row(), { button: 0 })
    await waitFor(() => expect(within(row()).getByRole('button', { name: '제품 이미지 제거' })).toBeTruthy())
    fireEvent.click(within(row()).getByRole('button', { name: '제품 이미지 제거' }))
    await waitFor(() => expect(row().textContent).toContain('참고용 이미지'), { timeout: 5000 })
    await waitFor(async () => {
      expect(studioAssetIds((await loadStudioJob(STUDIO_JOB_ID))!)).toHaveLength(0)
    }, { timeout: 5000 })
  }, 20000)

  it('shows the request in plain Korean, with the missing product image called out', async () => {
    await putAsset(storedAsset('asset_ref', 3))
    await putAsset(storedAsset('asset_page', 4))
    renderAt('/studio')
    await studioReady()
    await openBriefFile(await briefFile(sampleDoc()))
    await waitFor(() => expect(slotRow('니트 정면 컷이 들어갑니다')).toBeTruthy(), { timeout: 5000 })

    // 파일 불러오기가 끝나기 전에는 상단바 버튼이 잠겨 있다. 시간을 늘리는 대신
    // 실제로 눌릴 수 있는 상태가 될 때까지 기다린다.
    const preview = screen.getByRole('button', { name: 'AI 제작 요청 미리보기' }) as HTMLButtonElement
    await waitFor(() => expect(preview.disabled).toBe(false), { timeout: 5000 })
    fireEvent.click(preview)
    const dialog = await screen.findByRole('dialog', { name: 'AI 제작 요청 미리보기' })

    expect(dialog.textContent).toContain('단정하고 신뢰감 있게')
    expect(dialog.textContent).toContain('가을 신상 예약판매')
    expect(dialog.textContent).toContain('니트 정면 컷이 들어갑니다')
    expect(dialog.textContent).toContain('지금 예약하기')
    expect(dialog.textContent).toContain('840')
    expect(dialog.textContent).toContain('제품 이미지 미연결')
    // 금지사항이 사람 말로 적혀 있다.
    expect(dialog.textContent).toContain('원문 그대로')
    // 이미지 디자인 입력에 주소는 없다.
    expect(within(dialog).getByRole('region', { name: '이미지 제작 입력' }).textContent).not.toContain('http')
  })
})

describe('§9.1-11·12 복원과 표면 분리', () => {
  it('restores the studio job — document and product links — after a reload', async () => {
    const doc = sampleDoc()
    // 파일을 열고(원본 채택) 그 다음 제품 이미지를 연결한 상태.
    const job = linkProductImage(
      withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, '가을신상.eventbrief'),
      'blk_image',
      'asset_cutout',
    )
    await saveStudioJob(job)
    await putAsset(storedAsset('asset_ref', 3))
    await putAsset(storedAsset('asset_cutout', 7))

    renderAt('/studio')
    await studioReady()

    await waitFor(() => {
      expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('가을 신상 예약판매')
    }, { timeout: 5000 })
    await waitFor(() => expect(slotRow('니트 정면 컷이 들어갑니다').textContent).toContain('실제 사용 제품 이미지'), {
      timeout: 5000,
    })
  })

  it('detects that the original brief has drifted from the work copy', () => {
    const doc = sampleDoc()
    const job = withSource(createStudioJob(doc, 1), doc, 1)
    expect(sourceChanged(job)).toBe(false)

    const edited: BriefDocument = {
      ...job.doc,
      project: { ...job.doc.project, title: '다른 제목' },
    }
    expect(sourceChanged({ ...job, doc: edited })).toBe(true)
  })

  it('shows nothing of the studio on the brief-writer surface', async () => {
    renderAt('/studio', 'brief-writer')
    // 작성기의 첫 화면은 팀 선택이다 (첫 사용 흐름 §4).
    await waitFor(() => expect(screen.getByRole('heading', { name: '어느 팀으로 기획서를 쓰시나요?' })).toBeTruthy(), {
      timeout: 5000,
    })

    expect(screen.queryByRole('button', { name: 'AI 제작 요청 미리보기' })).toBeNull()
    expect(screen.queryByLabelText('AI에게 추가로 전달할 말')).toBeNull()
    expect(document.body.textContent).not.toContain('제품 이미지')
  })
})

describe('§9.1-13 외부 API', () => {
  it('has called no external API at any point in this suite', () => {
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrOpenSpy).not.toHaveBeenCalled()
  })
})
