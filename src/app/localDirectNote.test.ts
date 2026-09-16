/**
 * 작업자의 말 그대로 (직접 전달 Patch).
 *
 * 긴 주문도 번역도 거치지 않고, 작업자가 쓴 말과 레퍼런스 한 장만 모델까지 간다.
 * 그래야 "모델이 이 말을 알아듣는가"를 처음으로 따로 볼 수 있다.
 */

import { describe, it, expect } from 'vitest'
import {
  API_KEY_HEADER,
  FIELD_INTENT,
  FIELD_NOTE,
  FIELD_REFERENCE,
  FIELD_PRODUCT_TONE,
  FIELD_REFERENCE_MODE,
} from '../domain/imageGeneration'
import {
  createLocalImageClient,
  LOCAL_FIELD_IMAGES,
  LOCAL_FIELD_PRODUCT_TONE,
  LOCAL_FIELD_PROMPT,
  LOCAL_FIELD_REFERENCE_MODE,
} from '../services/localImageClient'
import { handleGenerateImage } from '../services/generateImageHandler'

const LOCAL_URL = 'http://127.0.0.1:8801/generate'
const NOTE = '인물 제외, 밤으로 바꾸고, 장식은 유지, 유사한 거리 느낌으로'
const LONG_PROMPT = '긴 주문 1078자'

function recorder(reply: () => Response) {
  const calls: { url: string; init: RequestInit }[] = []
  const stub = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return reply()
  }) as unknown as typeof fetch
  return { calls, stub }
}

function jsonReply(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

/**
 * 첫 생성의 배경 요청 모양 그대로. 긴 주문과 원래 그림 목록은 늘 실려 있다.
 *
 * 폼은 요청 본문으로 싣지 않고 `formData()`가 바로 돌려주게 한다. 이 검사 환경의
 * `FormData`를 Node `Request`가 multipart로 읽지 못해서다 — 여기서 보려는 것은
 * 폼을 읽은 **뒤**의 일이다.
 */
function plateRequest(
  withNote: boolean,
  withReference: boolean,
  mode?: string,
  tone?: string,
): Request {
  const form = new FormData()
  form.set('prompt', LONG_PROMPT)
  form.set('size', '832x800')
  form.set(FIELD_INTENT, 'plate')
  // 크기로 어느 그림인지 가린다 — 원래 목록은 1바이트, 레퍼런스는 4바이트.
  form.append('images[]', new File(['s'], '1-style-reference.jpg', { type: 'image/png' }))
  if (withNote) form.set(FIELD_NOTE, `  ${NOTE}  `)
  if (withReference) form.set(FIELD_REFERENCE, new File(['rrrr'], 'style-reference.png', { type: 'image/png' }))
  if (mode !== undefined) form.set(FIELD_REFERENCE_MODE, mode)
  if (tone !== undefined) form.set(FIELD_PRODUCT_TONE, tone)
  const request = new Request('https://planmaker.local/api/generate-image', {
    method: 'POST',
    headers: { [API_KEY_HEADER]: 'sk-mine-123' },
  })
  return Object.assign(request, { formData: async () => form })
}

describe('작업자의 말과 레퍼런스만 로컬로 간다', () => {
  it('둘 다 있으면 그 둘만 보낸다 — 긴 주문은 나가지 않는다', async () => {
    const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
    const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
    const response = await handleGenerateImage(plateRequest(true, true), { requestImage: provider, fetch: stub })

    expect(response.status).toBe(200)
    const body = calls[0]!.init.body as FormData
    // 앞뒤 공백만 걷어 낸, 작업자가 쓴 그 말이다.
    expect(body.get(LOCAL_FIELD_PROMPT)).toBe(NOTE)
    const files = body.getAll(LOCAL_FIELD_IMAGES) as File[]
    expect(files.map((f) => [f.name, f.size])).toEqual([['style-reference.png', 4]])
  })

  it('레퍼런스가 없으면 지금까지의 요청 그대로다', async () => {
    const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
    const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
    await handleGenerateImage(plateRequest(true, false), { requestImage: provider, fetch: stub })

    const body = calls[0]!.init.body as FormData
    expect(body.get(LOCAL_FIELD_PROMPT)).toBe(LONG_PROMPT)
    expect((body.getAll(LOCAL_FIELD_IMAGES) as File[]).map((f) => [f.name, f.size])).toEqual([
      ['1-style-reference.jpg', 1],
    ])
  })

  // ── 레퍼런스만 Patch ─────────────────────────────────────────────────────
  //
  // 원래 PLANMAKER는 레퍼런스만 올려도 배경을 만들었다. 그 길을 엔진이 바뀌었다고
  // 잃지 않는다. 다만 무슨 말로 시킬지는 여기서 정하지 않는다 — 체크박스 상태만
  // 넘기고, 문장은 그 모델을 아는 쪽(어댑터)이 고른다.
  describe('말 없이 레퍼런스만 올렸을 때', () => {
    for (const mode of ['preserve', 'style'] as const) {
      it(`${mode}: 긴 주문 대신 빈 프롬프트와 체크박스 상태가 간다`, async () => {
        const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
        const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
        const response = await handleGenerateImage(plateRequest(false, true, mode), {
          requestImage: provider,
          fetch: stub,
        })

        expect(response.status).toBe(200)
        const body = calls[0]!.init.body as FormData
        // 긴 주문은 나가지 않는다. 브라우저가 지은 문장이 되돌아올 자리가 없다.
        expect(body.get(LOCAL_FIELD_PROMPT)).toBe('')
        expect(body.get(LOCAL_FIELD_REFERENCE_MODE)).toBe(mode)
        expect((body.getAll(LOCAL_FIELD_IMAGES) as File[]).map((f) => [f.name, f.size])).toEqual([
          ['style-reference.png', 4],
        ])
      })
    }

    it('모르는 상태는 없는 것으로 본다 — 지금까지의 요청 그대로다', async () => {
      const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
      const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
      await handleGenerateImage(plateRequest(false, true, '배경까지'), { requestImage: provider, fetch: stub })

      const body = calls[0]!.init.body as FormData
      expect(body.has(LOCAL_FIELD_REFERENCE_MODE)).toBe(false)
    })
  })

  it('말이 있으면 상태는 실리지 않는다 — 문장 둘이 싸우지 않는다', async () => {
    const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
    const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
    await handleGenerateImage(plateRequest(true, true, 'preserve'), { requestImage: provider, fetch: stub })

    const body = calls[0]!.init.body as FormData
    expect(body.get(LOCAL_FIELD_PROMPT)).toBe(NOTE)
    expect(body.has(LOCAL_FIELD_REFERENCE_MODE)).toBe(false)
  })

  // ── 제품의 색은 숫자로만 ─────────────────────────────────────────────────
  describe('제품의 색', () => {
    it('숫자 한 줄로 실려 간다 — 사진은 가지 않는다', async () => {
      const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
      const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
      const response = await handleGenerateImage(
        plateRequest(true, true, undefined, '#e060a0,#e080c0'),
        { requestImage: provider, fetch: stub },
      )

      expect(response.status).toBe(200)
      const body = calls[0]!.init.body as FormData
      expect(body.get(LOCAL_FIELD_PRODUCT_TONE)).toBe('#e060a0,#e080c0')
      // 나가는 그림은 스타일 레퍼런스 한 장뿐이다.
      expect((body.getAll(LOCAL_FIELD_IMAGES) as File[]).map((f) => f.name)).toEqual(['style-reference.png'])
    })

    it('말이 없어도 색은 간다 — 어울리게 하는 일은 주문과 무관하다', async () => {
      const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
      const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
      await handleGenerateImage(plateRequest(false, true, 'style', '#e060a0'), {
        requestImage: provider,
        fetch: stub,
      })

      const body = calls[0]!.init.body as FormData
      expect(body.get(LOCAL_FIELD_PRODUCT_TONE)).toBe('#e060a0')
      expect(body.get(LOCAL_FIELD_REFERENCE_MODE)).toBe('style')
    })

    it('빈 값은 싣지 않는다', async () => {
      const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
      const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
      await handleGenerateImage(plateRequest(true, true, undefined, '   '), {
        requestImage: provider,
        fetch: stub,
      })

      expect((calls[0]!.init.body as FormData).has(LOCAL_FIELD_PRODUCT_TONE)).toBe(false)
    })

    it('OpenAI 경로에는 색도 가지 않는다', async () => {
      const { calls, stub } = recorder(() => jsonReply({ data: [{ b64_json: 'AAAA' }] }))
      await handleGenerateImage(plateRequest(true, true, undefined, '#e060a0'), { fetch: stub })

      expect((calls[0]!.init.body as FormData).has(FIELD_PRODUCT_TONE)).toBe(false)
    })
  })

  it('OpenAI로 나가는 요청에는 말도 레퍼런스도 섞이지 않는다', async () => {
    const { calls, stub } = recorder(() => jsonReply({ data: [{ b64_json: 'AAAA' }] }))
    const response = await handleGenerateImage(plateRequest(true, true), { fetch: stub })

    expect(response.status).toBe(200)
    const body = calls[0]!.init.body as FormData
    expect(body.get('prompt')).toBe(LONG_PROMPT)
    expect(body.has(FIELD_NOTE)).toBe(false)
    expect(body.has(FIELD_REFERENCE)).toBe(false)
    expect((body.getAll('image[]') as File[]).map((f) => [f.name, f.size])).toEqual([['1-style-reference.jpg', 1]])
  })
})
