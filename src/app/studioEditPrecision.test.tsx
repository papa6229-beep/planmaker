/**
 * 부분수정의 정밀도와 결과 이력 (정밀도 교정).
 *
 * 손검수에서 셋이 걸렸다.
 *
 *  1. 대상을 여럿 골라도 지시 칸이 하나뿐이라 모두에게 같은 말이 갔다.
 *  2. 한 문구의 글꼴을 바꾸라 했더니 비슷하게 생긴 다른 문구까지 함께 바뀌었다.
 *  3. 되돌린 뒤 다시 앞으로 갈 수 없었다.
 *
 * 그래서 지시는 대상마다 따로 적고, 프롬프트는 각 지시의 적용 범위를 그 대상 하나로
 * 못 박고, 결과는 앞뒤로 오갈 수 있는 줄로 만든다.
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
  loadStudioJob,
  resetStudioStoreForTests,
  saveStudioJob,
  allStudioAssetIds,
  STUDIO_JOB_ID,
} from '../services/studioStore'
import { createStudioJob, linkProductImage, withSource, revisionsOf, cursorOf } from '../domain/studioJob'
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
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // 갈래 묻기는 우리 함수이고 값이 붙지 않는다 (서버 키 Patch).
    if (String(input).includes('/api/access-mode')) {
      return new Response(JSON.stringify({ mode: 'client-key' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
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
  await waitFor(() => expect(screen.getByRole('heading', { name: '완성본' })).toBeTruthy(), { timeout: 8000 })
  await waitFor(() => expect(panel()).toBeTruthy(), { timeout: 8000 })
  /**
   * 여기까지가 **준비**다. 장부를 비우고 시작한다 (컷아웃 갈림길 교정).
   *
   * 이 파일이 재는 것은 부분수정 한 번에 몇 번 나가는가이지, 준비에 몇 번 들었는가가
   * 아니다. 겹 방식으로 바뀌면서 준비 비용이 달라졌고, 세지 않으면 그 수가 앞으로
   * 또 바뀌어도 이 검사들은 제 할 말을 그대로 한다.
   */
  calls.length = 0
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
function lastImageNames(): string[] {
  const form = calls[calls.length - 1]!.init.body as FormData
  return form.getAll('images[]').map((f) => (f as File).name)
}
async function pageId(): Promise<string> {
  return (await loadStudioJob(STUDIO_JOB_ID))!.doc.pages[0]!.id
}
async function result() {
  return (await loadStudioJob(STUDIO_JOB_ID))!.results[await pageId()]!
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
    expect(calls).toHaveLength(0)
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
    expect(calls).toHaveLength(0) // 확인 전에는 나가지 않는다
  }, 25000)

  it('cancels without spending anything', async () => {
    await openStudio()
    await generateFirst()
    pick(/문구 1/)
    writeFor(/문구 1/, '간결한 폰트로')
    fireEvent.click(runButton())
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(calls).toHaveLength(0)
  }, 25000)
})

// ── 프롬프트 격리 ────────────────────────────────────────────────────────────

/**
 * 조각 수정에서는 지시를 대상 하나로 **묶을 필요가 없다** (컷아웃 갈림길 교정).
 *
 * 앞선 판은 통이미지 한 장을 고쳤다. 한 장 안에서 고른 것만 손대라고 부탁해야
 * 했으므로, 한 요청 안에 대상별 구역을 나누고 "비슷하게 생긴 것을 일괄로 쓸어
 * 가지 말라"고 적어 보냈다. 부탁이었다.
 *
 * 이제는 조각마다 **요청이 따로 나간다.** 다른 문구는 그 요청에 실리지도 않으므로
 * 섞일 자리가 없다. 부탁이 구조로 바뀐 자리다 — 그래서 여기서 재는 것도 "한
 * 프롬프트 안에서 갈렸는가"가 아니라 "요청이 갈렸는가"다.
 */
describe('§8 지시는 조각마다 따로 나간다', () => {
  async function sendTwo(): Promise<string[]> {
    await openStudio()
    await generateFirst()
    pick(/문구 1/)
    pick(/문구 5/)
    writeFor(/문구 1/, '숫자가 잘 읽히는 간결한 폰트로 바꿔 주세요.')
    writeFor(/문구 5/, '이 문구만 미래지향적인 얇은 글꼴로 바꿔 주세요.')
    fireEvent.click(runButton())
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 8000 })
    return calls.map((c) => String((c.init.body as FormData).get('prompt')))
  }

  it('sends one request per target, and neither carries the other instruction', async () => {
    const [first, second] = await sendTwo()
    expect(first).toContain('숫자가 잘 읽히는 간결한 폰트로 바꿔 주세요.')
    expect(first).not.toContain('미래지향적인')
    expect(second).toContain('이 문구만 미래지향적인 얇은 글꼴로 바꿔 주세요.')
    expect(second).not.toContain('숫자가 잘 읽히는')
  }, 25000)

  it('puts the exact wording and the box in each request', async () => {
    const prompts = await sendTwo()
    // 두 요청이 각자 자기 문구를 싣는다. 순서는 화면의 차례를 따른다.
    expect(prompts.join('\n')).toContain('08.01 ~ 08.31')
    // 긴 문구는 화면이 끊는 그 줄 그대로 실린다 — 한 줄로 붙어 있지 않다.
    expect(prompts.join('\n')).toContain('가장 먼저 만나는')
    // 고르지 않은 문구는 어느 요청에도 이름이 없다.
    for (const prompt of prompts) expect(prompt).not.toContain('신제품 출시')
  }, 25000)

  it('never asks to spare the others — they are not in the request at all', async () => {
    const [first] = await sendTwo()
    // 부탁하던 문장들이 사라졌다. 부탁할 대상이 요청에 없기 때문이다.
    expect(first).not.toContain('## 이번 수정의 절대 범위')
    expect(first).not.toContain('## 그대로 두어야 할 것')
    expect(first).toContain('문구 **한 개**만 새로 디자인')
  }, 25000)

  it('sends the current result first and only the chosen blocks originals', async () => {
    await openStudio()
    await generateFirst()
    pick(/이미지 2/)
    writeFor(/이미지 2/, '조금 아래로 옮겨 주세요.')
    fireEvent.click(runButton())
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 8000 })

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
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 8000 })
    // 문구 하나를 고쳤을 뿐이므로 제품 원본은 한 장도 실리지 않는다.
    expect(lastImageNames().join('|')).not.toContain('asset_')
  }, 25000)

  /**
   * 조각 수정은 **고른 개수만큼** 나간다 (컷아웃 갈림길 교정). 통이미지 한 장을
   * 고치던 시절에는 몇 개를 골라도 한 번이었지만, 그 한 번은 고르지 않은 것까지
   * 다시 그릴 수 있는 한 번이었다. 지금은 고른 것만 정확히 그만큼 나간다.
   */
  it('spends one call per chosen piece', async () => {
    await sendTwo()
    expect(calls).toHaveLength(2)
  }, 25000)
})

// ── 결과 이력 ────────────────────────────────────────────────────────────────

/**
 * 되돌리기 줄은 **통이미지 수정**이 만든다 (컷아웃 갈림길 교정).
 *
 * 조각 수정은 조각 하나를 갈아 끼우고 다시 합칠 뿐이라 줄에 칸을 더하지 않는다 —
 * 더하면 줄이 가리키는 그림과 지금 조각이 서로 다른 말을 하게 된다. 그래서 이
 * 묶음은 이미지 대상을 고른다: 이미지에는 문구 조각이 없으므로 지금도 통이미지
 * 수정으로 간다.
 */
describe('§8 결과는 앞뒤로 오갈 수 있는 줄이다', () => {
  async function editOnce(label: RegExp, text: string): Promise<void> {
    const wasShowing = (await result()).assetId
    pick(label)
    writeFor(label, text)
    fireEvent.click(runButton())
    const before = calls.length
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls.length).toBe(before + 1), { timeout: 8000 })
    // 새 결과가 자리를 잡을 때까지 — 이력 길이는 잘림 때문에 늘지 않을 수 있다.
    await waitFor(async () => expect((await result()).assetId).not.toBe(wasShowing), { timeout: 8000 })
  }

  it('starts with one revision at cursor 0', async () => {
    await openStudio()
    await generateFirst()
    const r = await result()
    expect(revisionsOf(r)).toHaveLength(1)
    expect(cursorOf(r)).toBe(0)
    expect(revisionsOf(r)[0]?.kind).toBe('initial')
    // 칸이 하나뿐일 때는 줄이 화면에 없다 (작업 목록 Patch). 오갈 데가 없는데
    // 꺼진 버튼 넷이 서 있으면 무엇을 하라는 자리인지 아무도 모른다 — 손검수에서
    // "이게 뭐였지? 어떤 버튼도 활성화 되지 않는데"로 걸렸다.
    expect(panel().textContent).not.toContain('결과 1 / 1')
    expect(within(panel()).queryByRole('button', { name: '이전 결과' })).toBeNull()
  }, 25000)

  it('grows to three revisions after two edits', async () => {
    await openStudio()
    await generateFirst()
    await editOnce(/이미지 1/, '간결한 폰트로')
    await editOnce(/이미지 2/, '조금 크게')
    const r = await result()
    expect(revisionsOf(r)).toHaveLength(3)
    expect(cursorOf(r)).toBe(2)
    expect(panel().textContent).toContain('결과 3 / 3')
  }, 40000)

  it('walks back and forward without spending anything', async () => {
    await openStudio()
    await generateFirst()
    await editOnce(/이미지 1/, '간결한 폰트로')
    const revisions = revisionsOf(await result())
    const spent = calls.length

    fireEvent.click(within(panel()).getByRole('button', { name: '이전 결과' }))
    await waitFor(async () => expect(cursorOf(await result())).toBe(0), { timeout: 8000 })
    expect((await result()).assetId).toBe(revisions[0]?.assetId)

    fireEvent.click(within(panel()).getByRole('button', { name: '다음 결과' }))
    await waitFor(async () => expect(cursorOf(await result())).toBe(1), { timeout: 8000 })
    expect((await result()).assetId).toBe(revisions[1]?.assetId)

    expect(calls).toHaveLength(spent)
  }, 40000)

  it('can still go forward after restoring the very first result', async () => {
    await openStudio()
    await generateFirst()
    await editOnce(/이미지 1/, '간결한 폰트로')
    const spent = calls.length

    fireEvent.click(within(panel()).getByRole('button', { name: '최초 생성본으로 복원' }))
    await waitFor(async () => expect(cursorOf(await result())).toBe(0), { timeout: 8000 })
    fireEvent.click(within(panel()).getByRole('button', { name: '다음 결과' }))
    await waitFor(async () => expect(cursorOf(await result())).toBe(1), { timeout: 8000 })
    expect(calls).toHaveLength(spent)
  }, 40000)

  it('disables the ends and keeps all revisions safe from the sweep', async () => {
    await openStudio()
    await generateFirst()
    const prev = () => within(panel()).getByRole('button', { name: '이전 결과' }) as HTMLButtonElement
    const next = () => within(panel()).getByRole('button', { name: '다음 결과' }) as HTMLButtonElement
    // 한 칸일 때는 줄이 없다. 고치고 나서 나타난다.
    expect(within(panel()).queryByRole('button', { name: '이전 결과' })).toBeNull()

    await editOnce(/이미지 1/, '간결한 폰트로')
    expect(panel().textContent).toContain('결과 2 / 2')
    expect(prev().disabled).toBe(false)
    expect(next().disabled).toBe(true)

    const ids = revisionsOf(await result()).map((r) => r.assetId)
    const kept = await allStudioAssetIds()
    for (const id of ids) expect(kept).toContain(id)
  }, 40000)

  it('cuts the future when a new edit starts from the middle', async () => {
    await openStudio()
    await generateFirst()
    await editOnce(/이미지 1/, '간결한 폰트로')
    await editOnce(/이미지 2/, '조금 크게')
    expect(revisionsOf(await result())).toHaveLength(3)

    fireEvent.click(within(panel()).getByRole('button', { name: '이전 결과' }))
    await waitFor(async () => expect(cursorOf(await result())).toBe(1), { timeout: 8000 })

    await editOnce(/이미지 1/, '가운데로')
    const r = await result()
    // 1(최초) + 1(첫 수정) + 새 수정 = 3. 잘려 나간 미래 하나는 사라졌다.
    expect(revisionsOf(r)).toHaveLength(3)
    expect(cursorOf(r)).toBe(2)
  }, 50000)

  it('uses the image at the cursor as the first input of the next edit', async () => {
    await openStudio()
    await generateFirst()
    await editOnce(/이미지 1/, '간결한 폰트로')
    fireEvent.click(within(panel()).getByRole('button', { name: '이전 결과' }))
    await waitFor(async () => expect(cursorOf(await result())).toBe(0), { timeout: 8000 })
    const atCursor = (await result()).assetId

    // 통이미지 수정이라야 "현재 결과 이미지"를 첫 입력으로 싣는다.
    pick(/이미지 2/)
    writeFor(/이미지 2/, '조금 크게')
    fireEvent.click(runButton())
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 8000 })
    // 첫 입력 이미지는 지금 커서가 가리키는 그림이다.
    expect(lastImageNames()[0]).toContain('current-result')
    expect(revisionsOf(await result())[0]?.assetId).toBe(atCursor)
  }, 50000)

  it('leaves the history untouched when an edit fails', async () => {
    await openStudio()
    await generateFirst()
    await editOnce(/이미지 1/, '간결한 폰트로')
    const before = await result()

    failNext = true
    pick(/문구 2/)
    writeFor(/문구 2/, '조금 크게')
    fireEvent.click(runButton())
    fireEvent.click(screen.getByRole('button', { name: '수정 시작' }))
    await waitFor(() => expect(screen.getByText(/크레딧|결제/)).toBeTruthy(), { timeout: 8000 })

    const after = await result()
    expect(revisionsOf(after)).toEqual(revisionsOf(before))
    expect(cursorOf(after)).toBe(cursorOf(before))
    expect(after.assetId).toBe(before.assetId)
  }, 40000)

  it('keeps every revision at 840 by the page height', async () => {
    await openStudio()
    await generateFirst()
    await editOnce(/이미지 1/, '간결한 폰트로')
    expect((await result()).workingSize).toBe('840x1488')
  }, 40000)

  it('normalises an older job that only knew original/previous/current', async () => {
    // 예전 판에서 저장된 모양 그대로.
    const job = readyJob()
    const page = job.doc.pages[0]!.id
    await putAsset(storedAsset('asset_first', 7))
    await putAsset(storedAsset('asset_second', 8))
    await saveStudioJob({
      ...job,
      results: {
        [page]: {
          pageId: page,
          assetId: 'asset_second',
          originalAssetId: 'asset_first',
          previousAssetId: 'asset_first',
          model: 'gpt-image-2',
          quality: 'medium',
          requestedSize: '832x1472',
          workingSize: '840x1488',
          sourceFingerprint: 'x',
          createdAt: 1,
          editCount: 1,
        },
      },
    })

    await openStudio()
    const r = await result()
    // 현재 결과를 잃지 않고, 같은 자산이 두 번 들어가지 않는다.
    expect(r.assetId).toBe('asset_second')
    const ids = revisionsOf(r).map((x) => x.assetId)
    expect(ids).toContain('asset_second')
    expect(new Set(ids).size).toBe(ids.length)
    expect(cursorOf(r)).toBe(ids.indexOf('asset_second'))
  }, 25000)
})
