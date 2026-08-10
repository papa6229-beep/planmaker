/**
 * Image Studio 1단계 — 실제 이미지 생성 연결 (§13).
 *
 * 이 단계에서 지켜야 할 경계는 넷이다.
 *
 *  1. GPT에게 나가는 것은 `GenerationRequest` 하나에서만 나온다. 사람이 미리보기
 *     화면에서 읽은 것과 모델이 받는 것이 갈라지면 두 화면 다 의미가 없다.
 *  2. 입력 이미지의 순서와 역할은 언제나 같아야 한다. "몇 번째가 무엇인지"를
 *     프롬프트가 말하는데 순서가 흔들리면 그 말이 거짓이 된다.
 *  3. 연결 주소(URL)는 이미지 제작 입력에 들어가지 않는다. 0단계에서 세운 이
 *     경계는 프롬프트 문자열까지 이어져야 한다.
 *  4. 실패는 아무것도 잃지 않는다. 키가 없으면 호출하지 않고, 실패하면 기획서와
 *     이전 결과가 그대로 남는다.
 *
 * 여기서는 실제 OpenAI를 호출하지 않는다. `fetch` 경계에 가짜 응답을 주입해,
 * 우리가 무엇을 보내는지와 무엇을 하는지만 본다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { resetAccessModeForTests } from '../features/studio/apiKeySession'
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
import { buildGenerationRequest } from '../domain/generationRequest'
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
/**
 * 결과는 받은 뒤 `840 × 페이지 세로길이` 작업본으로 맞춰 저장된다 (마감 교정 §3).
 * jsdom에는 캔버스가 없으므로 재고 그리는 부분만 갈아 끼운다 — 실제 픽셀 확인은
 * 브라우저 인수검사와 `studioWorkingImage` 검사가 맡는다.
 */
vi.mock('../services/canvasImageOps', () => ({
  measureImage: async () => ({ width: 832, height: 992 }),
  drawToSize: async (_blob: Blob, width: number, height: number) =>
    new Blob([`drawn:${String(width)}x${String(height)}`], { type: 'image/png' }),
}))

const PRODUCT_URL = 'https://shop.example.com/goods/12345'
const FAKE_KEY = 'sk-test-not-a-real-key-0000'
/** 가짜 응답의 PNG 1픽셀. base64는 서버 함수 응답 모양을 그대로 흉내 낸다. */
const FAKE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUg=='

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 6,
  }
}

/** 이미지 자리 하나, 문구 하나, 버튼과 그 주소가 있는 한 장짜리 기획서. */
function sampleDoc(): BriefDocument {
  const project = createEmptyProject('가을 신상 예약판매')
  project.concept = '단정하고 신뢰감 있게'
  project.aiNote = '모델 컷은 정면으로 부탁합니다'
  const doc = createEmptyDocument(project)
  const headline = createBlock('free_text', {
    id: 'blk_text',
    content: '가을 신상 예약판매',
    position: { x: 84, y: 100, width: 420, height: 120 },
    layoutHint: { emphasis: 'high', alignment: 'center' },
  })
  const slot = createBlock('main_product_image', {
    id: 'blk_image',
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
  doc.pages[0]!.blocks = [headline, slot, button, url]
  doc.pages[0]!.canvasHeight = 1000
  doc.assets = [
    { id: 'asset_ref', fileName: 'asset_ref.png', mimeType: 'image/png' },
    { id: 'asset_cut', fileName: 'asset_cut.png', mimeType: 'image/png' },
  ]
  return doc
}

/** 제품 이미지까지 연결된, 바로 생성할 수 있는 작업. */
function readyJob(doc = sampleDoc()) {
  const job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, '가을.eventbrief')
  return linkProductImage(job, 'blk_image', 'asset_cut')
}

// ── 가짜 서버 ────────────────────────────────────────────────────────────────
/**
 * 이번 검사에서 나간 `/api/generate-image` 요청 전부.
 *
 * 갈래 묻기(`/api/access-mode`)는 여기 담지 않는다 — 우리 함수이고 값이 붙지
 * 않는다 (서버 키 Patch). 담으면 "공급자를 몇 번 불렀는가"를 재는 모든 검사가
 * 한 건씩 밀린다.
 */
let calls: { url: string; init: RequestInit }[] = []
let respond: (call: { url: string; init: RequestInit }) => Promise<Response>

function okResponse(): Promise<Response> {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        image: { b64: FAKE_PNG_B64, mimeType: 'image/png' },
        metadata: {
          model: 'gpt-image-2',
          quality: 'medium',
          requestedSize: '832x992',
          requestId: 'req_fake_123',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
}

beforeEach(async () => {
  calls = []
  respond = okResponse
  // 앞 검사가 물어 둔 갈래가 새지 않게 한다 (서버 키 Patch).
  resetAccessModeForTests()
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/access-mode')) {
      return new Response(JSON.stringify({ mode: 'client-key' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const call = { url, init: init ?? {} }
    calls.push(call)
    return respond(call)
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
})

afterEach(() => {
  cleanup()
})

async function openStudio(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('가을 신상 예약판매')
  }, { timeout: 8000 })
}

/** 생성 버튼 → (키 입력) → 생성 시작까지, 한 번에. */
async function generateOnce(key = FAKE_KEY): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /이미지 생성하기|다시 생성하기/ }))
  const field = screen.queryByLabelText('테스트용 OpenAI API 키')
  if (field !== null) {
    fireEvent.change(field, { target: { value: key } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 계속' }))
  } else {
    fireEvent.click(screen.getByRole('button', { name: '생성 시작' }))
  }
}

async function seedReady(doc = sampleDoc()): Promise<void> {
  await saveStudioJob(readyJob(doc))
  await putAsset(storedAsset('asset_ref', 1))
  await putAsset(storedAsset('asset_cut', 2))
}

// ── §13-7·8 크기 변환 ────────────────────────────────────────────────────────

describe('§13-7·8 OpenAI가 받아 주는 크기로 바꾼다', () => {
  it('turns the 840px canvas into a size the model accepts', async () => {
    const { resolveGptImageSize } = await import('../domain/gptImageSize')
    const r = resolveGptImageSize(840, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 두 변 모두 16의 배수.
    expect(r.width % 16).toBe(0)
    expect(r.height % 16).toBe(0)
    // 840은 16의 배수가 아니므로 첫 시험 기준은 832다.
    expect(r.width).toBe(832)
    expect(r.size).toBe(`${r.width}x${r.height}`)
    // 자르지 않는다 — 원본 비율에서 반올림 한 칸 이상 벗어나지 않는다.
    expect(Math.abs(r.height / r.width - 1000 / 840)).toBeLessThan(16 / 832)
  })

  it('grows a small page instead of sending too few pixels', async () => {
    const { resolveGptImageSize, MIN_TOTAL_PIXELS } = await import('../domain/gptImageSize')
    const r = resolveGptImageSize(840, 300)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.width * r.height).toBeGreaterThanOrEqual(MIN_TOTAL_PIXELS)
    expect(r.width % 16).toBe(0)
    expect(r.height % 16).toBe(0)
  })

  it('refuses a page taller than 3:1 instead of cropping or splitting it', async () => {
    const { resolveGptImageSize } = await import('../domain/gptImageSize')
    const r = resolveGptImageSize(840, 3200)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toBe('현재 페이지는 1장 생성이 가능한 최대 세로 비율을 넘었습니다. 페이지를 나누어 다시 시도해 주세요.')
  })

  it('never exceeds the documented pixel and edge limits', async () => {
    const { resolveGptImageSize, MAX_TOTAL_PIXELS, MAX_EDGE } = await import('../domain/gptImageSize')
    for (const height of [300, 840, 1000, 1400, 2520]) {
      const r = resolveGptImageSize(840, height)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.width * r.height).toBeLessThanOrEqual(MAX_TOTAL_PIXELS)
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_EDGE)
    }
  })
})

// ── §13-6 입력 이미지 순서 ───────────────────────────────────────────────────

describe('§13-6 입력 이미지의 순서와 역할은 고정이다', () => {
  it('always puts the page layout first, then product images, then references', async () => {
    const { planGenerationInputs } = await import('../domain/imageGenerationInputs')
    const doc = sampleDoc()
    doc.pages[0]!.reference = { ...doc.pages[0]!.reference, assetId: 'asset_page', viewMode: 'overlay', visible: true }
    doc.assets.push({ id: 'asset_page', fileName: 'asset_page.png', mimeType: 'image/png' })
    const request = buildGenerationRequest(doc, readyJob(doc), doc.pages[0]!.id)

    const inputs = planGenerationInputs(request)
    expect(inputs.map((i) => i.role)).toEqual([
      'page_layout',
      'product_image',
      'slot_reference',
      'page_reference',
    ])
    expect(inputs[0]?.index).toBe(1)
    expect(inputs[0]?.assetId).toBeUndefined()
    expect(inputs[1]).toMatchObject({ index: 2, blockId: 'blk_image', assetId: 'asset_cut' })
    expect(inputs[2]).toMatchObject({ index: 3, blockId: 'blk_image', assetId: 'asset_ref' })
    expect(inputs[3]).toMatchObject({ index: 4, assetId: 'asset_page' })
  })

  it('gives the same order every time it is asked', async () => {
    const { planGenerationInputs } = await import('../domain/imageGenerationInputs')
    const doc = sampleDoc()
    const request = buildGenerationRequest(doc, readyJob(doc), doc.pages[0]!.id)
    const once = planGenerationInputs(request)
    const twice = planGenerationInputs(request)
    expect(twice).toEqual(once)
  })
})

// ── §13-4·5 프롬프트 ─────────────────────────────────────────────────────────

describe('§13-4·5 프롬프트는 기획서를 원문 그대로 옮기고 주소는 뺀다', () => {
  async function promptFor(doc: BriefDocument): Promise<string> {
    const { buildOpenAIImagePrompt } = await import('../domain/imagePrompt')
    const { planGenerationInputs } = await import('../domain/imageGenerationInputs')
    const request = buildGenerationRequest(doc, readyJob(doc), doc.pages[0]!.id)
    return buildOpenAIImagePrompt(request, planGenerationInputs(request))
  }

  it('carries every word of the brief exactly as written', async () => {
    const prompt = await promptFor(sampleDoc())
    expect(prompt).toContain('가을 신상 예약판매')
    expect(prompt).toContain('지금 예약하기')
    expect(prompt).toContain('니트 정면 컷이 들어갑니다')
    expect(prompt).toContain('단정하고 신뢰감 있게')
    expect(prompt).toContain('모델 컷은 정면으로 부탁합니다')
  })

  it('never lets a publishing URL into the design prompt', async () => {
    const prompt = await promptFor(sampleDoc())
    expect(prompt).not.toContain(PRODUCT_URL)
    expect(prompt).not.toContain('shop.example.com')
    expect(prompt).not.toMatch(/https?:\/\//)
  })

  it('states the input image order and what each one is', async () => {
    const prompt = await promptFor(sampleDoc())
    expect(prompt).toContain('입력 이미지 1')
    expect(prompt).toContain('입력 이미지 2')
    // 어떤 자리에 붙는 제품인지 프롬프트가 말한다.
    expect(prompt).toContain('blk_image')
  })

  it('says the brief is a work order, not the finished design', async () => {
    const prompt = await promptFor(sampleDoc())
    expect(prompt).toContain('작업 지시서')
    expect(prompt).toContain('원문 그대로')
  })

  it('keeps the reference capture and the real product apart', async () => {
    const prompt = await promptFor(sampleDoc())
    expect(prompt).toContain('참고')
    expect(prompt).toContain('실제 사용 제품 이미지')
  })

  it('gives the page size and each block box', async () => {
    const prompt = await promptFor(sampleDoc())
    expect(prompt).toContain('840')
    expect(prompt).toContain('1000')
    expect(prompt).toContain('600')
  })
})

// ── §13-3 OpenAI 요청 경계 ───────────────────────────────────────────────────

describe('§13-3 OpenAI 요청은 정해진 값 그대로 나간다', () => {
  async function callWithFakeOpenAi(): Promise<{ body: FormData; headers: Headers }> {
    const { requestOpenAiImage } = await import('../services/openAiImageClient')
    let seen: { body: FormData; headers: Headers } | null = null
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      seen = { body: init.body as FormData, headers: new Headers(init.headers) }
      return new Response(
        JSON.stringify({ created: 1, data: [{ b64_json: FAKE_PNG_B64 }], usage: { total_tokens: 10 } }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_openai_1' } },
      )
    }) as unknown as typeof fetch

    await requestOpenAiImage(
      {
        apiKey: FAKE_KEY,
        prompt: '테스트 프롬프트',
        size: '832x992',
        images: [
          { fileName: 'page.png', blob: new Blob([new Uint8Array([1])], { type: 'image/png' }) },
          { fileName: 'cut.png', blob: new Blob([new Uint8Array([2])], { type: 'image/png' }) },
        ],
      },
      { fetch: fakeFetch },
    )
    return seen!
  }

  it('sends gpt-image-2 at medium quality, one png, with no fidelity override', async () => {
    const { body } = await callWithFakeOpenAi()
    expect(body.get('model')).toBe('gpt-image-2')
    expect(body.get('quality')).toBe('medium')
    expect(body.get('n')).toBe('1')
    expect(body.get('output_format')).toBe('png')
    expect(body.get('size')).toBe('832x992')
    // gpt-image-2는 이미지 입력을 스스로 고정밀 처리한다 — 지정하지 않는다.
    expect(body.get('input_fidelity')).toBeNull()
    // 중간 이미지도 스트리밍도 쓰지 않는다.
    expect(body.get('stream')).toBeNull()
    expect(body.get('partial_images')).toBeNull()
  })

  it('sends the images in the order it was given them', async () => {
    const { body } = await callWithFakeOpenAi()
    const files = body.getAll('image[]')
    expect(files).toHaveLength(2)
    expect((files[0] as File).name).toBe('page.png')
    expect((files[1] as File).name).toBe('cut.png')
  })

  it('never retries by itself', async () => {
    const { requestOpenAiImage } = await import('../services/openAiImageClient')
    let attempts = 0
    const failing = (async () => {
      attempts += 1
      return new Response(JSON.stringify({ error: { message: 'boom', code: 'server_error' } }), { status: 500 })
    }) as unknown as typeof fetch

    await expect(
      requestOpenAiImage(
        { apiKey: FAKE_KEY, prompt: 'p', size: '832x992', images: [] },
        { fetch: failing },
      ),
    ).rejects.toThrow()
    expect(attempts).toBe(1)
  })

  it('keeps the key out of the error it throws', async () => {
    const { requestOpenAiImage } = await import('../services/openAiImageClient')
    const failing = (async () =>
      new Response(JSON.stringify({ error: { message: `bad key ${FAKE_KEY}`, code: 'invalid_api_key' } }), {
        status: 401,
      })) as unknown as typeof fetch

    const err = await requestOpenAiImage(
      { apiKey: FAKE_KEY, prompt: 'p', size: '832x992', images: [] },
      { fetch: failing },
    ).catch((e: unknown) => e)
    expect(String(err)).not.toContain(FAKE_KEY)
    expect(JSON.stringify(err)).not.toContain(FAKE_KEY)
  })
})

// ── §13-15 SPA rewrite ───────────────────────────────────────────────────────

describe('§13-15 API 주소는 SPA 화면으로 삼켜지지 않는다', () => {
  it('leaves /api out of the single-page fallback', async () => {
    const raw = await import('../../vercel.json')
    const config = (raw.default ?? raw) as { rewrites?: { source: string; destination: string }[] }
    const fallback = (config.rewrites ?? []).filter((r) => r.destination === '/')
    expect(fallback.length).toBeGreaterThan(0)
    for (const rule of fallback) {
      // `/(.*)`처럼 무엇이든 삼키는 규칙이면 함수 주소가 화면으로 넘어간다.
      expect(new RegExp(`^${rule.source}$`).test('/api/generate-image')).toBe(false)
    }
  })
})

// ── §13-1·10·11 생성 버튼과 결과 비교 화면 ───────────────────────────────────

describe('§13-1·10·11 생성 버튼과 결과 비교 화면', () => {
  it('offers 이미지 생성하기 on the studio surface', async () => {
    await seedReady()
    await openStudio()
    expect(screen.getByRole('button', { name: '이미지 생성하기' })).toBeTruthy()
  })

  it('never shows it on the brief writer', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes surface="brief-writer" />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.body.textContent).toBeTruthy())
    expect(screen.queryByRole('button', { name: '이미지 생성하기' })).toBeNull()
  })

  it('asks for the key first and calls nothing until it has one', async () => {
    await seedReady()
    await openStudio()
    fireEvent.click(screen.getByRole('button', { name: '이미지 생성하기' }))
    expect(screen.getByLabelText('테스트용 OpenAI API 키')).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('shows what it is about to do before spending anything', async () => {
    await seedReady()
    await openStudio()
    fireEvent.click(screen.getByRole('button', { name: '이미지 생성하기' }))
    const dialog = screen.getByRole('dialog', { name: '이미지 생성' })
    expect(dialog.textContent).toContain('gpt-image-2')
    expect(dialog.textContent).toContain('medium')
    expect(dialog.textContent).toContain('832x992')
    expect(dialog.textContent).toContain('1회')
  })

  it('sends exactly one request no matter how often the button is hit', async () => {
    await seedReady()
    await openStudio()
    // 첫 호출을 붙잡아 두고, 그 사이에 계속 누른다.
    let release: (() => void) | null = null
    respond = (call) => new Promise<Response>((resolve) => {
      release = () => void okResponse().then(resolve)
      void call
    })

    await generateOnce()
    await waitFor(() => expect(calls).toHaveLength(1))
    const button = () => screen.getByRole('button', { name: /이미지 생성/ })
    expect(button().textContent).toContain('이미지 생성 중…')
    fireEvent.click(button())
    fireEvent.click(button())
    expect(calls).toHaveLength(1)

    release!()
    await waitFor(() => expect(screen.getByRole('button', { name: '다시 생성하기' })).toBeTruthy(), { timeout: 8000 })
    expect(calls).toHaveLength(1)
  }, 20000)

  it('sends the key in the header and nowhere else', async () => {
    await seedReady()
    await openStudio()
    await generateOnce()
    await waitFor(() => expect(calls).toHaveLength(1))
    const call = calls[0]!
    expect(call.url).toContain('/api/generate-image')
    expect(new Headers(call.init.headers).get('X-OpenAI-API-Key')).toBe(FAKE_KEY)
    // 주소에도, 본문의 텍스트 부분에도 키가 없다.
    expect(call.url).not.toContain(FAKE_KEY)
    const form = call.init.body as FormData
    for (const [, value] of form.entries()) {
      if (typeof value === 'string') expect(value).not.toContain(FAKE_KEY)
    }
  })

  it('opens the comparison view by itself once a result comes back', async () => {
    await seedReady()
    await openStudio()
    expect(screen.queryByRole('radio', { name: '완성본' })).toBeNull()
    await generateOnce()
    await waitFor(() => {
      // 완성본을 보는 동안에는 중앙 보기 줄이 아예 없다 (기획서 탭 감추기 Patch).
      // 그래서 "완성본으로 넘어갔는가"는 그 화면의 제목으로 묻는다.
      expect(screen.getByRole('heading', { name: '완성본' })).toBeTruthy()
    }, { timeout: 8000 })
    expect(screen.getByRole('heading', { name: '완성본' })).toBeTruthy()
    // 완성본이 가운데를 다 쓴다 — 기획서는 접혀 있다 (완성본 모드 Patch).
    expect(screen.queryByText('기획서 작업본')).toBeNull()
    expect(document.querySelector('.compare__brief .canvas')).toBeNull()
    // 꺼내면 복제본이 아니라 그대로의 캔버스다 — 계속 편집할 수 있다.
    fireEvent.click(screen.getByRole('button', { name: '기획서 나란히 보기' }))
    await waitFor(() => {
      expect(document.querySelector('.compare__brief .canvas')).toBeTruthy()
    }, { timeout: 5000 })
    expect(screen.getByText('기획서 작업본')).toBeTruthy()
  }, 20000)

  it('will not call when an image slot has no real product image', async () => {
    const doc = sampleDoc()
    // 연결하지 않은 자리를 하나 더 둔다.
    doc.pages[0]!.blocks.push(
      createBlock('main_product_image', {
        id: 'blk_image2',
        content: '뒷면 컷',
        position: { x: 120, y: 720, width: 600, height: 200 },
      }),
    )
    await seedReady(doc)
    await openStudio()
    fireEvent.click(screen.getByRole('button', { name: '이미지 생성하기' }))
    await waitFor(() =>
      expect(screen.getByText('실제 제품 이미지가 연결되지 않은 자리가 1개 있습니다.')).toBeTruthy(),
    )
    expect(calls).toHaveLength(0)
  })

  it('generates a brief that has no image slots at all', async () => {
    const doc = createEmptyDocument(createEmptyProject('가을 신상 예약판매'))
    doc.pages[0]!.blocks = [createBlock('free_text', { id: 'only_text', content: '문구만 있습니다' })]
    await saveStudioJob(withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, '문구.eventbrief'))
    await openStudio()
    await generateOnce()
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 8000 })
  }, 20000)
})

// ── §13-9·12·13·14 결과 보존 ─────────────────────────────────────────────────

describe('§13-9·12·13·14 결과는 페이지별로 남고, 실패해도 잃지 않는다', () => {
  it('stores the result as an asset, keeping only its id in the job', async () => {
    await seedReady()
    await openStudio()
    await generateOnce()
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(Object.keys(job?.results ?? {})).toHaveLength(1)
    }, { timeout: 8000 })

    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const pageId = job.doc.pages[0]!.id
    const result = job.results[pageId]!
    expect(result.model).toBe('gpt-image-2')
    expect(result.quality).toBe('medium')
    expect(result.requestedSize).toBe('832x992')
    expect(result.requestId).toBe('req_fake_123')
    expect(typeof result.createdAt).toBe('number')
    expect(result.sourceFingerprint.length).toBeGreaterThan(0)
    // 이미지 자체는 자산 저장소에 있고, 작업 행에는 그 번호만 있다.
    expect(JSON.stringify(job).length).toBeLessThan(200_000)
    expect((await getAllAssets()).map((a) => a.id)).toContain(result.assetId)
  }, 20000)

  it('protects the generated image from the asset sweep', async () => {
    await seedReady()
    await openStudio()
    await generateOnce()
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(Object.keys(job?.results ?? {})).toHaveLength(1)
    }, { timeout: 8000 })
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const resultId = job.results[job.doc.pages[0]!.id]!.assetId
    expect(await allStudioAssetIds()).toContain(resultId)
  }, 20000)

  it('brings the result back after a refresh', async () => {
    await seedReady()
    await openStudio()
    await generateOnce()
    await waitFor(() => expect(screen.getByRole('heading', { name: '완성본' })).toBeTruthy(), { timeout: 8000 })

    cleanup()
    await openStudio()
    // 새로 열면 기획서 작업이 먼저지만, 결과는 그대로 있어 다시 열 수 있다.
    fireEvent.click(await screen.findByRole('radio', { name: '완성본' }))
    expect(screen.getByRole('heading', { name: '완성본' })).toBeTruthy()
  }, 25000)

  it('marks the result as older than the brief once the brief changes', async () => {
    await seedReady()
    await openStudio()
    await generateOnce()
    await waitFor(() => expect(screen.getByRole('heading', { name: '완성본' })).toBeTruthy(), { timeout: 8000 })
    expect(screen.queryByText('기획서 수정 전 생성 결과')).toBeNull()

    fireEvent.change(document.querySelector('.editor-topbar__title') as HTMLInputElement, {
      target: { value: '가을 신상 예약판매 v2' },
    })
    await waitFor(() => expect(screen.getByText('기획서 수정 전 생성 결과')).toBeTruthy(), { timeout: 8000 })
    // 낡았다고 말할 뿐 지우지는 않는다.
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(Object.keys(job.results)).toHaveLength(1)
  }, 25000)

  it('keeps the brief and the previous result when a call fails', async () => {
    await seedReady()
    await openStudio()
    await generateOnce()
    await waitFor(() => expect(screen.getByRole('heading', { name: '완성본' })).toBeTruthy(), { timeout: 8000 })
    const before = (await loadStudioJob(STUDIO_JOB_ID))!
    const firstResult = before.results[before.doc.pages[0]!.id]!

    respond = async () =>
      new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: '크레딧이 부족합니다.' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    await generateOnce()
    await waitFor(() => expect(screen.getByText(/크레딧|결제/)).toBeTruthy(), { timeout: 8000 })

    const after = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(after.results[after.doc.pages[0]!.id]).toEqual(firstResult)
    expect(after.doc.project.title).toBe('가을 신상 예약판매')
    // 실패했으므로 다시 누를 수 있어야 한다.
    expect((screen.getByRole('button', { name: /이미지 생성|다시 생성/ }) as HTMLButtonElement).disabled).toBe(false)
  }, 30000)
})

// ── 키 보관 ──────────────────────────────────────────────────────────────────

describe('테스트용 API 키는 이 탭에만 머문다', () => {
  it('survives a refresh in the same tab', async () => {
    const { saveApiKey, readApiKey } = await import('../features/studio/apiKeySession')
    saveApiKey(FAKE_KEY)
    expect(readApiKey()).toBe(FAKE_KEY)
    // 같은 탭의 새로고침 = 같은 sessionStorage.
    expect(sessionStorage.getItem('planmaker.openai-key')).toBe(FAKE_KEY)
  })

  it('starts empty in a new browser session', async () => {
    const { saveApiKey, readApiKey } = await import('../features/studio/apiKeySession')
    saveApiKey(FAKE_KEY)
    sessionStorage.clear() // 탭을 닫고 다시 연 것과 같다
    expect(readApiKey()).toBeNull()
  })

  it('is gone the moment it is cleared', async () => {
    const { saveApiKey, clearApiKey, readApiKey } = await import('../features/studio/apiKeySession')
    saveApiKey(FAKE_KEY)
    clearApiKey()
    expect(readApiKey()).toBeNull()
    expect(JSON.stringify(sessionStorage)).not.toContain(FAKE_KEY)
  })

  it('never lands in localStorage, the job, the document or the URL', async () => {
    await seedReady()
    await openStudio()
    await generateOnce()
    await waitFor(() => expect(calls).toHaveLength(1))

    expect(JSON.stringify(localStorage)).not.toContain(FAKE_KEY)
    const job = await loadStudioJob(STUDIO_JOB_ID)
    expect(JSON.stringify(job)).not.toContain(FAKE_KEY)
    expect(window.location.href).not.toContain(FAKE_KEY)
    const assets = await getAllAssets()
    expect(JSON.stringify(assets.map((a) => ({ id: a.id, fileName: a.fileName })))).not.toContain(FAKE_KEY)
  }, 20000)

  it('lets the studio drop the key from the screen', async () => {
    await seedReady()
    await openStudio()
    await generateOnce()
    await waitFor(() => expect(calls).toHaveLength(1))

    // 키가 들어간 뒤에는 버튼이 저장됨이라고 말한다 (마감 교정 §2).
    fireEvent.click(screen.getByRole('button', { name: '✓ API 키 저장됨' }))
    fireEvent.click(screen.getByRole('button', { name: '키 지우기' }))
    const { readApiKey } = await import('../features/studio/apiKeySession')
    expect(readApiKey()).toBeNull()
  }, 20000)
})

// ── 오류 표시 ────────────────────────────────────────────────────────────────

describe('오류는 사람이 읽을 수 있는 한 문장이 된다', () => {
  const cases: { status: number; code: string; expect: RegExp }[] = [
    { status: 401, code: 'invalid_api_key', expect: /키/ },
    { status: 403, code: 'model_not_found', expect: /권한|사용할 수 없/ },
    { status: 429, code: 'insufficient_quota', expect: /크레딧|결제/ },
    { status: 400, code: 'moderation_blocked', expect: /안전|생성할 수 없/ },
    { status: 400, code: 'invalid_size', expect: /입력 이미지나 요청 크기/ },
    { status: 504, code: 'function_timeout', expect: /시간/ },
    { status: 502, code: 'no_image', expect: /이미지를 받지 못/ },
  ]

  for (const c of cases) {
    it(`says something useful for ${c.code}`, async () => {
      await seedReady()
      await openStudio()
      respond = async () =>
        new Response(JSON.stringify({ error: { code: c.code, message: 'raw provider text' } }), {
          status: c.status,
          headers: { 'content-type': 'application/json' },
        })
      await generateOnce()
      // 문장은 실패 창 안에서 찾는다 — 화면의 다른 안내가 우연히 같은 글자를
      // 담고 있어도 "오류를 제대로 말했는가"의 답이 되지는 않는다.
      await waitFor(() => {
        const dialog = screen.getByRole('alertdialog', { name: '이미지 생성 실패' })
        expect(within(dialog).getByText(c.expect)).toBeTruthy()
      }, { timeout: 8000 })
      // 공급자 원문을 그대로 보여주지 않는다.
      expect(document.body.textContent).not.toContain('raw provider text')
      expect(document.body.textContent).not.toContain(FAKE_KEY)
    }, 20000)
  }

  it('does not retry a failed call by itself', async () => {
    await seedReady()
    await openStudio()
    respond = async () =>
      new Response(JSON.stringify({ error: { code: 'invalid_size', message: 'x' } }), { status: 400 })
    await generateOnce()
    await waitFor(() => expect(calls).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 400))
    expect(calls).toHaveLength(1)
  }, 20000)
})

// ── 참고 이미지 나란히 보기 제거 ─────────────────────────────────────────────

describe('§13-2 참고 이미지의 나란히 보기는 사라지고 오버레이는 남는다', () => {
  it('작업판에는 참고 이미지 보기 조작이 아예 없다', async () => {
    await seedReady()
    await openStudio()
    // 없어진 보기 방식은 물론이고, 남은 두 가지도 작업판에는 없다 — 작업판이
    // 참고하는 것은 `디자인 스타일 레퍼런스` 한 장이기 때문이다 (스타일
    // 레퍼런스 Patch). 작성기 쪽 두 가지는 `styleReference.test.tsx`가 지킨다.
    expect(screen.queryByRole('radio', { name: '나란히 보기' })).toBeNull()
    expect(screen.queryByRole('radio', { name: '캔버스만' })).toBeNull()
    expect(screen.queryByRole('radio', { name: '오버레이' })).toBeNull()
  })

  it('opens an old file that was saved in side-by-side, showing the canvas', async () => {
    const doc = sampleDoc()
    // 예전 판에서 저장된 상태.
    doc.pages[0]!.reference = {
      assetId: 'asset_ref',
      viewMode: 'side' as never,
      opacity: 0.4,
      fit: 'width',
      visible: true,
    }
    await seedReady(doc)
    await openStudio()
    // 파일은 열리고, 없어진 보기 방식은 화면 상태에서만 접힌다.
    expect(document.querySelector('.ref-side')).toBeNull()
    // 참고 이미지 자체는 그대로다.
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(job.doc.pages[0]!.reference.assetId).toBe('asset_ref')
  })
})
