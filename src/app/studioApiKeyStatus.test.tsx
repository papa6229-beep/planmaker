/**
 * 테스트용 API 키가 이 탭에 있는지 화면이 말해 준다 (마감 교정 §2).
 *
 * 키를 저장해도 버튼이 계속 `API 키`라고만 적혀 있으면, 사용자는 저장이 됐는지
 * 알 길이 없어 같은 키를 다시 넣거나 넣지 않은 채 생성을 누른다. 상태는 키
 * **자체**에서 파생되어야 하고, 그 파생값 말고는 아무것도 화면에 내보이지
 * 않는다 — 키의 앞자리도, 뒷자리도, 길이도.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
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
import { createStudioJob, linkProductImage, withSource } from '../domain/studioJob'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'

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

const FAKE_KEY = 'sk-test-status-key-123456789'
const FAKE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUg=='

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

function readyDoc() {
  const doc = createEmptyDocument(createEmptyProject('키 상태 확인'))
  const slot = createBlock('main_product_image', {
    id: 'blk_image',
    content: '제품 컷',
    assetId: 'asset_ref',
    position: { x: 100, y: 100, width: 600, height: 400 },
  })
  slot.image = { referenceOnly: true }
  doc.pages[0]!.blocks = [slot]
  doc.pages[0]!.canvasHeight = 1000
  doc.assets = [{ id: 'asset_ref', fileName: 'asset_ref.png', mimeType: 'image/png' }]
  return doc
}

let calls: { init: RequestInit }[] = []
let respond: () => Promise<Response>

beforeEach(async () => {
  calls = []
  respond = async () =>
    new Response(
      JSON.stringify({
        image: { b64: FAKE_PNG_B64, mimeType: 'image/png' },
        metadata: { model: 'gpt-image-2', quality: 'medium', requestedSize: '832x992', requestId: 'req_1' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
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

  const doc = readyDoc()
  await saveStudioJob(
    linkProductImage(withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, '키.eventbrief'), 'blk_image', 'asset_cut'),
  )
  await putAsset(storedAsset('asset_ref', 1))
  await putAsset(storedAsset('asset_cut', 2))
})

afterEach(() => cleanup())

async function openStudio(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('키 상태 확인')
  }, { timeout: 8000 })
}

/** 키 버튼 — 문구가 상태를 말한다. */
function keyButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((b) => /API 키/.test(b.textContent ?? ''))
  expect(button).toBeTruthy()
  return button as HTMLButtonElement
}

describe('§2 키가 이 탭에 있는지 버튼이 말해 준다', () => {
  it('says just API 키 before anything is entered', async () => {
    await openStudio()
    expect(keyButton().textContent?.trim()).toBe('API 키')
  }, 20000)

  it('switches to ✓ API 키 저장됨 the moment a key is saved', async () => {
    await openStudio()
    fireEvent.click(keyButton())
    fireEvent.change(screen.getByLabelText('새 API 키'), { target: { value: FAKE_KEY } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('✓ API 키 저장됨'))
    // 저장된 상태는 눈으로도 구분된다.
    expect(keyButton().className).toContain('is-saved')
  }, 20000)

  it('also notices a key saved on the way into a generation', async () => {
    await openStudio()
    fireEvent.click(screen.getByRole('button', { name: '이미지 생성하기' }))
    fireEvent.change(screen.getByLabelText('테스트용 OpenAI API 키'), { target: { value: FAKE_KEY } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 계속' }))

    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('✓ API 키 저장됨'), { timeout: 8000 })
  }, 20000)

  it('still opens for changing the key that is already there', async () => {
    await openStudio()
    fireEvent.click(keyButton())
    fireEvent.change(screen.getByLabelText('새 API 키'), { target: { value: FAKE_KEY } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('✓ API 키 저장됨'))

    // 저장된 뒤에도 눌러서 바꿀 수 있다.
    fireEvent.click(keyButton())
    fireEvent.change(screen.getByLabelText('새 API 키'), { target: { value: 'sk-second-key-987654321' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('✓ API 키 저장됨'))

    const { readApiKey } = await import('../features/studio/apiKeySession')
    expect(readApiKey()).toBe('sk-second-key-987654321')
  }, 20000)

  it('goes back to API 키 the moment the key is cleared', async () => {
    await openStudio()
    fireEvent.click(keyButton())
    fireEvent.change(screen.getByLabelText('새 API 키'), { target: { value: FAKE_KEY } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('✓ API 키 저장됨'))

    fireEvent.click(keyButton())
    fireEvent.click(screen.getByRole('button', { name: '키 지우기' }))
    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('API 키'))
  }, 20000)

  it('never puts the key on screen, in a lasting store, or in the job', async () => {
    await openStudio()
    fireEvent.click(keyButton())
    fireEvent.change(screen.getByLabelText('새 API 키'), { target: { value: FAKE_KEY } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('✓ API 키 저장됨'))

    // 화면 어디에도 키가 다시 보이지 않는다 — 끝자리 한 글자도.
    expect(document.body.textContent).not.toContain(FAKE_KEY)
    expect(document.body.textContent).not.toContain(FAKE_KEY.slice(-4))
    expect(JSON.stringify(localStorage)).not.toContain(FAKE_KEY)
    expect(JSON.stringify(await loadStudioJob(STUDIO_JOB_ID))).not.toContain(FAKE_KEY)
    expect(window.location.href).not.toContain(FAKE_KEY)
  }, 20000)

  it('기억을 켜지 않으면 브라우저에 남지 않는다', async () => {
    // 기본은 지금까지와 같다 — 탭을 닫으면 사라진다.
    await openStudio()
    fireEvent.click(keyButton())
    fireEvent.change(screen.getByLabelText('새 API 키'), { target: { value: FAKE_KEY } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('✓ API 키 저장됨'))
    expect(JSON.stringify(localStorage)).not.toContain(FAKE_KEY)
    expect(JSON.stringify(sessionStorage)).toContain(FAKE_KEY)
  }, 20000)

  it('기억을 켜면 브라우저를 다시 열어도 남아 있다', async () => {
    // 손검수: "그냥 지금 쓰는 키 한번 입력하고 저장버튼 누르면 새 키 넣을 때까지
    // 매번 수동입력 안 하고 쓸 수 있게."
    await openStudio()
    fireEvent.click(keyButton())
    fireEvent.change(screen.getByLabelText('새 API 키'), { target: { value: FAKE_KEY } })
    fireEvent.click(screen.getByLabelText(/이 브라우저에 기억/))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('✓ API 키 저장됨'))

    // 탭을 닫은 것과 같은 자리 — 세션은 비었는데 키는 살아 있어야 한다.
    cleanup()
    sessionStorage.clear()
    await openStudio()
    expect(keyButton().textContent?.trim()).toBe('✓ API 키 저장됨')
    // 그리고 창을 다시 열면 기억이 켜진 채다 — 저장할 때마다 켜야 한다면 기억이 아니다.
    fireEvent.click(keyButton())
    expect((screen.getByLabelText(/이 브라우저에 기억/) as HTMLInputElement).checked).toBe(true)
  }, 25000)

  it('키 지우기는 양쪽을 다 지운다', async () => {
    // 한쪽만 지우면 지운 줄 알았는데 브라우저에 그대로 있다.
    await openStudio()
    fireEvent.click(keyButton())
    fireEvent.change(screen.getByLabelText('새 API 키'), { target: { value: FAKE_KEY } })
    fireEvent.click(screen.getByLabelText(/이 브라우저에 기억/))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('✓ API 키 저장됨'))

    fireEvent.click(keyButton())
    fireEvent.click(screen.getByRole('button', { name: '키 지우기' }))
    await waitFor(() => expect(keyButton().textContent?.trim()).toBe('API 키'))
    expect(JSON.stringify(localStorage)).not.toContain(FAKE_KEY)
    expect(JSON.stringify(sessionStorage)).not.toContain(FAKE_KEY)
  }, 25000)

  it('still shows the structured 401 for a bad key', async () => {
    await openStudio()
    respond = async () =>
      new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'raw provider text' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    fireEvent.click(screen.getByRole('button', { name: '이미지 생성하기' }))
    fireEvent.change(screen.getByLabelText('테스트용 OpenAI API 키'), { target: { value: FAKE_KEY } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 계속' }))

    await waitFor(
      () => expect(screen.getByText('API 키가 올바르지 않습니다. 키를 다시 입력해 주세요.')).toBeTruthy(),
      { timeout: 8000 },
    )
    expect(document.body.textContent).not.toContain('raw provider text')
    expect(document.body.textContent).not.toContain(FAKE_KEY)
  }, 20000)
})
