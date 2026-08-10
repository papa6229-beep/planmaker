/**
 * 키를 서버에 두고, 팀원에게는 암구호만 준다 (서버 키 Patch).
 *
 * 작업자가 찾던 것은 한 문장이었다 — "내 API를 팀원한테 공유하지 않는 방법".
 * 지금까지는 팀원이 이미지를 만들려면 키를 건네야 했고, 건넨 키는 남의
 * `localStorage`에 남아 회수할 방법이 없었다.
 *
 * 여기서 확인하는 것은 그 약속들이다.
 *
 *  1. 서버에 키가 있으면 **서버 키**를 쓴다. 요청에 실려 온 키는 쓰지 않는다.
 *  2. 암구호가 틀리면 **공급자를 부르지 않는다.** 남의 결제가 되기 때문이다.
 *  3. 암구호를 정해 두지 않은 배포는 **거절한다.** 잠기지 않은 채로 열어 두지
 *     않는다.
 *  4. 서버에 키가 없으면 지금까지처럼 요청 헤더의 키를 쓴다 — 기존 배포는 한
 *     글자도 달라지지 않는다.
 *  5. 실패 응답에도, 갈래를 알려 주는 응답에도 **서버가 쥔 값이 나가지 않는다.**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ACCESS_CODE_HEADER, encodeAccessCode, readAccessMode } from '../domain/serverAccess'
import { API_KEY_HEADER } from '../domain/imageGeneration'
import {
  accessModeOf,
  readServerEnv,
  resolveApiKey,
  sameSecret,
  type ServerEnv,
} from '../services/serverAccess'
import { handleGenerateImage } from '../services/generateImageHandler'
import { handleRefineInstruction } from '../services/refineInstructionHandler'
import { handleAccessMode } from '../services/accessModeHandler'
import {
  authHeaders,
  clearAccessCode,
  clearApiKey,
  currentAccessMode,
  ensureAccessMode,
  hasCredential,
  resetAccessModeForTests,
  saveAccessCode,
  saveApiKey,
} from '../features/studio/apiKeySession'

const SERVER_KEY = 'sk-server-9999999999'
const CODE = 'planmaker-2026'

function imageRequest(headers: Record<string, string>): Request {
  const form = new FormData()
  form.set('prompt', '배경 한 장')
  form.set('size', '832x992')
  return new Request('https://planmaker.local/api/generate-image', {
    method: 'POST',
    headers,
    body: form,
  })
}

function refineRequest(headers: Record<string, string>): Request {
  return new Request('https://planmaker.local/api/refine-instruction', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'overall', userText: '좀 더 예쁘게', page: { title: 'p' } }),
  })
}

describe('§S1 환경변수를 읽는 규칙', () => {
  it('공백만 있는 값은 없는 것과 같다', () => {
    expect(readServerEnv({})).toEqual({})
    expect(readServerEnv({ OPENAI_API_KEY: '   ', PLANMAKER_ACCESS_CODE: '' })).toEqual({})
    expect(readServerEnv({ OPENAI_API_KEY: `  ${SERVER_KEY}  `, PLANMAKER_ACCESS_CODE: ` ${CODE} ` })).toEqual({
      apiKey: SERVER_KEY,
      accessCode: CODE,
    })
  })

  it('갈래는 서버 키가 있느냐로만 갈린다', () => {
    expect(accessModeOf({})).toBe('client-key')
    expect(accessModeOf({ accessCode: CODE })).toBe('client-key')
    expect(accessModeOf({ apiKey: SERVER_KEY })).toBe('server-key')
  })
})

describe('§S2 비밀 비교', () => {
  it('길이가 다르면 곧바로 다르고, 한 글자만 달라도 다르다', () => {
    expect(sameSecret(CODE, CODE)).toBe(true)
    expect(sameSecret(CODE, `${CODE}x`)).toBe(false)
    expect(sameSecret(CODE, 'planmaker-2027')).toBe(false)
    expect(sameSecret('', '')).toBe(true)
  })
})

describe('§S3 이 요청이 쓸 키', () => {
  it('서버에 키가 없으면 지금까지처럼 헤더의 키를 쓴다', () => {
    const answer = resolveApiKey(imageRequest({ [API_KEY_HEADER]: 'sk-mine-123' }), {})
    expect(answer).toEqual({ ok: true, apiKey: 'sk-mine-123', source: 'client-key' })
  })

  it('서버에 키도 헤더도 없으면 키 없음이다', () => {
    const answer = resolveApiKey(imageRequest({}), {})
    expect(answer).toEqual({ ok: false, code: 'missing_api_key', status: 400 })
  })

  it('서버 키를 쓸 때는 요청에 실려 온 키를 쓰지 않는다', () => {
    const env: ServerEnv = { apiKey: SERVER_KEY, accessCode: CODE }
    const answer = resolveApiKey(
      imageRequest({ [ACCESS_CODE_HEADER]: encodeAccessCode(CODE), [API_KEY_HEADER]: 'sk-somebody-else' }),
      env,
    )
    expect(answer).toEqual({ ok: true, apiKey: SERVER_KEY, source: 'server-key' })
  })

  it('암구호가 없거나 틀리면 거절한다', () => {
    const env: ServerEnv = { apiKey: SERVER_KEY, accessCode: CODE }
    for (const headers of [{}, { [ACCESS_CODE_HEADER]: '' }, { [ACCESS_CODE_HEADER]: encodeAccessCode('planmaker-2027') }]) {
      expect(resolveApiKey(imageRequest(headers), env)).toEqual({
        ok: false,
        code: 'access_denied',
        status: 401,
      })
    }
    // 자기 키를 들고 와도 서버 키 배포에서는 통하지 않는다.
    expect(resolveApiKey(imageRequest({ [API_KEY_HEADER]: 'sk-mine-123' }), env)).toEqual({
      ok: false,
      code: 'access_denied',
      status: 401,
    })
  })

  /**
   * 환경변수를 하나만 넣고 만 배포는 "조용히 열린 생성기"가 된다. 그 사실은
   * 요금이 청구되기 전까지 아무 데도 드러나지 않으므로, 눈에 띄게 고장 낸다.
   */
  it('암구호를 정해 두지 않은 서버 키 배포는 열어 두지 않는다', () => {
    expect(resolveApiKey(imageRequest({ [ACCESS_CODE_HEADER]: CODE }), { apiKey: SERVER_KEY })).toEqual({
      ok: false,
      code: 'server_not_configured',
      status: 503,
    })
  })
})

/**
 * 암구호는 사람이 정하는 값이고, 한국어로 쓰는 팀이 있다.
 *
 * HTTP 헤더 값은 바이트 하나에 한 글자라, 한글을 그대로 실으면 `fetch`가 요청을
 * 만들기도 전에 던진다 — 화면에는 "네트워크 오류"만 남고 원인은 어디에도 없다.
 * 그래서 씌워 보내고 벗겨 읽는다.
 */
describe('§S3-B 한글 암구호', () => {
  it('한글 암구호가 헤더에 실리고, 서버가 같은 값으로 읽는다', () => {
    const korean = '여름감사제-암구호'
    const header = encodeAccessCode(korean)
    // 헤더에 실을 수 있는 글자만 남는다.
    expect(/^[ -~]*$/.test(header)).toBe(true)
    expect(() => new Request('https://x/', { headers: { [ACCESS_CODE_HEADER]: header } })).not.toThrow()

    const env: ServerEnv = { apiKey: SERVER_KEY, accessCode: korean }
    expect(resolveApiKey(imageRequest({ [ACCESS_CODE_HEADER]: header }), env)).toEqual({
      ok: true,
      apiKey: SERVER_KEY,
      source: 'server-key',
    })
    // 씌우지 않고 보낸 값(옛 브라우저 캐시 등)은 그냥 맞지 않을 뿐, 터지지 않는다.
    expect(resolveApiKey(imageRequest({ [ACCESS_CODE_HEADER]: '%ED%99%94' }), env)).toEqual({
      ok: false,
      code: 'access_denied',
      status: 401,
    })
    expect(resolveApiKey(imageRequest({ [ACCESS_CODE_HEADER]: '%E0%A4%A' }), env)).toEqual({
      ok: false,
      code: 'access_denied',
      status: 401,
    })
  })
})

describe('§S4 막힌 요청은 공급자를 부르지 않는다', () => {
  const env: ServerEnv = { apiKey: SERVER_KEY, accessCode: CODE }

  it('이미지: 암구호가 틀리면 401이고 호출 0건이다', async () => {
    const requestImage = vi.fn()
    const response = await handleGenerateImage(imageRequest({ [ACCESS_CODE_HEADER]: encodeAccessCode('틀린암구호') }), {
      env,
      requestImage: requestImage as never,
    })
    expect(response.status).toBe(401)
    expect(requestImage).not.toHaveBeenCalled()
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('access_denied')
    // 서버가 쥔 값은 한 글자도 나가지 않는다.
    expect(body.error.message).not.toContain(SERVER_KEY)
    expect(body.error.message).not.toContain(CODE)
  })

  it('이미지: 설정이 덜 끝난 배포는 503이고 호출 0건이다', async () => {
    const requestImage = vi.fn()
    const response = await handleGenerateImage(imageRequest({ [ACCESS_CODE_HEADER]: encodeAccessCode(CODE) }), {
      env: { apiKey: SERVER_KEY },
      requestImage: requestImage as never,
    })
    expect(response.status).toBe(503)
    expect(requestImage).not.toHaveBeenCalled()
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('server_not_configured')
  })

  it('지시 다듬기: 암구호가 틀리면 401이고 호출 0건이다', async () => {
    const requestRefine = vi.fn()
    const response = await handleRefineInstruction(refineRequest({ [ACCESS_CODE_HEADER]: encodeAccessCode('틀린암구호') }), {
      env,
      requestRefine: requestRefine as never,
    })
    expect(response.status).toBe(401)
    expect(requestRefine).not.toHaveBeenCalled()
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('access_denied')
  })

  it('암구호가 맞으면 서버 키로 공급자를 부른다', async () => {
    const requestImage = vi.fn(async () => ({ b64: 'AAAA', mimeType: 'image/png' }))
    const response = await handleGenerateImage(
      imageRequest({ [ACCESS_CODE_HEADER]: encodeAccessCode(CODE), [API_KEY_HEADER]: 'sk-somebody-else' }),
      { env, requestImage: requestImage as never },
    )
    expect(response.status).toBe(200)
    expect(requestImage).toHaveBeenCalledTimes(1)
    expect((requestImage.mock.calls[0] as unknown as [{ apiKey: string }])[0].apiKey).toBe(SERVER_KEY)
  })

  it('서버 키가 없는 배포는 지금까지와 똑같이 헤더의 키로 부른다', async () => {
    const requestImage = vi.fn(async () => ({ b64: 'AAAA', mimeType: 'image/png' }))
    const response = await handleGenerateImage(imageRequest({ [API_KEY_HEADER]: 'sk-mine-123' }), {
      requestImage: requestImage as never,
    })
    expect(response.status).toBe(200)
    expect((requestImage.mock.calls[0] as unknown as [{ apiKey: string }])[0].apiKey).toBe('sk-mine-123')
  })
})

describe('§S5 갈래를 알려 주는 한 줄', () => {
  it('갈래만 나간다 — 키도 암구호도 그 길이도 나가지 않는다', async () => {
    const response = handleAccessMode({ apiKey: SERVER_KEY, accessCode: CODE })
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ mode: 'server-key' })
    expect(text).not.toContain(SERVER_KEY)
    expect(text).not.toContain(CODE)
    // 환경변수를 고친 뒤에도 옛 답이 남지 않게 한다.
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('모르는 답은 전부 자기 키 쪽이다', () => {
    expect(readAccessMode({ mode: 'server-key' })).toBe('server-key')
    expect(readAccessMode({ mode: 'client-key' })).toBe('client-key')
    expect(readAccessMode({ mode: 'something' })).toBe('client-key')
    expect(readAccessMode(null)).toBe('client-key')
    expect(readAccessMode('<!doctype html>')).toBe('client-key')
  })
})

describe('§S6 브라우저가 쥐는 자격 한 줄', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    resetAccessModeForTests()
  })

  it('묻기 전에는 자기 키 쪽이고, 키가 그대로 나간다', () => {
    expect(currentAccessMode()).toBe('client-key')
    expect(authHeaders()).toBeNull()
    saveApiKey('sk-mine-123')
    expect(authHeaders()).toEqual({ [API_KEY_HEADER]: 'sk-mine-123' })
    expect(hasCredential()).toBe(true)
  })

  it('서버 키 배포에서는 암구호가 나가고, 키는 나가지 않는다', async () => {
    saveApiKey('sk-mine-123')
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ mode: 'server-key' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    expect(await ensureAccessMode({ fetch: fetchSpy as unknown as typeof fetch })).toBe('server-key')

    // 암구호가 없으면 부르지 않는다 — 남아 있는 자기 키로 새어 나가지 않는다.
    expect(authHeaders()).toBeNull()

    saveAccessCode(CODE)
    expect(authHeaders()).toEqual({ [ACCESS_CODE_HEADER]: encodeAccessCode(CODE) })
    expect(JSON.stringify(authHeaders())).not.toContain('sk-mine-123')

    clearAccessCode()
    expect(authHeaders()).toBeNull()
  })

  it('갈래는 한 번만 묻는다', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ mode: 'server-key' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const asking = [
      ensureAccessMode({ fetch: fetchSpy as unknown as typeof fetch }),
      ensureAccessMode({ fetch: fetchSpy as unknown as typeof fetch }),
    ]
    expect(await Promise.all(asking)).toEqual(['server-key', 'server-key'])
    await ensureAccessMode({ fetch: fetchSpy as unknown as typeof fetch })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('묻지 못하면 자기 키 쪽으로 둔다', async () => {
    const dead = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await ensureAccessMode({ fetch: dead as unknown as typeof fetch })).toBe('client-key')
    saveApiKey('sk-mine-123')
    expect(authHeaders()).toEqual({ [API_KEY_HEADER]: 'sk-mine-123' })
    clearApiKey()
    expect(hasCredential()).toBe(false)
  })

  it('옛 배포라 그 길이 없으면(404) 자기 키 쪽이다', async () => {
    const missing = vi.fn(async () => new Response('Not Found', { status: 404 }))
    expect(await ensureAccessMode({ fetch: missing as unknown as typeof fetch })).toBe('client-key')
  })
})
