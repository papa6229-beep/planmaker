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
import { resetAccessModeForTests } from '../features/studio/apiKeySession'
import { resetOriginalViewForTests } from '../features/studio/originalView'
import { resetBackgroundLabForTests } from '../features/studio/useBackgroundLab'
import { resetDesignToolsForTests } from '../features/studio/designTools'
import { saveApiKey } from '../features/studio/apiKeySession'
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
import { createStudioJob, linkProductImage, withSource, withWorkingDoc, revisionsOf, cursorOf } from '../domain/studioJob'
import { createEmptyDocument, createPage } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import JSZip from 'jszip'
import { imageZipFileName, isPartialSave, pageImageFileName, planImageSave } from '../domain/imageSaveFile'
import { zipSavedImages } from '../services/imageSave'
import type { BriefDocument } from '../domain/pageSchema'

/**
 * 접힌 칸을 편다 (왼쪽 정리 Patch).
 *
 * 메모 칸들은 기본이 접힘이다 — 펼쳐진 셋의 높이가 `무엇을 넣을까요?`를 화면 밖으로
 * 밀어냈기 때문이다. 접힌 칸은 내용을 **아예 그리지 않으므로**, 안을 만지려면 먼저
 * 펴야 한다. 이미 펴져 있으면 그대로 둔다.
 */
function openFoldNamed(title: string): void {
  const head = screen.queryAllByRole('button').find((b) => (b.textContent ?? '').includes(title))
  if (head !== undefined && head.getAttribute('aria-expanded') === 'false') fireEvent.click(head)
}


vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 640, height: 640 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: 'image/png' }),
}))

// ── 겹 방식이 지나는 캔버스 자리들 (컷아웃 갈림길 교정) ──────────────────────
//
// 이 검사들은 예전에 **통이미지 한 장** 경로로만 돌았다. 갈림길이 컷아웃에서
// 풀리면서 이제 겹 방식으로 지나가는데, 그 길은 브라우저 캔버스를 여러 번 쓴다.
// jsdom에는 2D 캔버스가 없고 그림이 디코딩되지도 않아, 진짜 함수를 부르면 영영
// 기다린다. 규칙은 각자의 순수 검사에서 숫자로 재고, 여기서는 흐름만 본다.
vi.mock('../services/referenceUpload', () => ({
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
  analyzeImageBlob: async () => null,
}))
vi.mock('../services/textLayerKey', () => ({
  removeKeyBackground: async (blob: Blob) => ({ blob, opaqueRatio: 0.2 }),
}))
vi.mock('../services/trimToContent', () => ({
  trimToContent: async (blob: Blob) => ({ blob, width: 400, height: 100 }),
}))
vi.mock('../services/regionTone', () => ({
  REGION_MAX_SIDE: 512,
  analyzeRegions: async (_blob: Blob, rects: unknown[]) => rects.map(() => null),
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
  // 앞 검사가 물어 둔 갈래가 새지 않게 한다 (서버 키 Patch).
  resetAccessModeForTests()
  downloads = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  // 갈래 묻기(`/api/access-mode`)는 **우리 함수**이고 값이 붙지 않는다 (서버 키
  // Patch). 아래 계수는 "공급자를 몇 번 불렀는가"를 재는 자리이므로 여기서
  // 걸러 낸다 — 세면 모든 검사가 한 건씩 밀린다.
    if (String(input).includes('/api/access-mode')) {
      return new Response(JSON.stringify({ mode: 'client-key' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
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
  // 저장과 화면 전환은 다른 순간이다 (컷아웃 갈림길 교정) — 겹 방식은 저장한 뒤
  // 조각까지 적고 나서 완성본으로 넘어간다.
  await waitFor(() => expect(screen.getByRole('region', { name: 'AI 부분수정' })).toBeTruthy(), {
    timeout: 8000,
  })
  return assetId!
}

const menuButton = () => screen.getByRole('button', { name: '작업 메뉴' })
const openMenu = () => fireEvent.click(menuButton())

// ── 좌측: 무엇을 지우고 무엇을 남기는가 ──────────────────────────────────────

describe('§2 작업판 좌측은 편집할 것 하나만 남긴다', () => {
  /**
   * 규칙이 바뀐 것이 아니라 **좁아졌다** (전달 누락 Patch).
   *
   * 원래 지키려던 것은 "작업판에서 편집하는 지시 입력창은 하나뿐"이다. 그런데
   * 앞선 판은 그것을 "컨셉이라는 말이 화면에 아예 없다"로 지켰고, 그 바람에
   * 기획서가 적어 보낸 컨셉을 **AI는 읽는데 사람은 못 읽는** 상태가 됐다.
   * 이제 읽기 전용으로는 오되, 고칠 수 있는 칸은 여전히 하나뿐이다.
   */
  it('lets the planner concept arrive, but never as a second editable field', async () => {
    await openStudio()
    // 온다 — 읽을 수 있다.
    const mood = screen.getByRole('region', { name: '원하는 분위기·컨셉' })
    expect(mood.textContent).toContain('시원하고 청량한 여름 분위기')
    // 그러나 고칠 수는 없다.
    expect(within(mood).queryAllByRole('textbox')).toHaveLength(0)
    // 작업판에서 편집하는 지시 입력창은 여전히 이것 하나뿐이다.
    expect(document.querySelectorAll('.side-left textarea')).toHaveLength(1)
    expect(screen.getByLabelText('AI에게 추가로 전달할 말')).toBeTruthy()
  }, 25000)

  it('keeps the concept field on the writer surface', async () => {
    await openWriter()
    expect((openFoldNamed('원하는 분위기·컨셉'), screen.getByLabelText('원하는 분위기·컨셉'))).toBeTruthy()
  }, 25000)

  it('keeps the concept in the document and in the generation request', async () => {
    await openStudio()
    await generateHere()
    const job = await loadStudioJob(STUDIO_JOB_ID)
    expect(job!.doc.project.concept).toBe('시원하고 청량한 여름 분위기')
    // 겹 방식은 한 장을 여러 번에 나눠 만든다 (컷아웃 갈림길 교정). 컨셉이 어느
    // 요청에 실리는지는 그 나눔의 사정이고, 여기서 지켜야 할 것은 **모델에게
    // 닿는가**다 — 한 요청도 빠짐없이 뒤져서 찾는다.
    const prompts = calls.map((c) => String((c.init.body as FormData).get('prompt')))
    expect(prompts.join('\n')).toContain('시원하고 청량한 여름 분위기')
  }, 25000)

  it('shows the planner note read-only, under its own name', async () => {
    await openStudio()
    const note = screen.getByRole('region', { name: '기획서 전달사항' })
    expect(note.textContent).toContain('메인 문구를 가장 크게 잡아 주세요.')
    expect(within(note).queryAllByRole('textbox')).toHaveLength(0)
  }, 25000)

  it('shows only what actually came — the empty half leaves no room behind', async () => {
    const doc = sampleDoc()
    doc.project.designerNote = ''
    let job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
    job = linkProductImage(job, 'blk_i1', 'asset_p1')
    await saveStudioJob(job)
    await openStudio()
    // 전달사항은 비었으므로 그 자리는 아예 없다. 컨셉은 왔으므로 남는다.
    expect(screen.queryByRole('region', { name: '기획서 전달사항' })).toBeNull()
    expect(screen.getByRole('region', { name: '원하는 분위기·컨셉' })).toBeTruthy()
    expect(document.querySelectorAll('.concept--readonly')).toHaveLength(1)
  }, 25000)

  it('hides the whole panel when the planner left nothing at all', async () => {
    const doc = sampleDoc()
    doc.project.designerNote = ''
    doc.project.concept = ''
    let job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
    job = linkProductImage(job, 'blk_i1', 'asset_p1')
    await saveStudioJob(job)
    await openStudio()
    expect(screen.queryByRole('button', { name: /기획서에서 온 말/ })).toBeNull()
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
    // 레퍼런스에 대한 말이라 레퍼런스 칸 안에 선다. 긴 설명은 없다 (왼쪽 칸 정리).
    expect(boxes[0]!.closest('[aria-label="디자인 스타일 레퍼런스"]')).not.toBeNull()
    expect(left.textContent).not.toContain('현재 작업에서 AI가 추가로 지켜야 할 내용을 적어 주세요.')
    expect(left.textContent).not.toContain('이미지에 인쇄되지 않습니다')
  }, 25000)
})

// ── 우측: 지금 무엇을 할 차례인가 ────────────────────────────────────────────

describe('§3 작업판 도구 칸은 지금 할 일만 말한다', () => {
  it('drops the generic block help from the studio', async () => {
    await openStudio()
    // 블록을 골라도 — 도움말이 나오던 바로 그 상태에서도 — 없어야 한다.
    fireEvent.click(document.querySelectorAll('.block-card')[0]!)
    // 우측 칸은 없다 (우측 패널 정리, 2026-09-17) — 옛 우측 도구는 도구 칸 아래에 선다.
    expect(document.querySelector('.side-right')).toBeNull()
    const right = document.querySelector('.studio-rail__more')!
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
    expect(document.querySelector('.inspector')).toBeNull()
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

  it('상단 바에는 작업 전부를 담는 저장 하나만 있다', async () => {
    // 이미지 저장은 **지금 고른 것 하나**를 내놓는다. 고르는 자리인 `작업 목록`
    // 옆으로 내려갔다 (작업 목록 Patch). 한 가지 일에 들어가는 문은 하나면 충분하다.
    await openStudio()
    expect(screen.getByRole('button', { name: '작업 파일 저장' })).toBeTruthy()
    const bar = document.querySelector('.editor-topbar') as HTMLElement
    expect(bar.textContent).not.toContain('이미지 저장')
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

  it('깜빡임을 켠 페이지는 그 GIF를 가리킨다', async () => {
    // 저장하는 길은 하나여야 한다 (깜빡이는 버튼 Patch). 켠 페이지의 완성본은
    // 그 GIF이고, `이 이미지 저장`·`전부 저장`이 그것을 그대로 가져간다.
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const pageId = job.doc.pages[0]!.id
    const withResult = {
      ...job,
      results: {
        [pageId]: {
          pageId,
          assetId: 'asset_png',
          model: 'gpt-image-2' as const,
          quality: 'medium' as const,
          requestedSize: '832x1104',
          sourceFingerprint: 'x',
          createdAt: 1,
        },
      },
      blink: { [pageId]: { strength: 0.25, assetId: 'asset_gif' } },
    }
    const plan = planImageSave(withResult.doc, withResult)
    expect(plan.files[0]!.assetId).toBe('asset_gif')
    expect(plan.files[0]!.fileName.endsWith('.gif')).toBe(true)

    // 끄면 지금까지 그대로다.
    const off = planImageSave(withResult.doc, { ...withResult, blink: {} })
    expect(off.files[0]!.assetId).toBe('asset_png')
    expect(off.files[0]!.fileName.endsWith('.png')).toBe(true)
  })

  it('plans nothing when no page has a result', async () => {
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const plan = planImageSave(job.doc, job)
    expect(plan.files).toHaveLength(0)
    expect(plan.totalPages).toBe(2)
  })

  it('만든 것이 없으면 저장 버튼도 없다', async () => {
    // 앞선 판은 버튼을 두고 눌렀을 때 "저장할 이미지가 없습니다"라고 말했다.
    // 이제 저장은 작업 목록 옆에 있고, 목록이 비어 있으면 줄 자체가 없다 —
    // 없는 것을 눌러 보고 안 되는 것보다 애초에 없는 편이 낫다.
    await openStudio()
    expect(screen.queryByRole('button', { name: '이 이미지 저장' })).toBeNull()
    expect(screen.queryByRole('group', { name: '작업 목록' })).toBeNull()
    expect(downloads).toHaveLength(0)
    expect(calls).toHaveLength(0)
  }, 25000)

  it('downloads one PNG when one page has a result', async () => {
    await useOnePageBrief()
    await openStudio()
    await generateHere()
    const before = calls.length
    fireEvent.click(screen.getByRole('button', { name: '이 이미지 저장' }))
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
    fireEvent.click(screen.getByRole('button', { name: '이 이미지 저장' }))
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
    fireEvent.click(screen.getByRole('button', { name: '이 이미지 저장' }))
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

// ── 우측 패널 정리 (2026-09-17) ─────────────────────────────────────────────

describe('§3-2 작업판에는 우측 칸이 없고, 왼쪽 칸은 접힌다', () => {
  it('keeps the partial-edit panel off the real screen (tests switch it on)', async () => {
    const actual = await vi.importActual<typeof import('./studioScreen')>('./studioScreen')
    expect(actual.SHOW_PARTIAL_EDIT).toBe(false)
  })

  it('folds the far-left column and remembers it in this browser', async () => {
    localStorage.removeItem('planmaker.studio.leftFolded')
    await openStudio()
    const main = document.querySelector('main.workspace')!
    expect(main.classList.contains('workspace--studio')).toBe(true)
    expect(main.classList.contains('is-left-folded')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '◀ 왼쪽 칸 접기' }))
    expect(main.classList.contains('is-left-folded')).toBe(true)
    expect(localStorage.getItem('planmaker.studio.leftFolded')).toBe('1')
    // 접어도 안의 것은 그대로 살아 있다 — 다시 펴면 같은 자리.
    expect(document.querySelector('.side-left')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '▶ 왼쪽 칸 펴기' }))
    expect(main.classList.contains('is-left-folded')).toBe(false)
    expect(localStorage.getItem('planmaker.studio.leftFolded')).toBe('0')
  }, 25000)

  it('puts the old right-hand tools under the rail, and side-by-side fits both to width', async () => {
    await openStudio()
    await generateHere()
    expect(document.querySelector('.side-right')).toBeNull()
    const more = document.querySelector('.studio-rail__more') as HTMLElement
    expect(within(more).getByRole('region', { name: 'AI 부분수정' })).toBeTruthy()
    expect(within(more).getByRole('button', { name: /결과 톤 조절/ })).toBeTruthy()

    const fitPage = screen.getByRole('button', { name: '전체 보기' })
    const fitWidth = screen.getByRole('button', { name: '폭 맞춤' })
    expect(fitPage.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '작업 캔버스 나란히 보기' }))
    expect(screen.getByRole('region', { name: '기획서 작업본' })).toBeTruthy()
    expect(fitWidth.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '작업 캔버스 나란히 보기' }))
    expect(screen.queryByRole('region', { name: '기획서 작업본' })).toBeNull()
    expect(fitPage.getAttribute('aria-pressed')).toBe('true')
  }, 25000)
})

// ── 원본 기획서 보기 (2026-09-17) ───────────────────────────────────────────

describe('§3-3 받은 기획서를 옆에 세우거나 겹쳐 본다 — 생성 전에도', () => {
  beforeEach(async () => {
    resetOriginalViewForTests()
    // 원본은 받은 그대로, 작업본은 문구를 고친 상태.
    const job = readyJob()
    const working = structuredClone(job.doc)
    working.pages[0]!.blocks[0]!.content = '고친 문구'
    await saveStudioJob(withWorkingDoc(job, working, 2))
  })

  it('shows the original page read-only beside the canvas, not the edited one', async () => {
    await openStudio()
    const controls = await screen.findByRole('region', { name: '원본 기획서 보기' })
    expect(screen.queryByRole('region', { name: '원본 기획서' })).toBeNull()
    fireEvent.click(within(controls).getByRole('button', { name: '나란히 보기' }))
    const pane = screen.getByRole('region', { name: '원본 기획서' })
    expect(pane.textContent).toContain('여름 감사제')
    expect(pane.textContent).not.toContain('고친 문구')
    expect(pane.querySelector('.block-card')).toBeNull() // 잡을 수 있는 카드가 아니다
    // 작업 캔버스는 그대로 옆에 있다.
    expect(document.querySelector('.stage .canvas__sheet')).not.toBeNull()
    fireEvent.click(within(controls).getByRole('button', { name: '나란히 보기' }))
    expect(screen.queryByRole('region', { name: '원본 기획서' })).toBeNull()
  }, 25000)

  it('lays the original over the canvas with adjustable opacity, behind or in front', async () => {
    await openStudio()
    const controls = await screen.findByRole('region', { name: '원본 기획서 보기' })
    expect(document.querySelector('.canvas__sheet .orig-overlay')).toBeNull()
    fireEvent.click(within(controls).getByRole('button', { name: '겹쳐 보기' }))
    const overlay = () => document.querySelector<HTMLElement>('.canvas__sheet .orig-overlay')!
    expect(overlay().style.opacity).toBe('0.4')
    expect(overlay().textContent).toContain('여름 감사제')
    fireEvent.change(within(controls).getByLabelText('원본 겹쳐 보기 불투명도'), { target: { value: '70' } })
    expect(overlay().style.opacity).toBe('0.7')
    expect(overlay().classList.contains('orig-overlay--front')).toBe(false)
    fireEvent.click(within(controls).getByRole('checkbox', { name: '블록 앞에' }))
    expect(overlay().classList.contains('orig-overlay--front')).toBe(true)
    // 캔버스의 블록 수는 그대로 — 겹친 원본은 블록이 아니다.
    expect(document.querySelectorAll('.canvas__sheet .block-card')).toHaveLength(2)
  }, 25000)

  it('keeps the overlay on the result too, scaled with it', async () => {
    await openStudio()
    fireEvent.click(within(await screen.findByRole('region', { name: '원본 기획서 보기' })).getByRole('button', { name: '겹쳐 보기' }))
    await generateHere()
    const overlay = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.compare__stage .orig-overlay')
      expect(el).not.toBeNull()
      return el!
    })
    expect(overlay.style.transform === '' || overlay.style.transform.startsWith('scale(')).toBe(true)
  }, 25000)

  it('says so when the page was added during work', async () => {
    await openStudio()
    fireEvent.click(within(await screen.findByRole('region', { name: '원본 기획서 보기' })).getByRole('button', { name: '나란히 보기' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 페이지 추가' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: '원본 기획서' }).textContent).toContain('원본 기획서에 없습니다'),
    )
  }, 25000)
})

// ── 막대 한 줄 · 왼쪽 칸 정리 (2026-09-17) ───────────────────────────────────

describe('§3-4 도구 막대는 캔버스 위 한 줄, 설정 창은 세로 칸에', () => {
  it('keeps the refine button off the real screen (tests switch it on)', async () => {
    const actual = await vi.importActual<typeof import('./studioScreen')>('./studioScreen')
    expect(actual.SHOW_REFINE_NOTE).toBe(false)
  })

  it('puts the bar and the magnifier above the canvas, opened menus in the rail', async () => {
    await openStudio()
    const bar = await screen.findByRole('toolbar', { name: '디자인 도구' })
    expect(bar.closest('.studio-topbar')).not.toBeNull()
    expect(bar.closest('.studio-rail')).toBeNull()
    expect(document.querySelector('.studio-topbar .studio-zoom')).not.toBeNull()

    const card = document.querySelector<HTMLElement>('.canvas__sheet .block-card[aria-label^="문구"]')
      ?? document.querySelectorAll<HTMLElement>('.canvas__sheet .block-card')[0]!
    fireEvent.pointerDown(card, { button: 0 })
    fireEvent.pointerUp(window)
    const border = await within(bar).findByRole('button', { name: '테두리' }, { timeout: 5000 })
    fireEvent.click(border)
    const menu = screen.getByRole('dialog', { name: '테두리' })
    expect(menu.closest('.design-dock')).not.toBeNull()
    // 캔버스 빈 곳을 눌러도 닫히지 않는다 — 열어 둔 채 조절한다.
    fireEvent.mouseDown(document.body)
    expect(screen.getByRole('dialog', { name: '테두리' })).toBeTruthy()
    fireEvent.click(within(menu).getByRole('button', { name: '테두리 닫기' }))
    expect(screen.queryByRole('dialog', { name: '테두리' })).toBeNull()
  }, 25000)
})

// ── 배경 후보 (2026-09-17) ──────────────────────────────────────────────────

describe('§3-5 배경 후보 — 제품을 보고 만들고, 제품을 지워 쌓고, 적용할 때만 바꾼다', () => {
  // 페이지 id는 만들 때마다 새로 뽑힌다 — 저장한 작업의 것을 쓴다.
  let pageId = ''
  const PAGE = () => pageId
  const sentForm = (i: number) => calls[i]!.init.body as FormData
  const names = (form: FormData) => form.getAll('images[]').map((f) => (f as File).name)

  beforeEach(async () => {
    resetBackgroundLabForTests()
    // 이미 깔린 배경이 있는 페이지 — 적용하면 이것이 후보로 밀려나야 한다.
    await putAsset(storedAsset('asset_bg_old', 9))
    const job = readyJob()
    pageId = job.doc.pages[0]!.id
    await saveStudioJob({ ...job, backgrounds: { [pageId]: { assetId: 'asset_bg_old', source: 'manual' } } })
    saveApiKey(KEY)
  })

  // 작업판은 막 열린 뒤 한 번 다시 그려진다 — 칸을 붙들지 않고 매번 새로 찾는다.
  const lab = () => screen.getByRole('region', { name: '배경 후보' })
  const panel = async () => {
    await waitFor(() => expect(lab().textContent).toContain('보여 줄 제품'))
  }

  it('makes one candidate with two calls: product scene, then product removal', async () => {
    await openStudio()
    await panel()
    expect(lab().textContent).toContain('보여 줄 제품: 1장')
    expect(lab().textContent).toContain('없음 — 제품만 보고 만듭니다')
    fireEvent.change(within(lab()).getByLabelText('배경 후보 요청'), { target: { value: '대리석 테이블 위' } })
    fireEvent.click(within(lab()).getByRole('button', { name: '후보 만들기' }))
    await waitFor(() => expect(within(lab()).getAllByRole('listitem')).toHaveLength(1), { timeout: 8000 })

    expect(calls).toHaveLength(2)
    expect(sentForm(0).get('intent')).toBe('scene')
    expect(sentForm(0).get('prompt')).toBe('대리석 테이블 위')
    expect(names(sentForm(0))).toEqual(['product-1.png'])
    expect(sentForm(1).get('intent')).toBe('scene-clean')
    expect(names(sentForm(1))).toEqual(['scene.png'])

    // 만들기만 했다 — 배경은 그대로다.
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(job.backgrounds?.[PAGE()]?.assetId).toBe('asset_bg_old')
    const cand = job.backgroundLabs?.[PAGE()]?.candidates ?? []
    expect(cand).toHaveLength(1)
    expect(cand[0]).toMatchObject({ note: '대리석 테이블 위', basis: 'none' })
  }, 25000)

  it('applies a candidate, keeps the old background as a candidate, and can swap back', async () => {
    await openStudio()
    await panel()
    fireEvent.click(within(lab()).getByRole('button', { name: '후보 만들기' }))
    await waitFor(() => expect(within(lab()).getAllByRole('listitem')).toHaveLength(1), { timeout: 8000 })
    expect(calls).toHaveLength(2)
    expect(sentForm(0).get('prompt')).toBe('제품과 어울리는 배경') // 비워 두면 기본 말

    fireEvent.click(within(lab()).getByRole('button', { name: '제품만 적용' }))
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const candidates = job.backgroundLabs?.[PAGE()]?.candidates ?? []
      expect(job.backgrounds?.[PAGE()]?.assetId).toBe(candidates.find((c) => c.basis === 'none')?.assetId)
      expect(candidates.find((c) => c.basis === 'previous')?.assetId).toBe('asset_bg_old')
    })
    expect(within(lab()).getByText('적용 중')).toBeTruthy()
    expect(calls).toHaveLength(2) // 적용은 AI를 부르지 않는다

    fireEvent.click(await within(lab()).findByRole('button', { name: '이전 배경 적용' }))
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      expect(job.backgrounds?.[PAGE()]?.assetId).toBe('asset_bg_old')
      // 방금 밀려난 후보는 이미 목록에 있으므로 겹쳐 쌓이지 않는다.
      expect(job.backgroundLabs?.[PAGE()]?.candidates).toHaveLength(2)
    })
  }, 25000)

  it('sends an attached picture as the mood image, else the style reference', async () => {
    await putAsset(storedAsset('asset_style', 7))
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    await saveStudioJob({ ...job, styleRefs: { [PAGE()]: 'asset_style' } })
    await openStudio()
    await panel()
    expect(lab().textContent).toContain('스타일 레퍼런스')
    fireEvent.click(within(lab()).getByRole('button', { name: '후보 만들기' }))
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 8000 })
    expect(names(sentForm(0))).toEqual(['product-1.png', 'scene-reference.png'])
    await waitFor(() => expect(within(lab()).getAllByRole('listitem')).toHaveLength(1))

    const file = new File([new Uint8Array([137, 80, 78, 71, 3])], 'mood.png', { type: 'image/png' })
    fireEvent.change(within(lab()).getByLabelText('배경 후보 분위기 그림 첨부'), { target: { files: [file] } })
    await waitFor(() => expect(lab().textContent).toContain('첨부 그림'))
    fireEvent.click(within(lab()).getByRole('button', { name: '후보 만들기' }))
    await waitFor(() => expect(calls).toHaveLength(4), { timeout: 8000 })
    expect(names(sentForm(2))).toEqual(['product-1.png', 'scene-reference.png'])
    await waitFor(async () => {
      const saved = (await loadStudioJob(STUDIO_JOB_ID))!.backgroundLabs?.[PAGE()]
      // 첨부한 그림은 새 자산이다 — 스타일 레퍼런스와 다른 것이 나갔다.
      expect(saved?.referenceAssetId).toBeDefined()
      expect(saved?.referenceAssetId).not.toBe('asset_style')
      expect(saved?.candidates.map((c) => c.basis)).toEqual(['attached', 'style'])
    })

    fireEvent.click(within(lab()).getByRole('button', { name: '첨부 빼기' }))
    await waitFor(() => expect(lab().textContent).toContain('스타일 레퍼런스'))
  }, 25000)

  it('refuses without a linked product', async () => {
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    await saveStudioJob({ ...job, productImages: {} })
    await openStudio()
    await panel()
    expect((within(lab()).getByRole('button', { name: '후보 만들기' }) as HTMLButtonElement).disabled).toBe(true)
    expect(lab().textContent).toContain('이미지 블록에 실제 제품 이미지를 연결하면')
    expect(calls).toHaveLength(0)
  }, 25000)

  it('keeps nothing when the removal call fails', async () => {
    const base = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body instanceof FormData ? init.body : null
      if (form?.get('intent') === 'scene-clean') {
        calls.push({ url: String(input), init: init ?? {} })
        return new Response(JSON.stringify({ error: { code: 'provider_timeout' } }), { status: 504 })
      }
      return base(input, init)
    }) as unknown as typeof fetch
    await openStudio()
    await panel()
    fireEvent.click(within(lab()).getByRole('button', { name: '후보 만들기' }))
    await waitFor(() => expect(within(lab()).getByRole('alert').textContent).toContain('제품을 지우지 못했습니다'), {
      timeout: 8000,
    })
    expect(within(lab()).queryAllByRole('listitem')).toHaveLength(0)
    expect((within(lab()).getByRole('button', { name: '후보 만들기' }) as HTMLButtonElement).disabled).toBe(false)
  }, 25000)
})

// ── 배경 크기·자리 (2026-09-17) ─────────────────────────────────────────────

describe('§3-6 이벤트 페이지 배경도 캔버스에서 옮기고 키운다', () => {
  let pageId = ''
  beforeEach(async () => {
    resetDesignToolsForTests()
    await putAsset(storedAsset('asset_bg_old', 9))
    const job = readyJob()
    pageId = job.doc.pages[0]!.id
    await saveStudioJob({ ...job, backgrounds: { [pageId]: { assetId: 'asset_bg_old', source: 'ai' } } })
  })
  afterEach(() => resetDesignToolsForTests())

  it('shows handles only while adjusting, saves the new box, and fits back to the canvas', async () => {
    await openStudio()
    // 배경이 있으면 작업판은 열자마자 완성본을 다시 합쳐 완성본 화면으로 간다 (자동 합치기).
    await waitFor(() => expect(document.querySelector('.compare__stage')).not.toBeNull(), { timeout: 8000 })
    const bg = () => screen.getByRole('region', { name: '배경' })
    const saved = async () => (await loadStudioJob(STUDIO_JOB_ID))!.backgrounds?.[pageId]
    const drag = (handle: Element, dx: number, dy: number) => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(window, { clientX: dx, clientY: dy })
      fireEvent.pointerUp(window)
    }
    const stage = () => document.querySelector<HTMLElement>('.compare__stage')!
    expect(screen.queryByRole('button', { name: '배경 옮기기' })).toBeNull()
    fireEvent.click(within(bg()).getByRole('button', { name: '크기·위치 조절' }))

    // 완성본 위에서 옮긴다.
    drag(await within(stage()).findByRole('button', { name: '배경 옮기기' }), 30, -40)
    await waitFor(async () => expect((await saved())?.rect).toMatchObject({ x: 30, y: -40, width: 840 }))

    // 옆에 세운 작업 캔버스에도 같은 자리로 그려지고, 거기서도 키울 수 있다.
    fireEvent.click(screen.getByRole('button', { name: '작업 캔버스 나란히 보기' }))
    const brief = await screen.findByRole('region', { name: '기획서 작업본' })
    await waitFor(() => expect(brief.querySelector<HTMLImageElement>('.canvas__background')!.style.left).toBe('30px'))
    drag(within(brief).getByRole('button', { name: '배경 크기 se' }), 100, 100)
    await waitFor(async () => expect((await saved())!.rect!.width).toBeGreaterThan(840))

    fireEvent.click(within(bg()).getByRole('button', { name: '캔버스에 맞추기' }))
    await waitFor(async () => {
      const now = await saved()
      expect(now?.assetId).toBe('asset_bg_old')
      expect(now?.rect).toBeUndefined()
    })
    fireEvent.click(within(bg()).getByRole('button', { name: '조절 끝내기' }))
    expect(screen.queryByRole('button', { name: '배경 옮기기' })).toBeNull()
  }, 25000)

  it('keeps the adjusted box when a candidate background is applied', async () => {
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    await putAsset(storedAsset('asset_cand', 4))
    await saveStudioJob({
      ...job,
      backgrounds: { [pageId]: { assetId: 'asset_bg_old', source: 'ai', rect: { x: -50, y: 0, width: 1000, height: 1600 } } },
      backgroundLabs: { [pageId]: { candidates: [{ id: 'c1', assetId: 'asset_cand', note: '바다', basis: 'none', createdAt: 1 }] } },
    })
    await openStudio()
    fireEvent.click(await screen.findByRole('button', { name: '바다 적용' }))
    await waitFor(async () => {
      const saved = (await loadStudioJob(STUDIO_JOB_ID))!.backgrounds?.[pageId]
      expect(saved?.assetId).toBe('asset_cand')
      expect(saved?.rect).toEqual({ x: -50, y: 0, width: 1000, height: 1600 })
    })
  }, 25000)
})

// ── 돋보기 (2026-09-17) ─────────────────────────────────────────────────────

describe('§3-7 돋보기 — 도구를 켜고 캔버스를 클릭하면 5% 확대, Alt+클릭 5% 축소', () => {
  afterEach(() => resetDesignToolsForTests())

  it('does nothing by itself; zooms where the canvas is clicked while on', async () => {
    resetDesignToolsForTests()
    await openStudio()
    const value = () => screen.getByRole('group', { name: '캔버스 배율' }).querySelector('.studio-zoom__value')!.textContent
    fireEvent.click(screen.getByRole('button', { name: '100%' }))
    await waitFor(() => expect(value()).toBe('100%'))
    const loupe = screen.getByRole('button', { name: '돋보기 (Z)' })
    fireEvent.click(loupe)
    // 단추를 누르는 것만으로는 배율이 그대로다 — 도구가 켜질 뿐.
    expect(loupe.getAttribute('aria-pressed')).toBe('true')
    expect(value()).toBe('100%')
    const sheet = () => document.querySelector<HTMLElement>('.canvas__sheet')!
    expect(sheet().classList.contains('is-zooming')).toBe(true)

    fireEvent.pointerDown(sheet(), { button: 0, clientX: 50, clientY: 50 })
    await waitFor(() => expect(value()).toBe('105%'))
    // 블록 위를 눌러도 블록이 아니라 캔버스가 받는다 (조각은 누름을 통과시킨다 — CSS).
    fireEvent.pointerDown(document.querySelector('.canvas')!, { button: 0, clientX: 5, clientY: 5 })
    await waitFor(() => expect(value()).toBe('110%'))
    fireEvent.pointerDown(sheet(), { button: 0, altKey: true })
    fireEvent.pointerDown(sheet(), { button: 0, altKey: true })
    fireEvent.pointerDown(sheet(), { button: 0, altKey: true })
    await waitFor(() => expect(value()).toBe('95%'))
    // 돋보기로 누른 것은 블록을 만들거나 고르지 않는다.
    expect(document.querySelectorAll('.canvas__sheet .block-card')).toHaveLength(2)

    // Esc로 끈다.
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('button', { name: '돋보기 (Z)' }).getAttribute('aria-pressed')).toBe('false'))
    fireEvent.pointerDown(sheet(), { button: 0 })
    expect(value()).toBe('95%')
    // Z로 켠다.
    fireEvent.keyDown(window, { key: 'z' })
    await waitFor(() => expect(screen.getByRole('button', { name: '돋보기 (Z)' }).getAttribute('aria-pressed')).toBe('true'))
  }, 25000)
})
