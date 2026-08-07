/**
 * Studio 실작업 화면과 이미지 저장 (실작업 UI 마감 §2–§5).
 *
 * 작업판은 기획서를 쓰는 곳이 아니라 **이미지를 만들어 내보내는 곳**이다. 그
 * 사실이 화면에 드러나야 한다: 작업자가 다시 만질 이유가 없는 입력창은 없애고,
 * 우측은 지금 무엇을 할 차례인지만 말하고, 상단의 저장은 기획서 파일이 아니라
 * 방금 만든 이미지를 내놓는다.
 *
 * 없애는 것은 **화면의 입력구**이지 데이터가 아니다. 기획서가 지니고 온 컨셉과
 * 작성자의 부탁은 그대로 남아 생성 요청에 실린다 — 그래서 여기 검사도 "화면에서
 * 사라졌는가"와 "요청에는 그대로 있는가"를 함께 본다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, putAsset, getAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
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
import { createStudioJob, linkProductImage, withSource, revisionsOf, cursorOf } from '../domain/studioJob'
import { createEmptyDocument, createPage } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import JSZip from 'jszip'
import { imageZipFileName, isPartialSave, pageImageFileName, planImageSave } from '../domain/imageSaveFile'
import { zipSavedImages } from '../services/imageSave'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 640, height: 640 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: 'image/png' }),
}))
vi.mock('../services/canvasImageOps', () => ({
  measureImage: async () => ({ width: 832, height: 1472 }),
  drawToSize: async (_b: Blob, width: number, height: number) =>
    new Blob([`drawn:${String(width)}x${String(height)}`], { type: 'image/png' }),
}))

const KEY = 'sk-workspace-key'
const b64For = (n: number): string => btoa(`image-${String(n)}`)

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

/** 두 페이지짜리 기획서 — 페이지별 결과가 서로를 덮지 않는지 보려면 둘이 필요하다. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('아크웨이브 여름감사제'))
  doc.project.concept = '시원하고 청량한 여름 분위기'
  doc.project.designerNote = '메인 문구를 가장 크게 잡아 주세요.'
  const text = (id: string, content: string, y: number) =>
    createBlock('free_text', { id, content, position: { x: 100, y, width: 400, height: 90 } })
  const image = (id: string, content: string, y: number) =>
    createBlock('main_product_image', { id, content, position: { x: 100, y, width: 400, height: 200 } })

  doc.pages[0]!.blocks = [text('blk_t1', '여름 감사제', 80), image('blk_i1', '대표 제품', 300)]
  doc.pages[0]!.canvasHeight = 1488

  const second = createPage({ title: '2페이지' })
  second.blocks = [text('blk_t2', '지금 예약하기', 100), image('blk_i2', '사은품', 400)]
  second.canvasHeight = 1200
  doc.pages.push(second)
  doc.assets = []
  return doc
}

function readyJob() {
  const doc = sampleDoc()
  let job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
  job = linkProductImage(job, 'blk_i1', 'asset_p1')
  job = linkProductImage(job, 'blk_i2', 'asset_p2')
  return job
}

/** 한 페이지짜리 — "전부 만들었다"가 성립하는 가장 단순한 경우. */
async function useOnePageBrief(): Promise<void> {
  const doc = sampleDoc()
  doc.pages = [doc.pages[0]!]
  doc.activePageId = doc.pages[0]!.id
  let job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
  job = linkProductImage(job, 'blk_i1', 'asset_p1')
  await saveStudioJob(job)
}

let calls: { url: string; init: RequestInit }[] = []
let responseSeq = 0
let downloads: { fileName: string; blob: Blob }[] = []

beforeEach(async () => {
  calls = []
  responseSeq = 0
  downloads = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    responseSeq += 1
    return new Response(
      JSON.stringify({
        image: { b64: b64For(responseSeq), mimeType: 'image/png' },
        metadata: { model: 'gpt-image-2', quality: 'medium', requestedSize: '832x1472', requestId: 'r' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  // 브라우저가 실제로 내려받는 대신, 무엇을 어떤 이름으로 내놓았는지만 잡아 둔다.
  const realCreate = URL.createObjectURL.bind(URL)
  const urlToBlob = new Map<string, Blob>()
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:studio/${String(urlToBlob.size)}`
    urlToBlob.set(url, blob)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL
  void realCreate
  const realClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
    const blob = urlToBlob.get(this.href)
    if (this.download && blob !== undefined) downloads.push({ fileName: this.download, blob })
    else realClick.call(this)
  }

  sessionStorage.clear()
  localStorage.clear()
  resetAssetStoreForTests()
  resetDocumentStoreForTests()
  resetRequestStoreForTests()
  resetStudioStoreForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
  await clearAllStudioJobs()
  await saveStudioJob(readyJob())
  await putAsset(storedAsset('asset_p1', 1))
  await putAsset(storedAsset('asset_p2', 2))
})

afterEach(() => cleanup())

async function openStudio(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('아크웨이브 여름감사제')
  }, { timeout: 8000 })
}

async function openWriter(): Promise<void> {
  // 작성기는 팀을 고른 뒤에야 기획서를 연다 — 여기서는 그 한 걸음만 미리 둔다.
  localStorage.setItem('planmaker.selected-team', 'marketing')
  render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <AppRoutes surface="brief-writer" />
    </MemoryRouter>,
  )
  await waitFor(() => expect(document.querySelector('.editor-topbar__title')).toBeTruthy(), { timeout: 8000 })
}

/** 지금 열려 있는 페이지를 한 번 생성한다. 저장된 결과가 생길 때까지 기다린다. */
async function generateHere(pageIndex = 0): Promise<string> {
  const job = (await loadStudioJob(STUDIO_JOB_ID))!
  const pageId = job.doc.pages[pageIndex]!.id
  const before = job.results?.[pageId]?.assetId
  fireEvent.click(screen.getByRole('button', { name: /이미지 (생성하기|다시 생성하기)/ }))
  if (screen.queryByLabelText('테스트용 OpenAI API 키') !== null) {
    fireEvent.change(screen.getByLabelText('테스트용 OpenAI API 키'), { target: { value: KEY } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 계속' }))
  } else {
    fireEvent.click(screen.getByRole('button', { name: '생성 시작' }))
  }
  let assetId: string | undefined
  await waitFor(async () => {
    assetId = (await loadStudioJob(STUDIO_JOB_ID))!.results?.[pageId]?.assetId
    expect(assetId !== undefined && assetId !== before).toBe(true)
  }, { timeout: 8000 })
  return assetId!
}

const menuButton = () => screen.getByRole('button', { name: '작업 메뉴' })
const openMenu = () => fireEvent.click(menuButton())

// ── 좌측: 무엇을 지우고 무엇을 남기는가 ──────────────────────────────────────

describe('§2 작업판 좌측은 편집할 것 하나만 남긴다', () => {
  it('has no concept field on the studio surface', async () => {
    await openStudio()
    expect(screen.queryByLabelText('원하는 분위기·컨셉')).toBeNull()
    expect(screen.queryByText('원하는 분위기·컨셉')).toBeNull()
  }, 25000)

  it('keeps the concept field on the writer surface', async () => {
    await openWriter()
    expect(screen.getByLabelText('원하는 분위기·컨셉')).toBeTruthy()
  }, 25000)

  it('keeps the concept in the document and in the generation request', async () => {
    await openStudio()
    await generateHere()
    const job = await loadStudioJob(STUDIO_JOB_ID)
    expect(job!.doc.project.concept).toBe('시원하고 청량한 여름 분위기')
    const form = calls[0]!.init.body as FormData
    expect(String(form.get('prompt'))).toContain('시원하고 청량한 여름 분위기')
  }, 25000)

  it('shows the planner note read-only, under its own name', async () => {
    await openStudio()
    const note = screen.getByRole('region', { name: '기획서 전달사항' })
    expect(note.textContent).toContain('메인 문구를 가장 크게 잡아 주세요.')
    expect(within(note).queryAllByRole('textbox')).toHaveLength(0)
  }, 25000)

  it('hides the planner note entirely when the planner left none', async () => {
    const doc = sampleDoc()
    doc.project.designerNote = ''
    let job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
    job = linkProductImage(job, 'blk_i1', 'asset_p1')
    await saveStudioJob(job)
    await openStudio()
    expect(screen.queryByRole('region', { name: '기획서 전달사항' })).toBeNull()
    expect(screen.queryByRole('region', { name: '작성자가 전달한 말' })).toBeNull()
    expect(document.querySelectorAll('.concept--readonly')).toHaveLength(0)
    // 편집할 메모는 그대로 하나 있다.
    expect(screen.getByLabelText('AI에게 추가로 전달할 말')).toBeTruthy()
  }, 25000)

  it('leaves exactly one editable note, worded for this job', async () => {
    await openStudio()
    const left = document.querySelector('.side-left')!
    const boxes = within(left as HTMLElement).getAllByRole('textbox')
    expect(boxes).toHaveLength(1)
    expect(screen.getByLabelText('AI에게 추가로 전달할 말')).toBe(boxes[0])
    expect(left.textContent).toContain('현재 작업에서 AI가 추가로 지켜야 할 내용을 적어 주세요.')
  }, 25000)
})

// ── 우측: 지금 무엇을 할 차례인가 ────────────────────────────────────────────

describe('§3 작업판 우측은 지금 할 일만 말한다', () => {
  it('drops the generic block help from the studio', async () => {
    await openStudio()
    // 블록을 골라도 — 도움말이 나오던 바로 그 상태에서도 — 없어야 한다.
    fireEvent.click(document.querySelectorAll('.block-card')[0]!)
    const right = document.querySelector('.side-right')!
    expect(right.querySelector('.inspector')).toBeNull()
    expect(right.textContent).not.toContain('사진을 넣거나 들어갈 자리를 적습니다')
    expect(right.textContent).not.toContain('더블클릭하면')
    expect(right.textContent).not.toContain('복제·삭제는')
  }, 25000)

  it('reports readiness before anything has been generated', async () => {
    await openStudio()
    const ready = screen.getByRole('region', { name: '생성 준비' })
    expect(ready.textContent).toContain('1페이지')
    expect(ready.textContent).toContain('연결 1 / 전체 1')
    expect(ready.textContent).toContain('API 키')
  }, 25000)

  it('names the exact number of unlinked image slots', async () => {
    const doc = sampleDoc()
    const job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
    await saveStudioJob(job) // 연결 0건
    await openStudio()
    const ready = screen.getByRole('region', { name: '생성 준비' })
    expect(ready.textContent).toContain('연결 0 / 전체 1')
    expect(ready.textContent).toMatch(/연결되지 않은 자리가 1개/)
  }, 25000)

  it('replaces readiness with the edit panel once a result exists', async () => {
    await openStudio()
    await generateHere()
    expect(screen.queryByRole('region', { name: '생성 준비' })).toBeNull()
    expect(screen.getByRole('region', { name: 'AI 부분수정' })).toBeTruthy()
    expect(document.querySelector('.side-right .inspector')).toBeNull()
  }, 25000)
})

// ── 상단: 자주 누르는 것과 가끔 누르는 것 ────────────────────────────────────

describe('§4 상단은 이미지 만드는 일만 앞에 둔다', () => {
  it('hides the internal summary and request preview from the studio', async () => {
    await openStudio()
    expect(screen.queryByRole('button', { name: 'AI 요약' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'AI 제작 요청 미리보기' })).toBeNull()
  }, 25000)

  it('calls the file button what it opens', async () => {
    await openStudio()
    expect(screen.getByRole('button', { name: '기획서 불러오기' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '파일 불러오기' })).toBeNull()
  }, 25000)

  it('keeps only the irreversible action in 작업 메뉴', async () => {
    // 되돌릴 수 없는 일만 메뉴에 남는다 (작업 잃지 않기 Patch). 작업 파일 저장은
    // 바로 나갔다 — 잃지 않는 길을 메뉴 안에 숨기면 사람은 그것을 찾지 못한다.
    await openStudio()
    expect(screen.queryByRole('button', { name: 'Studio 작업 초기화' })).toBeNull()
    openMenu()
    expect(screen.getByRole('button', { name: 'Studio 작업 초기화' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Studio 작업 파일 저장/ })).toBeNull()
  }, 25000)

  it('opens the .eventbrief save straight from the bar', async () => {
    // 패키징 자체는 브라우저의 일이다 (jsdom·fake-indexeddb 를 오간 Blob 은
    // 바이트를 돌려주지 않아 ZIP 을 만들 수 없다). 여기서 지키는 것은 배선 —
    // 바의 버튼이 기존 저장 흐름을 그대로 연다는 것이다.
    await openStudio()
    fireEvent.click(screen.getByRole('button', { name: '작업 파일 저장' }))
    const dialog = await screen.findByRole('dialog', { name: '기획서 파일로 저장' })
    expect((within(dialog).getByLabelText('파일명') as HTMLInputElement).value).toBe('아크웨이브 여름감사제')
    expect(within(dialog).getByText('.eventbrief')).toBeTruthy()
  }, 25000)

  it('offers both saves in the bar, each named for what it produces', async () => {
    await openStudio()
    expect(screen.getByRole('button', { name: '작업 파일 저장' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '이미지 저장' })).toBeTruthy()
    // 작업판에서 "파일로 저장"은 어느 파일인지 말하지 않는 이름이라 쓰지 않는다.
    expect(screen.queryByRole('button', { name: '파일로 저장' })).toBeNull()
  }, 25000)
})

// ── 이미지 저장 ──────────────────────────────────────────────────────────────

describe('§5 이미지 저장은 진짜 결과를 내놓는다', () => {
  it('names one page after the brief and its page number', () => {
    expect(pageImageFileName('아크웨이브 여름감사제', 1)).toBe('아크웨이브_여름감사제_page-01.png')
    expect(pageImageFileName('아크웨이브 여름감사제', 12)).toBe('아크웨이브_여름감사제_page-12.png')
    expect(imageZipFileName('아크웨이브 여름감사제')).toBe('아크웨이브_여름감사제_images.zip')
  })

  it('replaces characters Windows refuses', () => {
    expect(pageImageFileName('50%↓ 여름/특가 <필독>', 1)).toBe('50%↓_여름_특가_필독_page-01.png')
  })

  it('plans nothing when no page has a result', async () => {
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const plan = planImageSave(job.doc, job)
    expect(plan.files).toHaveLength(0)
    expect(plan.totalPages).toBe(2)
  })

  it('says so and saves nothing when there is no result yet', async () => {
    await openStudio()
    fireEvent.click(screen.getByRole('button', { name: '이미지 저장' }))
    await waitFor(() => expect(screen.getByRole('alertdialog', { name: '저장할 이미지 없음' })).toBeTruthy())
    expect(downloads).toHaveLength(0)
    expect(calls).toHaveLength(0)
  }, 25000)

  it('downloads one PNG when one page has a result', async () => {
    await useOnePageBrief()
    await openStudio()
    await generateHere()
    const before = calls.length
    fireEvent.click(screen.getByRole('button', { name: '이미지 저장' }))
    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 8000 })
    expect(downloads[0]!.fileName).toBe('아크웨이브_여름감사제_page-01.png')
    expect(downloads[0]!.fileName.endsWith('.eventbrief')).toBe(false)
    expect(calls).toHaveLength(before) // 저장에는 외부 호출이 없다
  }, 25000)

  it('points at the 840 working asset, not the model original', async () => {
    await useOnePageBrief()
    await openStudio()
    await generateHere()
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const result = job.results[job.doc.pages[0]!.id]!
    // 모델 규격과 작업본 규격은 다른 값이고, 저장이 가리키는 것은 작업본이다.
    expect(result.requestedSize).toBe('832x1472')
    expect(result.workingSize).toBe('840x1488')
    expect(await getAsset(result.assetId)).toBeTruthy()
    const plan = planImageSave(job.doc, job)
    expect(plan.files.map((f) => f.assetId)).toEqual([result.assetId])
  }, 25000)

  it('asks first when only some pages have results', async () => {
    await openStudio()
    await generateHere()
    fireEvent.click(screen.getByRole('button', { name: '이미지 저장' }))
    const dialog = await screen.findByRole('dialog', { name: '일부 페이지만 저장' })
    expect(dialog.textContent).toContain('2페이지 중 생성 결과가 있는 1페이지만 저장합니다')
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(downloads).toHaveLength(0)
  }, 25000)

  it('plans two files in page order once both pages have results', async () => {
    await openStudio()
    await generateHere()
    fireEvent.click(screen.getByRole('button', { name: '2페이지' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '이미지 생성하기' })).toBeTruthy(), { timeout: 8000 })
    await generateHere(1)

    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const plan = planImageSave(job.doc, job)
    expect(plan.files.map((f) => f.fileName)).toEqual([
      '아크웨이브_여름감사제_page-01.png',
      '아크웨이브_여름감사제_page-02.png',
    ])
    expect(isPartialSave(plan)).toBe(false)

    // 전부 있으면 묻지 않는다 — 바로 한 묶음으로 나간다.
    fireEvent.click(screen.getByRole('button', { name: '이미지 저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '일부 페이지만 저장' })).toBeNull())
    expect(calls.every((c) => !c.url.includes('openai'))).toBe(true)
  }, 30000)

  it('packs the files into one ZIP under the brief name', async () => {
    // ZIP 자체는 순수 서비스로 확인한다. 저장소를 오간 Blob 은 jsdom 에서
    // 바이트를 돌려주지 않으므로, 실제 파일은 브라우저 인수검사에서 연다.
    const files = [
      { fileName: '아크웨이브_여름감사제_page-01.png', blob: new Blob(['one'], { type: 'image/png' }) },
      { fileName: '아크웨이브_여름감사제_page-02.png', blob: new Blob(['two'], { type: 'image/png' }) },
    ]
    const packed = await zipSavedImages(files)
    const zip = await JSZip.loadAsync(packed)
    expect(Object.keys(zip.files).sort()).toEqual([
      '아크웨이브_여름감사제_page-01.png',
      '아크웨이브_여름감사제_page-02.png',
    ])
    expect(await zip.file('아크웨이브_여름감사제_page-02.png')!.async('string')).toBe('two')
  }, 25000)
})

// ── 페이지별 결과 ────────────────────────────────────────────────────────────

describe('§5.5 페이지마다 자기 결과와 자기 이력을 갖는다', () => {
  it('does not let one page overwrite the other', async () => {
    await openStudio()
    await generateHere()
    const job1 = (await loadStudioJob(STUDIO_JOB_ID))!
    const first = job1.results[job1.doc.pages[0]!.id]!.assetId

    fireEvent.click(screen.getByRole('button', { name: '2페이지' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '이미지 생성하기' })).toBeTruthy(), { timeout: 8000 })
    await generateHere(1)

    const job2 = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(job2.results[job2.doc.pages[0]!.id]!.assetId).toBe(first)
    expect(job2.results[job2.doc.pages[1]!.id]!.assetId).not.toBe(first)
  }, 30000)

  it('keeps each page on its own cursor', async () => {
    await openStudio()
    await generateHere()
    fireEvent.click(screen.getByRole('button', { name: '2페이지' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '이미지 생성하기' })).toBeTruthy(), { timeout: 8000 })
    await generateHere(1)

    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    for (const page of job.doc.pages) {
      const r = job.results[page.id]!
      expect(revisionsOf(r)).toHaveLength(1)
      expect(cursorOf(r)).toBe(0)
    }
  }, 30000)

  it('keeps every page revision safe from the sweep', async () => {
    await openStudio()
    await generateHere()
    fireEvent.click(screen.getByRole('button', { name: '2페이지' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '이미지 생성하기' })).toBeTruthy(), { timeout: 8000 })
    await generateHere(1)

    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const live = new Set(await allStudioAssetIds())
    for (const page of job.doc.pages) {
      for (const rev of revisionsOf(job.results[page.id]!)) expect(live.has(rev.assetId)).toBe(true)
    }
  }, 30000)
})
