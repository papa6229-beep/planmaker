/**
 * 부분수정의 정밀도 (정밀도 교정).
 *
 * 손검수에서 둘이 걸렸다.
 *
 *  1. 대상을 여럿 골라도 지시 칸이 하나뿐이라 모두에게 같은 말이 갔다.
 *  2. 한 문구의 글꼴을 바꾸라 했더니 비슷하게 생긴 다른 문구까지 함께 바뀌었다.
 *
 * 그래서 지시는 대상마다 따로 적고, 프롬프트는 각 지시의 적용 범위를 그 대상 하나로
 * 못 박는다.
 *
 * 다만 이것은 통이미지 AI 편집이다. 범위를 강하게 제한하는 장치일 뿐 픽셀 단위
 * 보장이 아니며, 선택 밖의 미세한 변화 가능성은 남는다.
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
  resetStudioStoreForTests,
  saveStudioJob,
  STUDIO_JOB_ID,
} from '../services/studioStore'
import { createStudioJob, linkProductImage, withSource } from '../domain/studioJob'
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
vi.mock('../services/canvasImageOps', () => ({
  measureImage: async () => ({ width: 832, height: 1472 }),
  drawToSize: async (_b: Blob, width: number, height: number) =>
    new Blob([`drawn:${String(width)}x${String(height)}`], { type: 'image/png' }),
}))

const KEY = 'sk-precision-key'
/** 호출마다 다른 그림 — base64로 유효해야 `atob`가 읽는다. */
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

/** 문구 다섯, 이미지 둘 — 비슷한 문구가 섞여 있어야 격리가 의미를 갖는다. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('정밀도 교정'))
  const text = (id: string, content: string, y: number) =>
    createBlock('free_text', { id, content, position: { x: 100, y, width: 400, height: 90 } })
  const image = (id: string, content: string, y: number) =>
    createBlock('main_product_image', { id, content, position: { x: 100, y, width: 400, height: 200 } })

  doc.pages[0]!.blocks = [
    text('blk_t1', '08.01 ~ 08.31', 80),
    text('blk_t2', '09.01 ~ 09.30', 200),
    text('blk_t3', '신제품 출시', 320),
    text('blk_t4', '지금 예약하기', 440),
    text('blk_t5', '가장 먼저 만나는 새로운 경험!', 560),
    image('blk_i1', '브랜드 로고', 700),
    image('blk_i2', '제품 A 컷', 950),
  ]
  doc.pages[0]!.canvasHeight = 1488
  doc.assets = []
  return doc
}

function readyJob() {
  const doc = sampleDoc()
  let job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
  job = linkProductImage(job, 'blk_i1', 'asset_logo')
  job = linkProductImage(job, 'blk_i2', 'asset_pa')
  return job
}

let calls: { init: RequestInit }[] = []
let failNext = false
let responseSeq = 0

beforeEach(async () => {
  calls = []
  failNext = false
  responseSeq = 0
  globalThis.fetch = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init: init ?? {} })
    if (failNext) {
      return new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 })
    }
    responseSeq += 1
    return new Response(
      JSON.stringify({
        image: { b64: b64For(responseSeq), mimeType: 'image/png' },
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
  await putAsset(storedAsset('asset_logo', 1))
  await putAsset(storedAsset('asset_pa', 2))
})

afterEach(() => cleanup())

async function openStudio(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('정밀도 교정')
  }, { timeout: 8000 })
}

async function generateFirst(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '이미지 생성하기' }))
  fireEvent.change(screen.getByLabelText('테스트용 OpenAI API 키'), { target: { value: KEY } })
  fireEvent.click(screen.getByRole('button', { name: '저장하고 계속' }))
  await waitFor(() => expect(screen.getByText('AI 1차 생성 결과')).toBeTruthy(), { timeout: 8000 })
}

const panel = () => screen.getByRole('region', { name: 'AI 부분수정' })
const runButton = () => within(panel()).getByRole('button', { name: 'AI 부분수정 실행' }) as HTMLButtonElement
const instructionBoxes = () => within(panel()).queryAllByRole('textbox')

function pick(label: RegExp): void {
  fireEvent.click(within(panel()).getByRole('checkbox', { name: label }))
}
function writeFor(label: RegExp, text: string): void {
  fireEvent.change(within(panel()).getByLabelText(new RegExp(`${label.source}.*수정 지시|수정 지시.*${label.source}`)), {
    target: { value: text },
  })
}
function lastPrompt(): string {
  const form = calls[calls.length - 1]!.init.body as FormData
  return String(form.get('prompt'))
}
function lastImageNames(): string[] {
  const form = calls[calls.length - 1]!.init.body as FormData
  return form.getAll('images[]').map((f) => (f as File).name)
}

// ── 대상별 지시 ──────────────────────────────────────────────────────────────

describe('§8 대상마다 다른 지시', () => {
  it('shows one instruction box per chosen target', async () => {
    await openStudio()
    await generateFirst()
    expect(instructionBoxes()).toHaveLength(0)

    pick(/문구 1/)
    expect(instructionBoxes()).toHaveLength(1)
    pick(/문구 5/)
    expect(instructionBoxes()).toHaveLength(2)
  }, 25000)

  it('keeps the two instructions apart', async () => {
    await openStudio()
    await generateFirst()
    pick(/문구 1/)
    pick(/문구 5/)
    writeFor(/문구 1/, '숫자가 잘 읽히는 간결한 폰트로 바꿔 주세요.')
    writeFor(/문구 5/, '이 문구만 미래지향적인 얇은 글꼴로 바꿔 주세요.')

    const values = instructionBoxes().map((b) => (b as HTMLTextAreaElement).value)
    expect(values).toContain('숫자가 잘 읽히는 간결한 폰트로 바꿔 주세요.')
    expect(values).toContain('이 문구만 미래지향적인 얇은 글꼴로 바꿔 주세요.')
    expect(new Set(values).size).toBe(2)
  }, 25000)

  it('drops an unpicked target from the request but keeps the draft around', async () => {
    await openStudio()
    await generateFirst()
    pick(/문구 1/)
    pick(/문구 5/)
    writeFor(/문구 1/, '첫 번째 지시')
    writeFor(/문구 5/, '다섯 번째 지시')

    pick(/문구 5/) // 선택 해제
    expect(instructionBoxes()).toHaveLength(1)

    pick(/문구 5/) // 다시 선택하면 쓰던 초안이 남아 있다
    const values = instructionBoxes().map((b) => (b as HTMLTextAreaElement).value)
    expect(values).toContain('다섯 번째 지시')
  }, 25000)

  it('will not run while any chosen target has no instruction', async () => {
    await openStudio()
    await generateFirst()
    pick(/문구 1/)
    writeFor(/문구 1/, '간결한 폰트로')
    expect(runButton().disabled).toBe(false)

    pick(/문구 5/) // 지시가 빈 대상이 하나 생겼다
    expect(runButton().disabled).toBe(true)
    expect(panel().textContent).toContain('선택한 모든 대상에 수정 지시를 적어 주세요.')

    writeFor(/문구 5/, '얇은 글꼴로')
    expect(runButton().disabled).toBe(false)
    expect(calls).toHaveLength(1)
  }, 25000)

  it('lists each target with its own instruction in the confirm dialog', async () => {
    await openStudio()
    await generateFirst()
    pick(/문구 1/)
    pick(/문구 5/)
    writeFor(/문구 1/, '숫자가 잘 읽히는 간결한 폰트로 바꿔 주세요.')
    writeFor(/문구 5/, '이 문구만 미래지향적인 얇은 글꼴로 바꿔 주세요.')
    fireEvent.click(runButton())

    const dialog = screen.getByRole('dialog', { name: 'AI 부분수정' })
    const items = within(dialog).getAllByRole('listitem')
    expect(items.length).toBeGreaterThanOrEqual(2)
    const text = dialog.textContent ?? ''
    expect(text).toContain('08.01 ~ 08.31')
    expect(text).toContain('숫자가 잘 읽히는 간결한 폰트로 바꿔 주세요.')
    expect(text).toContain('가장 먼저 만나는 새로운 경험!')
    expect(text).toContain('이 문구만 미래지향적인 얇은 글꼴로 바꿔 주세요.')
    // 두 지시가 한 덩어리로 합쳐지지 않는다.
    expect(text).not.toContain('숫자가 잘 읽히는 간결한 폰트로 바꿔 주세요. 이 문구만')
    expect(calls).toHaveLength(1) // 확인 전에는 나가지 않는다
  }, 25000)

  it('cancels without spending anything', async () => {
    await openStudio()
    await generateFirst()
    pick(/문구 1/)
    writeFor(/문구 1/, '간결한 폰트로')
    fireEvent.click(runButton())
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(calls).toHaveLength(1)
  }, 25000)
})

// ── 프롬프트 격리 ────────────────────────────────────────────────────────────

describe('§8 프롬프트는 각 지시를 그 대상 하나로 묶는다', () => {
  async function sendTwo(): Promise<string> {
    await openStudio()
    await generateFirst()
    pick(/문구 1/)
    pick(/문구 5/)
    writeFor(/문구 1/, '숫자가 잘 읽히는 간결한 폰트로 바꿔 주세요.')
    writeFor(/문구 5/, '이 문구만 미래지향적인 얇은 글꼴로 바꿔 주세요.')
    fireEvent.click(runButton())
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 8000 })
    return lastPrompt()
  }

  it('gives each target its own section with its own instruction', async () => {
    const prompt = await sendTwo()
    expect(prompt).toContain('### 대상 1')
    expect(prompt).toContain('### 대상 2')
    const first = prompt.slice(prompt.indexOf('### 대상 1'), prompt.indexOf('### 대상 2'))
    const second = prompt.slice(prompt.indexOf('### 대상 2'))
    expect(first).toContain('숫자가 잘 읽히는 간결한 폰트로 바꿔 주세요.')
    expect(first).not.toContain('미래지향적인')
    expect(second).toContain('이 문구만 미래지향적인 얇은 글꼴로 바꿔 주세요.')
    expect(second).not.toContain('숫자가 잘 읽히는')
  }, 25000)

  it('puts the exact wording, the box and a scope limit in each section', async () => {
    const prompt = await sendTwo()
    const first = prompt.slice(prompt.indexOf('### 대상 1'), prompt.indexOf('### 대상 2'))
    expect(first).toContain('08.01 ~ 08.31')
    expect(first).toMatch(/x 100/)
    expect(first).toContain('대상 범위 제한')
    expect(first).toContain('한 개에만 적용합니다')
  }, 25000)

  it('says not to sweep similar-looking wording along with it', async () => {
    const prompt = await sendTwo()
    expect(prompt).toContain('## 이번 수정의 절대 범위')
    expect(prompt).toMatch(/비슷한 글꼴|비슷하게 보이는|비슷한 숫자/)
    expect(prompt).toContain('일괄')
  }, 25000)

  it('sends the current result first and only the chosen blocks originals', async () => {
    await openStudio()
    await generateFirst()
    pick(/이미지 2/)
    writeFor(/이미지 2/, '조금 아래로 옮겨 주세요.')
    fireEvent.click(runButton())
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 8000 })

    const names = lastImageNames()
    expect(names[0]).toContain('current-result')
    expect(names.join('|')).toContain('asset_pa')
    expect(names.join('|')).not.toContain('asset_logo')
  }, 25000)

  it('sends no product original when only wording was chosen', async () => {
    await openStudio()
    await generateFirst()
    pick(/문구 1/)
    writeFor(/문구 1/, '간결한 폰트로')
    fireEvent.click(runButton())
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 8000 })
    expect(lastImageNames()).toHaveLength(1)
  }, 25000)

  it('spends exactly one call for two targets', async () => {
    await sendTwo()
    expect(calls).toHaveLength(2) // 최초 생성 1 + 편집 1
  }, 25000)
})

