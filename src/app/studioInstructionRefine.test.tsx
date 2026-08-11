/**
 * AI 지시 다듬기 (실작업 UI 마감 §6–§11).
 *
 * 이것은 이미지를 만드는 기능이 아니다. 작업자가 던진 거친 말 — "좀 예쁘게",
 * "밋밋해" — 을 실행 가능한 지시로 바꾸는 **텍스트 요청 한 번**이다. 그래서 여기
 * 검사들이 지키는 것은 세 가지다.
 *
 *  1. 눌렀을 때만 나간다. 한 번 누르면 한 번. 이미지 모델은 부르지 않는다.
 *  2. 다듬은 결과가 사람의 글을 대신 덮어쓰지 않는다. 적용은 사람이 누른다.
 *  3. 대상이 여럿이어도 요청은 한 번이고, 대상별 제안이 섞이지 않는다.
 *
 * 다듬기는 정확도를 높이는 장치이지 보장이 아니다. 검사도 "무엇을 보냈고 무엇을
 * 어디에 적용했는가"까지만 본다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
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
  STUDIO_JOB_ID,
} from '../services/studioStore'
import { createStudioJob, linkProductImage, withSource, revisionsOf, cursorOf } from '../domain/studioJob'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import {
  REFINE_COST_NOTE,
  REFINE_INSTRUCTION_PATH,
  REFINE_MODEL,
  REFINE_REASONING_EFFORT,
  REFINE_SYSTEM_INSTRUCTION,
  REFINE_CALLS_PER_CLICK,
} from '../domain/instructionRefine'
import { GENERATE_IMAGE_PATH } from '../domain/imageGeneration'
import type { BriefDocument } from '../domain/pageSchema'

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

const KEY = 'sk-refine-abcdefghijklmnop-7788'
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

function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('여름 감사제'))
  doc.project.concept = '시원하고 청량하게'
  doc.project.designerNote = '메인 문구를 가장 크게 잡아 주세요.'
  const text = (id: string, content: string, y: number) =>
    createBlock('free_text', { id, content, position: { x: 100, y, width: 400, height: 90 } })
  const image = (id: string, content: string, y: number) =>
    createBlock('main_product_image', { id, content, position: { x: 100, y, width: 400, height: 200 } })
  doc.pages[0]!.blocks = [
    text('blk_t1', '08.01 ~ 08.31', 80),
    text('blk_t2', '신제품 출시', 220),
    text('blk_t3', '가장 먼저 만나는 새로운 경험!', 360),
    image('blk_i1', '대표 제품', 560),
  ]
  doc.pages[0]!.canvasHeight = 1488
  doc.assets = []
  return doc
}

function readyJob() {
  const doc = sampleDoc()
  let job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
  job = linkProductImage(job, 'blk_i1', 'asset_p1')
  return job
}

interface Call {
  url: string
  init: RequestInit
}
let calls: Call[] = []
let imageSeq = 0
/** 다듬기 응답을 검사마다 갈아 끼운다. */
let refineReply: (body: Record<string, unknown>) => Response

const refineCalls = () => calls.filter((c) => c.url.includes(REFINE_INSTRUCTION_PATH))
const imageCalls = () => calls.filter((c) => c.url.includes(GENERATE_IMAGE_PATH))
const lastRefineBody = (): Record<string, unknown> =>
  JSON.parse(String(refineCalls()[refineCalls().length - 1]!.init.body)) as Record<string, unknown>

function overallReply(text: string, warnings: string[] = []): Response {
  return new Response(JSON.stringify({ scope: 'overall', result: { revisedInstruction: text, warnings } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(async () => {
  calls = []
  imageSeq = 0
  refineReply = () => overallReply('다듬은 지시')
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })
    if (url.includes(REFINE_INSTRUCTION_PATH)) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return refineReply(body)
    }
    imageSeq += 1
    return new Response(
      JSON.stringify({
        image: { b64: b64For(imageSeq), mimeType: 'image/png' },
        metadata: { model: 'gpt-image-2', quality: 'medium', requestedSize: '832x1472', requestId: 'r' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

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
})

afterEach(() => cleanup())

async function openStudio(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('여름 감사제')
  }, { timeout: 8000 })
}

const aiNoteBox = () => screen.getByLabelText('AI에게 추가로 전달할 말') as HTMLTextAreaElement
const refineNoteButton = () => screen.getByRole('button', { name: 'AI로 지시 다듬기' }) as HTMLButtonElement

async function saveKeyByGenerating(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '이미지 생성하기' }))
  fireEvent.change(screen.getByLabelText('테스트용 OpenAI API 키'), { target: { value: KEY } })
  fireEvent.click(screen.getByRole('button', { name: '저장하고 계속' }))
  await waitFor(async () => {
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(job.results?.[job.doc.pages[0]!.id]).toBeTruthy()
  }, { timeout: 8000 })
  // 결과가 저장된 것과 화면이 완성본으로 넘어간 것은 다른 순간이다 (컷아웃 갈림길
  // 교정). 겹 방식은 저장한 뒤 조각까지 적고 나서 화면을 바꾼다.
  await waitFor(() => expect(editPanel()).toBeTruthy(), { timeout: 8000 })
}

const editPanel = () => screen.getByRole('region', { name: 'AI 부분수정' })
const pick = (label: RegExp) => fireEvent.click(within(editPanel()).getByRole('checkbox', { name: label }))
const writeFor = (label: RegExp, text: string) =>
  fireEvent.change(within(editPanel()).getByLabelText(new RegExp(`${label.source}.*수정 지시`)), {
    target: { value: text },
  })
const refineTargetsButton = () =>
  within(editPanel()).getByRole('button', { name: '선택 지시 AI로 다듬기' }) as HTMLButtonElement

// ── 전체 생성 지시 다듬기 ────────────────────────────────────────────────────

describe('§9 전체 지시 다듬기', () => {
  it('stays disabled until something is written', async () => {
    await openStudio()
    expect(refineNoteButton().disabled).toBe(true)
    fireEvent.change(aiNoteBox(), { target: { value: '좀 더 예쁘게' } })
    await waitFor(() => expect(refineNoteButton().disabled).toBe(false))
    expect(calls).toHaveLength(0)
  }, 25000)

  it('says what it costs, next to the button', async () => {
    await openStudio()
    expect(document.body.textContent).toContain(REFINE_COST_NOTE)
    expect(REFINE_COST_NOTE).toBe('지시 다듬기는 텍스트 AI 요청 1회이며 이미지를 생성하지 않습니다.')
  }, 25000)

  it('spends exactly one text call and never the image model', async () => {
    await openStudio()
    await saveKeyByGenerating()
    const imagesBefore = imageCalls().length
    fireEvent.change(aiNoteBox(), { target: { value: '좀 더 예쁘게' } })
    fireEvent.click(refineNoteButton())
    await waitFor(() => expect(refineCalls()).toHaveLength(REFINE_CALLS_PER_CLICK), { timeout: 8000 })
    expect(imageCalls()).toHaveLength(imagesBefore)

    const body = lastRefineBody()
    expect(body.scope).toBe('overall')
    expect(body.userText).toBe('좀 더 예쁘게')
    expect(body.concept).toBe('시원하고 청량하게')
    expect(body.designerNote).toBe('메인 문구를 가장 크게 잡아 주세요.')
    expect(JSON.stringify(body.texts)).toContain('08.01 ~ 08.31')
    expect(JSON.stringify(body.page)).toContain('1488')
  }, 30000)

  it('shows the original beside the proposal and changes nothing yet', async () => {
    await openStudio()
    await saveKeyByGenerating()
    refineReply = () => overallReply('날짜 문구를 굵은 고딕으로, 위치와 크기는 유지합니다.', ['주변이 조금 달라질 수 있습니다.'])
    fireEvent.change(aiNoteBox(), { target: { value: '좀 더 예쁘게' } })
    fireEvent.click(refineNoteButton())

    const proposal = await screen.findByRole('region', { name: '다듬은 지시 제안' })
    expect(proposal.textContent).toContain('좀 더 예쁘게')
    expect(proposal.textContent).toContain('날짜 문구를 굵은 고딕으로')
    expect(proposal.textContent).toContain('주변이 조금 달라질 수 있습니다.')
    // 아직 사람의 글은 그대로다.
    expect(aiNoteBox().value).toBe('좀 더 예쁘게')
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(job.doc.project.aiNote ?? '').not.toContain('굵은 고딕')
  }, 30000)

  it('leaves the note untouched when the proposal is cancelled', async () => {
    await openStudio()
    await saveKeyByGenerating()
    refineReply = () => overallReply('다듬은 문장입니다.')
    fireEvent.change(aiNoteBox(), { target: { value: '좀 더 예쁘게' } })
    fireEvent.click(refineNoteButton())
    const proposal = await screen.findByRole('region', { name: '다듬은 지시 제안' })
    fireEvent.click(within(proposal).getByRole('button', { name: '취소' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: '다듬은 지시 제안' })).toBeNull())
    expect(aiNoteBox().value).toBe('좀 더 예쁘게')
  }, 30000)

  it('writes the note only when the person applies it', async () => {
    await openStudio()
    await saveKeyByGenerating()
    const madeWhilePreparing = imageCalls().length
    refineReply = () => overallReply('날짜 문구를 굵은 고딕으로 바꿉니다.')
    fireEvent.change(aiNoteBox(), { target: { value: '좀 더 예쁘게' } })
    fireEvent.click(refineNoteButton())
    const proposal = await screen.findByRole('region', { name: '다듬은 지시 제안' })
    fireEvent.click(within(proposal).getByRole('button', { name: '이 지시 적용' }))

    await waitFor(() => expect(aiNoteBox().value).toBe('날짜 문구를 굵은 고딕으로 바꿉니다.'))
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      expect(job.doc.project.aiNote).toBe('날짜 문구를 굵은 고딕으로 바꿉니다.')
    }, { timeout: 8000 })
    // 적용은 생성이 아니다 — 준비 때 나간 것 말고는 한 건도 늘지 않았다.
    // (겹 방식은 준비에 여러 번 나간다: 배경 판 하나에 문구 겹 하나씩.)
    expect(imageCalls().length).toBe(madeWhilePreparing)
  }, 30000)

  it('keeps everything as it was when the call fails', async () => {
    await openStudio()
    await saveKeyByGenerating()
    const before = (await loadStudioJob(STUDIO_JOB_ID))!
    refineReply = () =>
      new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'raw provider text' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    fireEvent.change(aiNoteBox(), { target: { value: '좀 더 예쁘게' } })
    fireEvent.click(refineNoteButton())

    await waitFor(() => expect(document.body.textContent).toMatch(/크레딧|결제/), { timeout: 8000 })
    expect(document.body.textContent).not.toContain('raw provider text')
    expect(aiNoteBox().value).toBe('좀 더 예쁘게')
    const after = (await loadStudioJob(STUDIO_JOB_ID))!
    const pageId = before.doc.pages[0]!.id
    expect(after.results[pageId]!.assetId).toBe(before.results[pageId]!.assetId)
    expect(cursorOf(after.results[pageId]!)).toBe(cursorOf(before.results[pageId]!))
    expect(revisionsOf(after.results[pageId]!)).toHaveLength(revisionsOf(before.results[pageId]!).length)
    expect(after.productImages).toEqual(before.productImages)
  }, 30000)
})

// ── 부분수정 지시 다듬기 ─────────────────────────────────────────────────────

describe('§10 대상별 지시 다듬기', () => {
  function targetsReply(items: { blockId: string; revisedInstruction: string; warning?: string }[]): Response {
    return new Response(JSON.stringify({ scope: 'targets', result: { items } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  async function twoTargets(): Promise<void> {
    await openStudio()
    await saveKeyByGenerating()
    pick(/문구 1/)
    pick(/문구 3/)
    writeFor(/문구 1/, '날짜 좀 잘 보이게')
    writeFor(/문구 3/, '이 문장 밋밋해')
  }

  it('keeps one instruction box per target and adds one refine button', async () => {
    await twoTargets()
    expect(within(editPanel()).getAllByRole('textbox')).toHaveLength(2)
    expect(refineTargetsButton().disabled).toBe(false)
    expect(refineCalls()).toHaveLength(0)
  }, 30000)

  it('sends every chosen target in a single call, with its own sentence', async () => {
    await twoTargets()
    fireEvent.click(refineTargetsButton())
    await waitFor(() => expect(refineCalls()).toHaveLength(REFINE_CALLS_PER_CLICK), { timeout: 8000 })

    const body = lastRefineBody()
    expect(body.scope).toBe('targets')
    const targets = body.targets as { blockId: string; instruction: string; content?: string }[]
    expect(targets).toHaveLength(2)
    expect(targets.find((t) => t.blockId === 'blk_t1')!.instruction).toBe('날짜 좀 잘 보이게')
    expect(targets.find((t) => t.blockId === 'blk_t3')!.instruction).toBe('이 문장 밋밋해')
    // 고르지 않은 대상도 "건드리지 말 것"으로 함께 간다.
    expect(JSON.stringify(body.untouched)).toContain('신제품 출시')
  }, 30000)

  it('never copies one target proposal onto another', async () => {
    await twoTargets()
    refineReply = () =>
      targetsReply([
        { blockId: 'blk_t1', revisedInstruction: '날짜 문구를 굵은 고딕으로 바꿉니다.' },
        { blockId: 'blk_t3', revisedInstruction: '이 문장에만 손글씨 느낌을 줍니다.' },
      ])
    fireEvent.click(refineTargetsButton())

    await waitFor(() => expect(within(editPanel()).getAllByText(/AI가 다듬은 지시/)).toHaveLength(2), {
      timeout: 8000,
    })
    const cards = [...editPanel().querySelectorAll('.edit-card')]
    const first = cards.find((c) => c.textContent?.includes('08.01 ~ 08.31'))!
    const third = cards.find((c) => c.textContent?.includes('가장 먼저 만나는'))!
    expect(first.textContent).toContain('굵은 고딕')
    expect(first.textContent).not.toContain('손글씨')
    expect(third.textContent).toContain('손글씨')
    expect(third.textContent).not.toContain('굵은 고딕')
  }, 30000)

  it('applies one target at a time, and all at once', async () => {
    await twoTargets()
    refineReply = () =>
      targetsReply([
        { blockId: 'blk_t1', revisedInstruction: '날짜 문구를 굵은 고딕으로 바꿉니다.' },
        { blockId: 'blk_t3', revisedInstruction: '이 문장에만 손글씨 느낌을 줍니다.' },
      ])
    fireEvent.click(refineTargetsButton())
    await waitFor(() => expect(within(editPanel()).getAllByText(/AI가 다듬은 지시/)).toHaveLength(2), {
      timeout: 8000,
    })

    // 하나만 적용 — 나머지는 사람이 쓴 그대로.
    fireEvent.click(within(editPanel()).getByRole('button', { name: /문구 1.*다듬은 지시 적용/ }))
    const box1 = within(editPanel()).getByLabelText(/문구 1.*수정 지시/) as HTMLTextAreaElement
    const box3 = within(editPanel()).getByLabelText(/문구 3.*수정 지시/) as HTMLTextAreaElement
    await waitFor(() => expect(box1.value).toBe('날짜 문구를 굵은 고딕으로 바꿉니다.'))
    expect(box3.value).toBe('이 문장 밋밋해')

    fireEvent.click(within(editPanel()).getByRole('button', { name: '모두 적용' }))
    await waitFor(() => expect(box3.value).toBe('이 문장에만 손글씨 느낌을 줍니다.'))
  }, 30000)

  it('does not start a paid edit by itself', async () => {
    await twoTargets()
    refineReply = () => targetsReply([{ blockId: 'blk_t1', revisedInstruction: '굵게' }])
    const imagesBefore = imageCalls().length
    fireEvent.click(refineTargetsButton())
    await waitFor(() => expect(refineCalls()).toHaveLength(REFINE_CALLS_PER_CLICK), { timeout: 8000 })
    await new Promise((r) => setTimeout(r, 200))
    expect(imageCalls()).toHaveLength(imagesBefore)
    expect(screen.queryByRole('dialog', { name: 'AI 부분수정' })).toBeNull()
  }, 30000)

  it('keeps the written instructions when the call fails', async () => {
    await twoTargets()
    refineReply = () =>
      new Response(JSON.stringify({ error: { code: 'bad_output', message: 'raw provider text' } }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    fireEvent.click(refineTargetsButton())
    await waitFor(() => expect(editPanel().textContent).toMatch(/응답|다시 시도/), { timeout: 8000 })
    expect(editPanel().textContent).not.toContain('raw provider text')
    const box1 = within(editPanel()).getByLabelText(/문구 1.*수정 지시/) as HTMLTextAreaElement
    expect(box1.value).toBe('날짜 좀 잘 보이게')
  }, 30000)
})

// ── 헌법과 비밀 ──────────────────────────────────────────────────────────────

describe('§7·§8 무엇을 쓰고 무엇을 흘리지 않는가', () => {
  it('names the model and the reasoning effort the order requires', () => {
    expect(REFINE_MODEL).toBe('gpt-5.6-sol')
    // 손검수 Patch 1 §5에서 `xhigh` → `high`. 단순 지시 정리에 설계 수준의 추론은
    // 과했고, 그 과함이 곧 장문이었다.
    expect(REFINE_REASONING_EFFORT).toBe('high')
  })

  it('carries the whole constitution in the system instruction', () => {
    const must = [
      '수석 웹디자인 팀장',
      '실행하기 쉬운',
      '한 글자도',
      '추가하지',
      '좌표',
      '선택하지 않은',
      '판정 가능한',
      '픽셀',
      '경고',
      '설명·사과·잡담',
    ]
    for (const phrase of must) expect(REFINE_SYSTEM_INSTRUCTION).toContain(phrase)
  })

  it('never shows the key, any part of it, or its last four anywhere', async () => {
    await openStudio()
    await saveKeyByGenerating()
    refineReply = () => overallReply('다듬은 문장')
    fireEvent.change(aiNoteBox(), { target: { value: '좀 더 예쁘게' } })
    fireEvent.click(refineNoteButton())
    await waitFor(() => expect(refineCalls()).toHaveLength(REFINE_CALLS_PER_CLICK), { timeout: 8000 })

    const last4 = KEY.slice(-4)
    expect(document.body.textContent).not.toContain(KEY)
    expect(document.body.textContent).not.toContain(last4)
    expect(document.body.innerHTML).not.toContain(KEY)
    expect(window.location.href).not.toContain(last4)
    expect(JSON.stringify(localStorage)).not.toContain(last4)
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(JSON.stringify(job)).not.toContain(last4)
    // 키는 헤더에만 실린다 — 본문에는 한 조각도 없다.
    const body = String(refineCalls()[0]!.init.body)
    expect(body).not.toContain(last4)
    expect(
      (refineCalls()[0]!.init.headers as Record<string, string>)['X-OpenAI-API-Key'],
    ).toBe(KEY)
  }, 30000)
})
