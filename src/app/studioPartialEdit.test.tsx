/**
 * 기획서 블록 기반 AI 부분수정 (부분수정 1단계).
 *
 * 이 기능이 무엇이 **아닌지**부터 적어 둔다. 모델이 돌려준 것은 한 장짜리
 * 통이미지이고, 여기서 하는 일은 그 통이미지를 다시 보내면서 "이 부분만 이렇게"
 * 라고 말하는 것이다. 레이어를 직접 옮기거나 30px을 정확히 이동시키는 것이
 * 아니다. 번호는 사람이 대상을 가리키고 원 기획서 정보를 다시 실어 보내기 위한
 * 이름표다.
 *
 * 그래서 이 검사가 지키는 것은 셋이다.
 *
 *  1. 번호와 원문은 **생성된 순간에 얼어붙는다.** 왼쪽 기획서가 뒤에 바뀌어도
 *     이미 만든 결과의 "문구 3"이 다른 것을 가리키면 안 된다.
 *  2. 요청에는 지금 이미지와 기획서 정보가 매번 다시 들어간다. 모델이 지난
 *     호출을 기억한다고 가정하지 않는다.
 *  3. 되돌리기는 **공짜**다. 직전으로도 최초로도, 외부를 부르지 않고 돌아간다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, getAllAssets, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
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
import { createStudioJob, linkProductImage, withSource } from '../domain/studioJob'
import { buildEditTargets, BACKGROUND_TARGET_ID } from '../domain/editTargets'
import { buildEditPrompt, EDIT_RULES } from '../domain/editPrompt'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 640, height: 640 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: 'image/png' }),
}))
const fakeCanvas = { failDraw: false, drawCalls: 0 }
vi.mock('../services/canvasImageOps', () => ({
  measureImage: async () => ({ width: 832, height: 1472 }),
  drawToSize: async (_b: Blob, width: number, height: number) => {
    fakeCanvas.drawCalls += 1
    if (fakeCanvas.failDraw) throw new Error('변환 실패(주입)')
    return new Blob([`drawn:${String(width)}x${String(height)}`], { type: 'image/png' })
  },
}))

const KEY = 'sk-partial-edit-key'
const B64 = 'aW1hZ2UtZnJvbS1tb2RlbA=='

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

/** 문구 셋(둘은 같은 말), 이미지 셋, 그리고 주소 블록 하나. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('부분수정 대상'))
  const mk = (id: string, type: Parameters<typeof createBlock>[0], content: string, y: number, x = 100) =>
    createBlock(type, { id, content, position: { x, y, width: 300, height: 100 } })

  const t1 = mk('blk_t1', 'free_text', '신제품', 100)
  const t2 = mk('blk_t2', 'free_text', '20% OFF', 240)
  const t3 = mk('blk_t3', 'free_text', '출시기념', 380)
  const logo = mk('blk_i1', 'main_product_image', '바나나몰 × 아크웨이브 로고', 520)
  const p1 = mk('blk_i2', 'main_product_image', '아크웨이브 제품 A', 700, 80)
  const p2 = mk('blk_i3', 'main_product_image', '아크웨이브 제품 B', 700, 460)
  // 같은 높이면 왼쪽이 먼저다. 같은 문구가 두 번 나와도 블록은 서로 다르다.
  const dup = mk('blk_t4', 'free_text', '신제품', 900)
  const url = createBlock('button_url', {
    id: 'blk_url',
    content: 'https://shop.example.com/x',
    position: { x: 100, y: 1000, width: 200, height: 60 },
  })

  doc.pages[0]!.blocks = [t1, t2, t3, logo, p1, p2, dup, url]
  doc.pages[0]!.canvasHeight = 1488
  doc.assets = []
  return doc
}

function readyJob(doc = sampleDoc()) {
  let job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
  job = linkProductImage(job, 'blk_i1', 'asset_logo')
  job = linkProductImage(job, 'blk_i2', 'asset_pa')
  job = linkProductImage(job, 'blk_i3', 'asset_pb')
  return job
}

let calls: { init: RequestInit }[] = []
let respond: () => Promise<Response>

function okResponse(): Promise<Response> {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        image: { b64: B64, mimeType: 'image/png' },
        metadata: { model: 'gpt-image-2', quality: 'medium', requestedSize: '832x1472', requestId: 'req_x' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
}

beforeEach(async () => {
  calls = []
  respond = okResponse
  fakeCanvas.failDraw = false
  fakeCanvas.drawCalls = 0
  globalThis.fetch = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init: init ?? {} })
    return respond()
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
  for (const [i, id] of ['asset_logo', 'asset_pa', 'asset_pb'].entries()) await putAsset(storedAsset(id, i + 1))
})

afterEach(() => cleanup())

async function openStudio(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('부분수정 대상')
  }, { timeout: 8000 })
}

/** 최초 생성 한 번. 이 뒤로 부분수정이 가능해진다. */
async function generateFirst(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '이미지 생성하기' }))
  fireEvent.change(screen.getByLabelText('테스트용 OpenAI API 키'), { target: { value: KEY } })
  fireEvent.click(screen.getByRole('button', { name: '저장하고 계속' }))
  await waitFor(() => expect(screen.getByText('AI 1차 생성 결과')).toBeTruthy(), { timeout: 8000 })
}

function editPanel(): HTMLElement {
  return screen.getByRole('region', { name: 'AI 부분수정' })
}

async function selectTargets(...labels: RegExp[]): Promise<void> {
  for (const label of labels) fireEvent.click(within(editPanel()).getByRole('checkbox', { name: label }))
}

/** 고른 대상 전부에 같은 문장을 적어 준다 — 이 검사들은 대상 구성만 본다. */
async function runEdit(instruction: string): Promise<void> {
  for (const box of within(editPanel()).getAllByRole('textbox')) {
    fireEvent.change(box, { target: { value: instruction } })
  }
  fireEvent.click(within(editPanel()).getByRole('button', { name: 'AI 부분수정 실행' }))
}

/** 마지막 요청의 프롬프트. */
function lastPrompt(): string {
  const form = calls[calls.length - 1]!.init.body as FormData
  return String(form.get('prompt'))
}
function lastImageNames(): string[] {
  const form = calls[calls.length - 1]!.init.body as FormData
  return form.getAll('images[]').map((f) => (f as File).name)
}

// ── §6-1·2·3·6 대상 목록 ─────────────────────────────────────────────────────

describe('§6 생성 순간의 대상 목록', () => {
  it('numbers texts and images in reading order with their exact wording', () => {
    const doc = sampleDoc()
    const targets = buildEditTargets(doc, readyJob(doc), doc.pages[0]!.id)
    expect(targets.map((t) => t.label)).toEqual([
      '문구 1 — 신제품',
      '문구 2 — 20% OFF',
      '문구 3 — 출시기념',
      '이미지 1 — 바나나몰 × 아크웨이브 로고',
      '이미지 2 — 아크웨이브 제품 A',
      '이미지 3 — 아크웨이브 제품 B',
      '문구 4 — 신제품',
      '전체 배경',
    ])
    // 원문은 잘리지 않은 채로 함께 실린다.
    expect(targets[2]?.content).toBe('출시기념')
    // 주소 블록은 이미지에 인쇄되지 않으므로 대상이 아니다.
    expect(targets.some((t) => t.content?.includes('http'))).toBe(false)
  })

  it('keeps two identical wordings apart by their own block', () => {
    const doc = sampleDoc()
    const targets = buildEditTargets(doc, readyJob(doc), doc.pages[0]!.id)
    const same = targets.filter((t) => t.content === '신제품')
    expect(same).toHaveLength(2)
    expect(same[0]?.blockId).not.toBe(same[1]?.blockId)
    expect(same.map((t) => t.label)).toEqual(['문구 1 — 신제품', '문구 4 — 신제품'])
  })

  it('gives the background no invented block id', () => {
    const doc = sampleDoc()
    const targets = buildEditTargets(doc, readyJob(doc), doc.pages[0]!.id)
    const background = targets.find((t) => t.kind === 'background')!
    expect(background.targetId).toBe(BACKGROUND_TARGET_ID)
    expect(background.blockId).toBeUndefined()
    expect(doc.pages[0]!.blocks.some((b) => b.id === BACKGROUND_TARGET_ID)).toBe(false)
  })

  it('freezes the list on the result, so later brief edits do not renumber it', async () => {
    await openStudio()
    await generateFirst()
    const before = (await loadStudioJob(STUDIO_JOB_ID))!.results[
      (await loadStudioJob(STUDIO_JOB_ID))!.doc.pages[0]!.id
    ]!
    expect(before.targets?.map((t) => t.label)).toContain('문구 3 — 출시기념')

    // 기획서를 고친다 — 제목만 바꿔도 문서는 달라진다.
    fireEvent.change(document.querySelector('.editor-topbar__title') as HTMLInputElement, {
      target: { value: '부분수정 대상 v2' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const after = (await loadStudioJob(STUDIO_JOB_ID))!
    const result = after.results[after.doc.pages[0]!.id]!
    expect(result.targets).toEqual(before.targets)
  }, 25000)
})

// ── §6-4·5·7·8·9 요청 내용 ───────────────────────────────────────────────────

describe('§6 편집 요청에 무엇이 실리는가', () => {
  it('carries one chosen target exactly', async () => {
    await openStudio()
    await generateFirst()
    await selectTargets(/문구 3 — 출시기념/)
    await runEdit('위의 20% OFF와 간격이 좁아지도록 조금 위로 이동해 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 8000 })

    const prompt = lastPrompt()
    expect(prompt).toContain('## 이번 수정의 절대 범위')
    expect(prompt).toContain('문구 3 — 출시기념')
    expect(prompt).toContain('위의 20% OFF와 간격이 좁아지도록 조금 위로 이동해 주세요.')
    // 고르지 않은 것은 "그대로 두어야 할 것"에 있다.
    expect(prompt).toContain('## 그대로 두어야 할 것')
    expect(prompt).toContain('문구 1')
  }, 25000)

  it('carries every target of a multiple selection', async () => {
    await openStudio()
    await generateFirst()
    await selectTargets(/이미지 1/, /이미지 2/, /이미지 3/)
    await runEdit('제품 세 개의 크기와 순서를 유지한 채 전체적으로 조금 아래로 이동해 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 8000 })

    const prompt = lastPrompt()
    for (const label of ['이미지 1', '이미지 2', '이미지 3']) expect(prompt).toContain(label)
  }, 25000)

  it('sends the current result image first, then only the chosen blocks own originals', async () => {
    await openStudio()
    await generateFirst()
    await selectTargets(/이미지 2/)
    await runEdit('조금 아래로 옮겨 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 8000 })

    const names = lastImageNames()
    expect(names[0]).toContain('current-result')
    // 고른 자리의 원본만 — 고르지 않은 로고와 제품 B는 가지 않는다.
    expect(names.join('|')).toContain('asset_pa')
    expect(names.join('|')).not.toContain('asset_logo')
    expect(names.join('|')).not.toContain('asset_pb')
  }, 25000)

  it('always carries the rules that protect what was not chosen', async () => {
    await openStudio()
    await generateFirst()
    await selectTargets(/전체 배경/)
    await runEdit('원형 광원을 조금 약하게 해 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 8000 })

    const prompt = lastPrompt()
    for (const rule of EDIT_RULES) expect(prompt).toContain(rule)
  }, 25000)

  it('builds the same rules for any selection, without mixing them into the user sentence', () => {
    const doc = sampleDoc()
    const targets = buildEditTargets(doc, readyJob(doc), doc.pages[0]!.id)
    const prompt = buildEditPrompt(targets, [{ target: targets[2]!, instruction: '조금 위로' }], {
      currentImage: { width: 840, height: 1488 },
      page: { width: 840, height: 1488 },
      inputs: [{ index: 1, what: '현재 결과 이미지' }],
    })
    // 사용자의 말은 그 대상의 구역 안에만 있다.
    const section = prompt.slice(prompt.indexOf('### 대상 1'))
    expect(section).toContain('이 대상에만 적용할 지시:')
    expect(section).toContain('조금 위로')
    expect(prompt.indexOf('## 반드시 지킬 것')).toBeLessThan(prompt.indexOf('### 대상 1'))
  })
})

// ── §6-10·11·12·13 실행 경계 ─────────────────────────────────────────────────

describe('§6 실행은 사람이 확인한 뒤 정확히 한 번', () => {
  it('cannot run without a target or without an instruction', async () => {
    await openStudio()
    await generateFirst()
    const run = () => within(editPanel()).getByRole('button', { name: 'AI 부분수정 실행' }) as HTMLButtonElement
    expect(run().disabled).toBe(true)

    await selectTargets(/문구 3/)
    expect(run().disabled).toBe(true) // 지시가 아직 없다

    for (const box of within(editPanel()).getAllByRole('textbox')) {
      fireEvent.change(box, { target: { value: '조금 위로' } })
    }
    expect(run().disabled).toBe(false)
    expect(calls).toHaveLength(1) // 최초 생성 한 번뿐
  }, 25000)

  it('shows the targets, both sizes and the one-call notice before spending', async () => {
    await openStudio()
    await generateFirst()
    await selectTargets(/문구 3/)
    await runEdit('조금 위로 올려 주세요.')

    const dialog = screen.getByRole('dialog', { name: 'AI 부분수정' })
    expect(dialog.textContent).toContain('문구 3 — 출시기념')
    expect(dialog.textContent).toContain('조금 위로 올려 주세요.')
    expect(dialog.textContent).toContain('수정 지시:')
    expect(dialog.textContent).toContain('gpt-image-2')
    expect(dialog.textContent).toContain('medium')
    expect(dialog.textContent).toContain('AI 편집 규격')
    expect(dialog.textContent).toContain('840x1488')
    expect(dialog.textContent).toContain('1회')
    expect(dialog.textContent).toMatch(/주변|함께 조금/)
    // 확인 전에는 아무것도 나가지 않는다.
    expect(calls).toHaveLength(1)
  }, 25000)

  it('sends exactly one request after approval and never retries on failure', async () => {
    await openStudio()
    await generateFirst()
    await selectTargets(/문구 3/)
    await runEdit('조금 위로 올려 주세요.')
    respond = async () =>
      new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'raw' } }), { status: 429 })
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(screen.getByText(/크레딧|결제/)).toBeTruthy(), { timeout: 8000 })
    await new Promise((r) => setTimeout(r, 400))
    expect(calls).toHaveLength(2) // 생성 1 + 편집 1. 재시도 없음.
  }, 25000)
})

// ── §6-14·15 결과와 실패 ─────────────────────────────────────────────────────

describe('§6 결과는 840으로 정착하고, 실패는 아무것도 바꾸지 않는다', () => {
  it('settles the edited result at 840 by the page height', async () => {
    await openStudio()
    await generateFirst()
    const first = (await loadStudioJob(STUDIO_JOB_ID))!
    const pageId = first.doc.pages[0]!.id
    const originalAsset = first.results[pageId]!.assetId

    await selectTargets(/문구 3/)
    await runEdit('조금 위로 올려 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job!.results[pageId]!.assetId).not.toBe(originalAsset)
    }, { timeout: 8000 })

    const after = (await loadStudioJob(STUDIO_JOB_ID))!.results[pageId]!
    expect(after.workingSize).toBe('840x1488')
    expect(after.previousAssetId).toBe(originalAsset)
    expect(after.originalAssetId).toBe(originalAsset)
    expect(after.editCount).toBe(1)
  }, 25000)

  it('leaves current, previous and original untouched when the edit fails', async () => {
    await openStudio()
    await generateFirst()
    const pageId = (await loadStudioJob(STUDIO_JOB_ID))!.doc.pages[0]!.id
    const before = (await loadStudioJob(STUDIO_JOB_ID))!.results[pageId]!

    await selectTargets(/문구 3/)
    await runEdit('조금 위로 올려 주세요.')
    respond = async () => new Response(JSON.stringify({ error: { code: 'moderation_blocked' } }), { status: 400 })
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(screen.getByText(/안전 정책/)).toBeTruthy(), { timeout: 8000 })

    const after = (await loadStudioJob(STUDIO_JOB_ID))!.results[pageId]!
    expect(after.assetId).toBe(before.assetId)
    expect(after.previousAssetId).toBe(before.previousAssetId)
    expect(after.originalAssetId).toBe(before.originalAssetId)
  }, 25000)
})

// ── §6-16·17·18 되돌리기 ─────────────────────────────────────────────────────

describe('§6 되돌리기는 공짜다', () => {
  async function editOnce(): Promise<{ pageId: string; original: string; edited: string }> {
    await openStudio()
    await generateFirst()
    const job0 = (await loadStudioJob(STUDIO_JOB_ID))!
    const pageId = job0.doc.pages[0]!.id
    const original = job0.results[pageId]!.assetId

    await selectTargets(/문구 3/)
    await runEdit('조금 위로 올려 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job!.results[pageId]!.assetId).not.toBe(original)
    }, { timeout: 8000 })
    const edited = (await loadStudioJob(STUDIO_JOB_ID))!.results[pageId]!.assetId
    return { pageId, original, edited }
  }

  it('goes back to the previous result without calling anything', async () => {
    const { pageId, original, edited } = await editOnce()
    const callsBefore = calls.length

    fireEvent.click(within(editPanel()).getByRole('button', { name: '직전 결과로 되돌리기' }))
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job!.results[pageId]!.assetId).toBe(original)
    }, { timeout: 8000 })
    expect(calls).toHaveLength(callsBefore)
    // 되돌려도 방금 만든 그림은 버리지 않는다.
    expect((await getAllAssets()).map((a) => a.id)).toContain(edited)
  }, 30000)

  it('goes back to the very first result without calling anything', async () => {
    const { pageId, original } = await editOnce()
    const callsBefore = calls.length

    fireEvent.click(within(editPanel()).getByRole('button', { name: '최초 생성본으로 복원' }))
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job!.results[pageId]!.assetId).toBe(original)
    }, { timeout: 8000 })
    expect(calls).toHaveLength(callsBefore)
  }, 30000)

  it('changes nothing about the brief, the links or the notes', async () => {
    const { pageId } = await editOnce()
    const before = (await loadStudioJob(STUDIO_JOB_ID))!
    void pageId

    fireEvent.click(within(editPanel()).getByRole('button', { name: '직전 결과로 되돌리기' }))
    await new Promise((r) => setTimeout(r, 300))
    const after = (await loadStudioJob(STUDIO_JOB_ID))!

    expect(after.doc).toEqual(before.doc)
    expect(after.productImages).toEqual(before.productImages)
    expect(after.source?.fileName).toBe(before.source?.fileName)
    expect(after.doc.pages[0]!.canvasHeight).toBe(1488)
  }, 30000)

  it('keeps all three images safe from the asset sweep', async () => {
    const { pageId, original, edited } = await editOnce()
    const protectedIds = await allStudioAssetIds()
    expect(protectedIds).toContain(original)
    expect(protectedIds).toContain(edited)
    void pageId
  }, 30000)
})

// ── §6-19·20 경계 ────────────────────────────────────────────────────────────

describe('§6 키와 표면 경계', () => {
  it('never leaves the key or the provider text anywhere it can be read', async () => {
    await openStudio()
    await generateFirst()
    await selectTargets(/문구 3/)
    await runEdit('조금 위로 올려 주세요.')
    respond = async () =>
      new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: `bad ${KEY}` } }), { status: 401 })
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(screen.getByText(/API 키가 올바르지 않습니다/)).toBeTruthy(), { timeout: 8000 })

    expect(document.body.textContent).not.toContain(KEY)
    expect(document.body.textContent).not.toContain('bad ')
    expect(JSON.stringify(localStorage)).not.toContain(KEY)
    expect(JSON.stringify(await loadStudioJob(STUDIO_JOB_ID))).not.toContain(KEY)
  }, 25000)

  it('shows no partial-edit panel on the brief writer', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes surface="brief-writer" />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.body.textContent).toBeTruthy())
    expect(screen.queryByRole('region', { name: 'AI 부분수정' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'AI 부분수정 실행' })).toBeNull()
  })

  it('hides the panel until there is something to edit', async () => {
    await openStudio()
    expect(screen.queryByRole('region', { name: 'AI 부분수정' })).toBeNull()
    await generateFirst()
    expect(screen.getByRole('region', { name: 'AI 부분수정' })).toBeTruthy()
  }, 25000)
})
