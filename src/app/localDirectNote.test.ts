/**
 * 작업자의 말 그대로 (직접 전달 Patch).
 *
 * 긴 주문도 번역도 거치지 않고, 작업자가 쓴 말과 레퍼런스 한 장만 모델까지 간다.
 * 그래야 "모델이 이 말을 알아듣는가"를 처음으로 따로 볼 수 있다.
 */

import { describe, it, expect } from 'vitest'
import { API_KEY_HEADER, FIELD_INTENT, FIELD_NOTE, FIELD_REFERENCE } from '../domain/imageGeneration'
import { createLocalImageClient, LOCAL_FIELD_IMAGES, LOCAL_FIELD_PROMPT } from '../services/localImageClient'
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
function plateRequest(withNote: boolean, withReference: boolean): Request {
  const form = new FormData()
  form.set('prompt', LONG_PROMPT)
  form.set('size', '832x800')
  form.set(FIELD_INTENT, 'plate')
  // 크기로 어느 그림인지 가린다 — 원래 목록은 1바이트, 레퍼런스는 4바이트.
  form.append('images[]', new File(['s'], '1-style-reference.jpg', { type: 'image/png' }))
  if (withNote) form.set(FIELD_NOTE, `  ${NOTE}  `)
  if (withReference) form.set(FIELD_REFERENCE, new File(['rrrr'], 'style-reference.png', { type: 'image/png' }))
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

  for (const [name, withNote, withReference] of [
    ['말이 없으면', false, true],
    ['레퍼런스가 없으면', true, false],
  ] as const) {
    it(`${name} 지금까지의 요청 그대로다`, async () => {
      const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
      const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
      await handleGenerateImage(plateRequest(withNote, withReference), { requestImage: provider, fetch: stub })

      const body = calls[0]!.init.body as FormData
      expect(body.get(LOCAL_FIELD_PROMPT)).toBe(LONG_PROMPT)
      expect((body.getAll(LOCAL_FIELD_IMAGES) as File[]).map((f) => [f.name, f.size])).toEqual([
        ['1-style-reference.jpg', 1],
      ])
    })
  }

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
