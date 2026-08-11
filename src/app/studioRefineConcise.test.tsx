/**
 * 다듬은 지시는 짧아야 하고, 창은 언제나 누를 수 있어야 한다 (손검수 Patch 1).
 *
 * 손검수에서 걸린 것은 두 가지다.
 *
 *  1. 짧은 추가 주문 한 줄을 넣었더니 기획서 전체가 다시 쓰여 수천 자로 돌아왔다.
 *     문구 원문·좌표·제품 목록·공통 보존 규칙이 통째로 되풀이됐다.
 *  2. 대상을 여섯 개 고르면 확인창이 화면 높이를 넘어, 아래의 `수정 시작`에
 *     손이 닿지 않았다.
 *
 * 다듬기가 하는 일은 **추가 주문의 모호한 말만 구체화하는 것**이다. 기획서의
 * 구조·좌표·문구는 이미지 생성기의 정규 프롬프트가 따로 싣고 가므로, 다듬기가
 * 그것을 다시 적을 이유가 없다.
 *
 * 프롬프트로 부탁하는 것만으로는 부족하다. 모델이 길게 쓰면 **적용하지 않는다** —
 * 중간을 잘라 붙이지도, 스스로 다시 부르지도 않는다.
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
  REFINE_INSTRUCTION_PATH,
  REFINE_OVERALL_MAX_CHARS,
  REFINE_REASONING_EFFORT,
  REFINE_SYSTEM_INSTRUCTION,
  REFINE_TARGET_MAX_CHARS,
  buildRefineUserText,
  parseRefineOutput,
  refineErrorTextFor,
  type RefineRequestBody,
} from '../domain/instructionRefine'
import { requestOpenAiRefine } from '../services/openAiResponsesClient'
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

const KEY = 'sk-concise-key-2211'
const b64For = (n: number): string => btoa(`image-${String(n)}`)
/** 손검수에서 실제로 넣었던 짧은 추가 주문. */
const SHORT_NOTE = '제품 컬러와 어울리는 미래지향적인 배경. 제품 형태와 문구 원문은 유지.'

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

/** 문구 다섯 · 이미지 하나 — 여섯 대상을 한 번에 고를 수 있어야 한다. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('여름 감사제'))
  doc.project.concept = '시원하고 청량하게'
  doc.project.designerNote = '메인 문구를 가장 크게 잡아 주세요.'
  const text = (id: string, content: string, y: number) =>
    createBlock('free_text', { id, content, position: { x: 100, y, width: 400, height: 90 } })
  doc.pages[0]!.blocks = [
    text('blk_t1', '08.01 ~ 08.31', 80),
    text('blk_t2', '여름 감사제', 200),
    text('blk_t3', '신제품 출시', 320),
    text('blk_t4', '지금 예약하기', 440),
    text('blk_t5', '가장 먼저 만나는 새로운 경험!', 560),
    createBlock('main_product_image', { id: 'blk_i1', content: '대표 제품', position: { x: 100, y: 700, width: 400, height: 200 } }),
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

interface Call { url: string; init: RequestInit }
let calls: Call[] = []
let imageSeq = 0
let refineReply: (body: Record<string, unknown>) => Response

const refineCalls = () => calls.filter((c) => c.url.includes(REFINE_INSTRUCTION_PATH))
const imageCalls = () => calls.filter((c) => c.url.includes('/api/generate-image'))
const lastRefineBody = (): Record<string, unknown> =>
  JSON.parse(String(refineCalls()[refineCalls().length - 1]!.init.body)) as Record<string, unknown>

function overallReply(text: string, warnings: string[] = []): Response {
  return new Response(JSON.stringify({ scope: 'overall', result: { revisedInstruction: text, warnings } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
function targetsReply(items: { blockId: string; revisedInstruction: string; warning?: string }[]): Response {
  return new Response(JSON.stringify({ scope: 'targets', result: { items } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** 손검수에서 실제로 돌아온 것과 같은 종류의 장문. */
function bloatedOverall(): string {
  return [
    '캔버스는 가로 840, 세로 1488입니다. 아래 문구를 원문 그대로 배치합니다.',
    '"08.01 ~ 08.31" (x 100, y 80, 가로 400, 세로 90)',
    '"여름 감사제" (x 100, y 200, 가로 400, 세로 90)',
    '"신제품 출시" (x 100, y 320, 가로 400, 세로 90)',
    '"지금 예약하기" (x 100, y 440, 가로 400, 세로 90)',
    '"가장 먼저 만나는 새로운 경험!" (x 100, y 560, 가로 400, 세로 90)',
    '대표 제품 이미지 (x 100, y 700, 가로 400, 세로 200)',
  ]
    .join('\n')
    .repeat(12)
}

beforeEach(async () => {
  calls = []
  imageSeq = 0
  refineReply = () => overallReply('배경만 미래지향적으로 바꿉니다.')
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })
    if (url.includes(REFINE_INSTRUCTION_PATH)) {
      return refineReply(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
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
const editPanel = () => screen.getByRole('region', { name: 'AI 부분수정' })

async function generateFirst(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '이미지 생성하기' }))
  fireEvent.change(screen.getByLabelText('테스트용 OpenAI API 키'), { target: { value: KEY } })
  fireEvent.click(screen.getByRole('button', { name: '저장하고 계속' }))
  await waitFor(async () => {
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(job.results?.[job.doc.pages[0]!.id]).toBeTruthy()
  }, { timeout: 8000 })
  // 결과가 저장된 것과 화면이 완성본으로 넘어간 것은 다른 순간이다 (컷아웃 갈림길
  // 교정). 겹 방식은 저장한 뒤 조각까지 적고 나서 화면을 바꾸므로, 저장만 보고
  // 이어 가면 아직 기획서 화면인 채로 부분수정 칸을 찾게 된다.
  await waitFor(() => expect(editPanel()).toBeTruthy(), { timeout: 8000 })
}

const TEXT_IDS = ['blk_t1', 'blk_t2', 'blk_t3', 'blk_t4', 'blk_t5']
const SIX_LABELS = [/문구 1/, /문구 2/, /문구 3/, /문구 4/, /문구 5/, /이미지 1/]

function pickSix(): void {
  for (const label of SIX_LABELS) fireEvent.click(within(editPanel()).getByRole('checkbox', { name: label }))
  for (const [i, label] of SIX_LABELS.entries()) {
    fireEvent.change(within(editPanel()).getByLabelText(new RegExp(`${label.source}.*수정 지시`)), {
      target: { value: `대상 ${String(i + 1)} 지시` },
    })
  }
}

// ── 계약: 무엇을 얼마나 돌려주는가 ───────────────────────────────────────────

describe('Patch 1 §3·§4·§5 다듬기는 추가 주문만 보정한다', () => {
  it('asks the model for a lighter kind of thinking', () => {
    expect(REFINE_REASONING_EFFORT).toBe('high')
  })

  it('states a length budget both sides can check', () => {
    expect(REFINE_OVERALL_MAX_CHARS).toBe(1200)
    expect(REFINE_TARGET_MAX_CHARS).toBe(400)
  })

  it('tells the model not to rewrite the brief', () => {
    expect(REFINE_SYSTEM_INSTRUCTION).toContain('기획서 전체를 재작성하지')
    expect(REFINE_SYSTEM_INSTRUCTION).toContain('모호한 표현만 구체화')
    expect(REFINE_SYSTEM_INSTRUCTION).toContain('별도 구조 데이터로 이미 전달')
    expect(REFINE_SYSTEM_INSTRUCTION).toContain('반복하지')
    // 헌법은 그대로 남는다.
    for (const phrase of ['수석 웹디자인 팀장', '한 글자도', '판정 가능한', '픽셀', '설명·사과·잡담']) {
      expect(REFINE_SYSTEM_INSTRUCTION).toContain(phrase)
    }
  })

  it('marks the structure as reference only, and names the budget in the request', () => {
    const body: RefineRequestBody = {
      scope: 'overall',
      userText: SHORT_NOTE,
      page: { title: '1페이지', number: 1, total: 1, width: 840, height: 1488 },
      texts: [{ blockId: 'blk_t1', content: '08.01 ~ 08.31', box: { x: 100, y: 80, width: 400, height: 90 } }],
      imageSlots: [],
      buttons: [],
      hasReference: false,
    }
    const text = buildRefineUserText(body)
    expect(text).toContain('참고용')
    expect(text).toContain('반복하지')
    expect(text).toContain(String(REFINE_OVERALL_MAX_CHARS))
    // 예전 판이 시키던 "전체 생성에 붙일 실행 가능한 추가 지시로 다듬어" 는 없다.
    expect(text).not.toContain('페이지 전체 생성에 붙일')
  })

  it('names a per-target budget when several targets are refined at once', () => {
    const body: RefineRequestBody = {
      scope: 'targets',
      targets: TEXT_IDS.map((id, i) => ({
        blockId: id,
        label: `문구 ${String(i + 1)}`,
        kind: 'text' as const,
        instruction: `지시 ${String(i + 1)}`,
      })),
      untouched: ['이미지 1'],
      page: { title: '1페이지', number: 1, total: 1, width: 840, height: 1488 },
      texts: [],
      imageSlots: [],
      buttons: [],
      hasReference: false,
    }
    const text = buildRefineUserText(body)
    expect(text).toContain(String(REFINE_TARGET_MAX_CHARS))
    expect(text).toContain('2~4문장')
  })

  it('caps how much the provider may write', async () => {
    let sent: Record<string, unknown> = {}
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ output_text: JSON.stringify({ revisedInstruction: '짧게', warnings: [] }) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    await requestOpenAiRefine(
      {
        apiKey: 'sk-x',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        systemText: 'sys',
        userText: 'user',
        schemaName: 'n',
        schema: {},
        maxOutputTokens: 3000,
      },
      { fetch: fakeFetch },
    )
    expect(sent.max_output_tokens).toBe(3000)
    expect((sent.reasoning as { effort?: string }).effort).toBe('high')
  })
})

// ── 출력 방어: 길면 적용하지 않는다 ──────────────────────────────────────────

describe('Patch 1 §6 길거나 어긋난 응답은 적용하지 않는다', () => {
  const allowed = { allowedBlockIds: TEXT_IDS }

  it('accepts an overall instruction inside the budget', () => {
    const parsed = parseRefineOutput('overall', { revisedInstruction: '가'.repeat(REFINE_OVERALL_MAX_CHARS), warnings: [] })
    expect(parsed).not.toBeNull()
  })

  it('refuses an overall instruction past the budget, without cutting it', () => {
    const long = '가'.repeat(REFINE_OVERALL_MAX_CHARS + 1)
    const parsed = parseRefineOutput('overall', { revisedInstruction: long, warnings: [] })
    expect(parsed).toBeNull()
  })

  it('refuses a single target instruction past 400 characters', () => {
    const items = TEXT_IDS.map((id) => ({ blockId: id, revisedInstruction: '짧게' }))
    items[2] = { blockId: 'blk_t3', revisedInstruction: '가'.repeat(REFINE_TARGET_MAX_CHARS + 1) }
    expect(parseRefineOutput('targets', { items }, allowed)).toBeNull()
  })

  it('refuses a duplicated blockId', () => {
    const items = [
      { blockId: 'blk_t1', revisedInstruction: '하나' },
      { blockId: 'blk_t1', revisedInstruction: '둘' },
    ]
    expect(parseRefineOutput('targets', { items }, { allowedBlockIds: ['blk_t1', 'blk_t2'] })).toBeNull()
  })

  it('refuses a blockId nobody chose', () => {
    const items = [{ blockId: 'blk_t1', revisedInstruction: '하나' }, { blockId: 'blk_t9', revisedInstruction: '둘' }]
    expect(parseRefineOutput('targets', { items }, { allowedBlockIds: ['blk_t1', 'blk_t2'] })).toBeNull()
  })

  it('refuses when a chosen target came back without an instruction', () => {
    const items = [{ blockId: 'blk_t1', revisedInstruction: '하나' }]
    expect(parseRefineOutput('targets', { items }, { allowedBlockIds: ['blk_t1', 'blk_t2'] })).toBeNull()
  })

  it('says so in plain Korean, and applies nothing', async () => {
    await openStudio()
    await generateFirst()
    const before = (await loadStudioJob(STUDIO_JOB_ID))!
    const pageId = before.doc.pages[0]!.id

    fireEvent.change(aiNoteBox(), { target: { value: SHORT_NOTE } })
    refineReply = () => overallReply(bloatedOverall())
    fireEvent.click(screen.getByRole('button', { name: 'AI로 지시 다듬기' }))

    await waitFor(() => expect(document.body.textContent).toContain('AI가 지시를 너무 길게 작성했습니다'), {
      timeout: 8000,
    })
    expect(screen.queryByRole('region', { name: '다듬은 지시 제안' })).toBeNull()
    expect(aiNoteBox().value).toBe(SHORT_NOTE)
    // 자동으로 다시 부르지 않는다.
    await new Promise((r) => setTimeout(r, 200))
    expect(refineCalls()).toHaveLength(1)

    const after = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(after.results[pageId]!.assetId).toBe(before.results[pageId]!.assetId)
    expect(cursorOf(after.results[pageId]!)).toBe(cursorOf(before.results[pageId]!))
    expect(revisionsOf(after.results[pageId]!)).toHaveLength(revisionsOf(before.results[pageId]!).length)
  }, 30000)

  it('refuses a too-long target proposal without touching the written ones', async () => {
    await openStudio()
    await generateFirst()
    pickSix()
    refineReply = (body) => {
      const targets = (body.targets ?? []) as { blockId: string }[]
      return targetsReply(
        targets.map((t, i) => ({
          blockId: t.blockId,
          revisedInstruction: i === 0 ? '가'.repeat(REFINE_TARGET_MAX_CHARS + 40) : '짧고 분명한 지시입니다.',
        })),
      )
    }
    fireEvent.click(within(editPanel()).getByRole('button', { name: '선택 지시 AI로 다듬기' }))

    await waitFor(() => expect(editPanel().textContent).toContain('너무 길게 작성했습니다'), { timeout: 8000 })
    expect(within(editPanel()).queryAllByText(/AI가 다듬은 지시/)).toHaveLength(0)
    const first = within(editPanel()).getByLabelText(/문구 1.*수정 지시/) as HTMLTextAreaElement
    expect(first.value).toBe('대상 1 지시')
    expect(refineErrorTextFor('output_too_long')).toBe('AI가 지시를 너무 길게 작성했습니다. 다시 다듬어 주세요.')
  }, 30000)
})

// ── 여섯 대상, 한 번의 호출 ─────────────────────────────────────────────────

describe('Patch 1 §4 여섯 대상도 한 번에', () => {
  it('keeps six boxes, one call, and six separate proposals', async () => {
    await openStudio()
    await generateFirst()
    pickSix()
    expect(within(editPanel()).getAllByRole('textbox')).toHaveLength(6)

    refineReply = (body) => {
      const targets = (body.targets ?? []) as { blockId: string }[]
      return targetsReply(targets.map((t) => ({ blockId: t.blockId, revisedInstruction: `${t.blockId} 전용 지시` })))
    }
    const imagesBefore = imageCalls().length
    fireEvent.click(within(editPanel()).getByRole('button', { name: '선택 지시 AI로 다듬기' }))

    await waitFor(() => expect(within(editPanel()).getAllByText(/AI가 다듬은 지시/)).toHaveLength(6), { timeout: 8000 })
    expect(refineCalls()).toHaveLength(1)
    expect(imageCalls()).toHaveLength(imagesBefore)
    expect((lastRefineBody().targets as unknown[]).length).toBe(6)

    // 어느 카드에도 남의 지시가 없다.
    const cards = [...editPanel().querySelectorAll('.edit-card')]
    expect(cards).toHaveLength(6)
    for (const id of TEXT_IDS) {
      const owner = cards.filter((c) => c.textContent?.includes(`${id} 전용 지시`))
      expect(owner).toHaveLength(1)
    }
  }, 30000)
})

// ── Patch 1-B 창은 언제나 누를 수 있다 ──────────────────────────────────────

describe('Patch 1-B §7·§8 긴 내용에도 하단 버튼이 남는다', () => {
  async function openEditConfirm(): Promise<HTMLElement> {
    await openStudio()
    await generateFirst()
    pickSix()
    fireEvent.click(within(editPanel()).getByRole('button', { name: 'AI 부분수정 실행' }))
    return screen.findByRole('dialog', { name: 'AI 부분수정' })
  }

  it('splits the dialog into a fixed head, a scrolling body and a fixed footer', async () => {
    const dialog = await openEditConfirm()
    const body = dialog.querySelector('.confirm__body')
    const actions = dialog.querySelector('.confirm__actions')
    expect(body).toBeTruthy()
    expect(actions).toBeTruthy()
    // 버튼은 스크롤되는 본문 **밖**에 있다 — 안에 있으면 함께 밀려 내려간다.
    expect(body!.contains(actions!)).toBe(false)
    expect(dialog.querySelector('.confirm__head')).toBeTruthy()
    expect(dialog.classList.contains('confirm--scrollable')).toBe(true)
  }, 30000)

  it('shows a short summary per target and keeps the full instruction one open away', async () => {
    const dialog = await openEditConfirm()
    const items = dialog.querySelectorAll('.gen-dialog__targets li')
    expect(items).toHaveLength(6)
    for (const item of items) expect(item.querySelector('details')).toBeTruthy()
    // 여섯 대상의 서로 다른 지시는 그대로 확인할 수 있다.
    expect(dialog.textContent).toContain('대상 1 지시')
    expect(dialog.textContent).toContain('대상 6 지시')
  }, 30000)

  it('keeps 취소 and 수정 시작 reachable and working', async () => {
    const dialog = await openEditConfirm()
    const actions = dialog.querySelector('.confirm__actions')!
    expect(within(actions as HTMLElement).getByRole('button', { name: '취소' })).toBeTruthy()
    expect(within(actions as HTMLElement).getByRole('button', { name: '수정 시작' })).toBeTruthy()
    fireEvent.click(within(actions as HTMLElement).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI 부분수정' })).toBeNull())
  }, 30000)

  it('closes on Escape', async () => {
    await openEditConfirm()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI 부분수정' })).toBeNull())
  }, 30000)

  it('keeps the overall proposal actionable however long it is', async () => {
    await openStudio()
    await generateFirst()
    fireEvent.change(aiNoteBox(), { target: { value: SHORT_NOTE } })
    refineReply = () => overallReply('가'.repeat(REFINE_OVERALL_MAX_CHARS - 10))
    fireEvent.click(screen.getByRole('button', { name: 'AI로 지시 다듬기' }))

    const proposal = await screen.findByRole('region', { name: '다듬은 지시 제안' }, { timeout: 8000 })
    const body = proposal.querySelector('.refine__scroll')
    const actions = proposal.querySelector('.refine__actions')
    expect(body).toBeTruthy()
    expect(actions).toBeTruthy()
    expect(body!.contains(actions!)).toBe(false)
    fireEvent.click(within(actions as HTMLElement).getByRole('button', { name: '이 지시 적용' }))
    await waitFor(() => expect(aiNoteBox().value.length).toBe(REFINE_OVERALL_MAX_CHARS - 10))
  }, 30000)
})
