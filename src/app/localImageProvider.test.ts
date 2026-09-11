/**
 * 이미지 공급자를 갈아 끼울 수 있게 된 자리 (로컬 provider 1차).
 *
 * 이 단계에서 한 일은 로컬 엔진을 붙인 것이 아니라 **붙일 자리를 고정한 것**이다.
 * 그래서 여기서 확인하는 것도 "로컬이 그림을 잘 만드는가"가 아니라 다음 약속들이다.
 *
 *  1. 아무것도 정하지 않은 배포는 **한 글자도 달라지지 않는다.** `IMAGE_PROVIDER`가
 *     없거나 `openai`이면 지금까지의 OpenAI 경로로 그대로 간다.
 *  2. 설정이 덜 끝난 배포는 **조용히 OpenAI로 흐르지 않는다.** 로컬로 돌린다고
 *     믿는 사람이 남의 카드로 결제하게 되는 일을 막는다.
 *  3. 로컬로 나가는 요청에 **`request.apiKey`가 실리지 않는다.** 그 값은 OpenAI
 *     키일 수 있고, 실리는 순간 남의 키가 로컬 주소로 나간다.
 *  4. **시간 제한이 있다.** 지금까지 이 경로의 유일한 상한은 서버 함수의 300초였다.
 *  5. **자동 재시도가 없다.** 실패는 실패한 채로 돌아온다.
 *  6. 200이어도 그림이 없으면 성공이 아니다.
 *  7. `intent`는 로컬에만 간다 — **OpenAI 요청 바이트는 그대로다.**
 */

import { describe, it, expect, vi } from 'vitest'
import {
  IMAGE_INTENTS,
  readImageIntent,
  ImageProviderError,
  type ImageProvider,
  type ImageProviderRequest,
} from '../domain/imageProvider'
import { USAGE_KINDS } from '../domain/imageUsage'
import { API_KEY_HEADER, FIELD_INTENT, IMAGE_MODEL } from '../domain/imageGeneration'
import { ACCESS_CODE_HEADER, encodeAccessCode } from '../domain/serverAccess'
import {
  classifyLocalStatus,
  createLocalImageClient,
  DEFAULT_LOCAL_TIMEOUT_MS,
  LOCAL_FIELD_IMAGES,
  LOCAL_FIELD_INTENT,
  LOCAL_FIELD_MODEL,
  LOCAL_FIELD_PROMPT,
  LOCAL_FIELD_SIZE,
} from '../services/localImageClient'
import { readProviderSetting, resolveImageProvider } from '../services/imageProviderSelect'
import { accessModeOf, readServerEnv } from '../services/serverAccess'
import { requestOpenAiImage } from '../services/openAiImageClient'
import { handleGenerateImage } from '../services/generateImageHandler'

const OPENAI_KEY = 'sk-openai-should-never-leave-0000'
const LOCAL_URL = 'http://127.0.0.1:8801/generate'

function providerRequest(patch: Partial<ImageProviderRequest> = {}): ImageProviderRequest {
  return {
    apiKey: OPENAI_KEY,
    prompt: '배경 한 장',
    size: '832x992',
    images: [],
    ...patch,
  }
}

function png(bytes = 'abc'): Blob {
  return new Blob([bytes], { type: 'image/png' })
}

/** 스텁이 받은 요청을 그대로 붙들어 둔다. */
function recorder(reply: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const stub = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return await reply()
  }) as unknown as typeof fetch
  return { calls, stub }
}

function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** 브라우저가 보내는 모양 그대로의 요청 하나. */
function imageRequest(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  const form = new FormData()
  form.set('prompt', '배경 한 장')
  form.set('size', '832x992')
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  return new Request('https://planmaker.local/api/generate-image', {
    method: 'POST',
    headers: { [API_KEY_HEADER]: 'sk-mine-123', ...headers },
    body: form,
  })
}

// ── §L1 공급자 선택 ────────────────────────────────────────────────────────

describe('§L1 어느 공급자로 나가는가', () => {
  it('아무것도 정하지 않으면 undefined — 기존 OpenAI 경로 그대로다', () => {
    expect(resolveImageProvider({})).toBeUndefined()
    expect(readProviderSetting({})).toEqual({ kind: 'openai' })
    // 환경변수를 읽는 쪽도 같은 답이어야 한다.
    expect(resolveImageProvider(readServerEnv({ OPENAI_API_KEY: 'sk-x', PLANMAKER_ACCESS_CODE: 'c' }))).toBeUndefined()
  })

  it('IMAGE_PROVIDER=openai도 undefined다', () => {
    expect(resolveImageProvider(readServerEnv({ IMAGE_PROVIDER: 'openai' }))).toBeUndefined()
    expect(readProviderSetting(readServerEnv({ IMAGE_PROVIDER: 'openai' }))).toEqual({ kind: 'openai' })
  })

  it('undefined일 때 handler는 실제로 OpenAI를 부른다', async () => {
    const { calls, stub } = recorder(() => jsonReply({ data: [{ b64_json: 'AAAA' }] }))
    const response = await handleGenerateImage(imageRequest({}), {
      // api/generate-image.ts가 하는 일 그대로 — undefined면 얹지 않는다.
      ...(resolveImageProvider({}) === undefined ? {} : { requestImage: resolveImageProvider({})! }),
      fetch: stub,
    })
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/images/generations')
    expect(((await response.json()) as { metadata: { model: string } }).metadata.model).toBe(IMAGE_MODEL)
  })

  it('IMAGE_PROVIDER=local이면 로컬 주소로 나간다', async () => {
    const provider = resolveImageProvider(
      readServerEnv({ IMAGE_PROVIDER: 'local', LOCAL_IMAGE_API_URL: LOCAL_URL }),
    )
    expect(provider).toBeTypeOf('function')
    const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
    await provider!(providerRequest(), { fetch: stub })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(LOCAL_URL)
  })

  it('기본 시간 제한과 설정값을 읽는다', () => {
    const setting = readProviderSetting(
      readServerEnv({
        IMAGE_PROVIDER: 'local',
        LOCAL_IMAGE_API_URL: LOCAL_URL,
        LOCAL_IMAGE_MODEL: 'some-image-model',
        LOCAL_IMAGE_API_KEY: 'local-gate-1',
      }),
    )
    expect(setting).toEqual({
      kind: 'local',
      config: { apiUrl: LOCAL_URL, timeoutMs: DEFAULT_LOCAL_TIMEOUT_MS, model: 'some-image-model', apiKey: 'local-gate-1' },
    })
    expect(
      readProviderSetting(
        readServerEnv({ IMAGE_PROVIDER: 'local', LOCAL_IMAGE_API_URL: LOCAL_URL, LOCAL_IMAGE_TIMEOUT_MS: '45000' }),
      ),
    ).toMatchObject({ kind: 'local', config: { timeoutMs: 45_000 } })
  })
})

describe('§L1-b 설정이 덜 끝난 배포는 조용히 흐르지 않는다', () => {
  const cases: [string, Record<string, string>, string][] = [
    ['모르는 공급자 이름', { IMAGE_PROVIDER: 'comfy' }, 'unknown_provider'],
    ['local인데 주소가 없다', { IMAGE_PROVIDER: 'local' }, 'missing_local_url'],
    [
      '시간 제한이 숫자가 아니다',
      { IMAGE_PROVIDER: 'local', LOCAL_IMAGE_API_URL: LOCAL_URL, LOCAL_IMAGE_TIMEOUT_MS: '30s' },
      'invalid_timeout',
    ],
  ]

  for (const [name, env, reason] of cases) {
    it(`${name} — 부르면 server_not_configured이고 외부로 나가지 않는다`, async () => {
      const setting = readProviderSetting(readServerEnv(env))
      expect(setting).toMatchObject({ kind: 'misconfigured', reason })

      const provider = resolveImageProvider(readServerEnv(env))
      expect(provider).toBeTypeOf('function')

      const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
      const response = await handleGenerateImage(imageRequest({}), { requestImage: provider!, fetch: stub })
      expect(response.status).toBe(503)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('server_not_configured')
      // 잘못 설정된 배포가 OpenAI로 새어 나가지 않는다.
      expect(calls).toHaveLength(0)
    })
  }
})

// ── §L2 로컬로 나가는 요청의 계약 ──────────────────────────────────────────

describe('§L2 로컬 요청에 무엇이 실리는가', () => {
  it('prompt·size·intent·model과 모든 그림이 원래 파일명으로 실린다', async () => {
    const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
    const provider = createLocalImageClient({ apiUrl: LOCAL_URL, model: 'some-image-model', timeoutMs: 5_000 })

    await provider(
      providerRequest({
        prompt: '문구 한 개',
        size: '1024x1024',
        intent: 'text-layer',
        images: [
          { fileName: '1-style-reference.png', blob: png('s') },
          { fileName: '2-background-plate.png', blob: png('b') },
        ],
      }),
      { fetch: stub },
    )

    expect(calls).toHaveLength(1)
    const body = calls[0]!.init.body as FormData
    expect(body.get(LOCAL_FIELD_PROMPT)).toBe('문구 한 개')
    expect(body.get(LOCAL_FIELD_SIZE)).toBe('1024x1024')
    expect(body.get(LOCAL_FIELD_INTENT)).toBe('text-layer')
    expect(body.get(LOCAL_FIELD_MODEL)).toBe('some-image-model')

    const files = body.getAll(LOCAL_FIELD_IMAGES) as File[]
    expect(files).toHaveLength(2)
    // 파일명이 곧 역할이다. 이름을 갈면 엔진 쪽이 어느 장이 무엇인지 알 수 없다.
    expect(files.map((f) => f.name)).toEqual(['1-style-reference.png', '2-background-plate.png'])
  })

  it('LOCAL_IMAGE_API_KEY가 있으면 인증 헤더를 보내고, 없으면 붙이지 않는다', async () => {
    const withKey = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
    await createLocalImageClient({ apiUrl: LOCAL_URL, apiKey: 'local-gate-1', timeoutMs: 5_000 })(providerRequest(), {
      fetch: withKey.stub,
    })
    expect((withKey.calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer local-gate-1')

    const without = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
    await createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })(providerRequest(), { fetch: without.stub })
    expect(without.calls[0]!.init.headers).toEqual({})
  })

  it('OpenAI 키는 로컬 요청 어디에도 실리지 않는다', async () => {
    const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
    await createLocalImageClient({ apiUrl: LOCAL_URL, apiKey: 'local-gate-1', timeoutMs: 5_000 })(
      providerRequest({ intent: 'plate' }),
      { fetch: stub },
    )
    const sent = calls[0]!
    expect(JSON.stringify(sent.init.headers)).not.toContain(OPENAI_KEY)
    const body = sent.init.body as FormData
    for (const value of [...body.keys()].map((k) => body.get(k))) {
      expect(String(value)).not.toContain(OPENAI_KEY)
    }
  })

  it('intent가 없으면 그 칸을 보내지 않는다 — 없는 힌트를 지어내지 않는다', async () => {
    const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
    await createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })(providerRequest(), { fetch: stub })
    expect((calls[0]!.init.body as FormData).has(LOCAL_FIELD_INTENT)).toBe(false)
  })
})

// ── §L3 시간 제한 ──────────────────────────────────────────────────────────

describe('§L3 기다리다 끝나는 자리', () => {
  it('응답이 오지 않으면 끊고 function_timeout이다 — 다시 부르지 않는다', async () => {
    let calls = 0
    const hanging = (async (_url: unknown, init?: RequestInit) => {
      calls += 1
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })
    }) as unknown as typeof fetch

    const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 10 })
    await expect(provider(providerRequest(), { fetch: hanging })).rejects.toMatchObject({
      name: 'ImageProviderError',
      code: 'function_timeout',
    })
    // 한 번 나갔고, 한 번으로 끝난다.
    expect(calls).toBe(1)
  })

  it('시간 제한이 걸린 요청은 handler에서도 같은 코드로 나간다', async () => {
    const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 10 })
    const hanging = (async (_url: unknown, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })) as unknown as typeof fetch

    const response = await handleGenerateImage(imageRequest({}), { requestImage: provider, fetch: hanging })
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('function_timeout')
  })
})

// ── §L4 길이 끊긴 자리 ─────────────────────────────────────────────────────

describe('§L4 네트워크 실패', () => {
  it('fetch가 던지면 network_error이고, 다시 부르지 않는다', async () => {
    const stub = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch

    const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
    await expect(provider(providerRequest(), { fetch: stub })).rejects.toMatchObject({ code: 'network_error' })
    expect(vi.mocked(stub)).toHaveBeenCalledTimes(1)
  })
})

// ── §L5 응답을 믿지 않는다 ─────────────────────────────────────────────────

describe('§L5 로컬 응답 검사', () => {
  const bad: [string, unknown][] = [
    ['빈 몸통', {}],
    ['b64가 없다', { mimeType: 'image/png' }],
    ['mimeType이 없다', { b64: 'AAAA' }],
    ['b64가 빈 문자열', { b64: '', mimeType: 'image/png' }],
    ['b64가 숫자', { b64: 1234, mimeType: 'image/png' }],
  ]

  for (const [name, body] of bad) {
    it(`${name} — 200이어도 성공이 아니다`, async () => {
      const { stub } = recorder(() => jsonReply(body))
      const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
      await expect(provider(providerRequest(), { fetch: stub })).rejects.toMatchObject({ code: 'no_image' })
    })
  }

  it('JSON이 아닌 200도 성공이 아니다', async () => {
    const { stub } = recorder(() => new Response('<html>gateway</html>', { status: 200 }))
    const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
    await expect(provider(providerRequest(), { fetch: stub })).rejects.toMatchObject({ code: 'no_image' })
  })

  it('상태 코드를 우리 분류로 옮긴다', () => {
    expect(classifyLocalStatus(401)).toBe('invalid_api_key')
    expect(classifyLocalStatus(403)).toBe('invalid_api_key')
    expect(classifyLocalStatus(408)).toBe('function_timeout')
    expect(classifyLocalStatus(413)).toBe('inputs_too_large')
    expect(classifyLocalStatus(429)).toBe('rate_limited')
    expect(classifyLocalStatus(400)).toBe('invalid_size')
    expect(classifyLocalStatus(500)).toBe('network_error')
    expect(classifyLocalStatus(404)).toBe('unknown')
  })

  it('실패 본문의 문장은 담지 않는다 — 손질한 것만 남는다', async () => {
    const { stub } = recorder(() =>
      jsonReply({ error: { code: 'bad_size', message: `key ${OPENAI_KEY} rejected` } }, 400),
    )
    const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
    const failure = await provider(providerRequest(), { fetch: stub }).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(ImageProviderError)
    const error = failure as ImageProviderError
    expect(error.code).toBe('invalid_size')
    expect(error.providerCode).toBe('bad_size')
    expect(error.providerDetail).not.toContain(OPENAI_KEY)
  })

  it('로컬이 말한 모델 이름이 응답 metadata에 그대로 나간다', async () => {
    const { stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png', model: 'local-image-model-x' }))
    const provider = createLocalImageClient({ apiUrl: LOCAL_URL, timeoutMs: 5_000 })
    const response = await handleGenerateImage(imageRequest({}), { requestImage: provider, fetch: stub })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { metadata: { model: string } }
    // 로컬로 만든 그림에 OpenAI 이름이 붙지 않는다.
    expect(body.metadata.model).toBe('local-image-model-x')
  })
})

// ── §L6 intent가 지나가는 길 ───────────────────────────────────────────────

describe('§L6 intent', () => {
  it('브라우저가 보낸 갈래가 공급자까지 그대로 간다', async () => {
    for (const intent of IMAGE_INTENTS) {
      const seen = vi.fn<ImageProvider>(async () => ({ b64: 'AAAA', mimeType: 'image/png' }))
      await handleGenerateImage(imageRequest({ [FIELD_INTENT]: intent }), { requestImage: seen })
      expect(seen.mock.calls[0]![0]).toMatchObject({ intent })
    }
  })

  it('모르는 값은 없는 것으로 본다 — 힌트 하나 때문에 생성이 막히지 않는다', async () => {
    const seen = vi.fn<ImageProvider>(async () => ({ b64: 'AAAA', mimeType: 'image/png' }))
    const response = await handleGenerateImage(imageRequest({ [FIELD_INTENT]: 'banner-maybe' }), { requestImage: seen })
    expect(response.status).toBe(200)
    expect(seen.mock.calls[0]![0]).not.toHaveProperty('intent')
    expect(readImageIntent('banner-maybe')).toBeUndefined()
    expect(readImageIntent(42)).toBeUndefined()
  })

  it('갈래 목록이 장부의 갈래와 어긋나지 않는다', () => {
    // 브라우저는 장부에 적는 그 값을 그대로 intent로 보낸다. 한쪽만 늘어나면
    // 그 갈래는 서버에서 조용히 버려진다.
    expect([...IMAGE_INTENTS].sort()).toEqual([...USAGE_KINDS].sort())
  })
})

// ── §L7 OpenAI 경로 불변성 ─────────────────────────────────────────────────

describe('§L7 OpenAI로 나가는 요청은 그대로다', () => {
  it('intent가 실려 와도 OpenAI multipart에는 들어가지 않는다', async () => {
    const { calls, stub } = recorder(() => jsonReply({ data: [{ b64_json: 'AAAA' }] }))
    await requestOpenAiImage(providerRequest({ intent: 'plate', images: [{ fileName: 'a.png', blob: png() }] }), {
      fetch: stub,
    })
    const body = calls[0]!.init.body as FormData
    expect(body.has('intent')).toBe(false)
    // 지금까지 보내던 것은 그대로다.
    expect(body.get('model')).toBe(IMAGE_MODEL)
    expect(body.get('prompt')).toBe('배경 한 장')
    expect(body.get('size')).toBe('832x992')
    expect(body.get('quality')).toBe('medium')
    expect(body.get('n')).toBe('1')
    expect(body.get('output_format')).toBe('png')
    expect(body.getAll('image[]')).toHaveLength(1)
  })

  it('그림이 없는 요청은 여전히 JSON 한 덩이로 나간다', async () => {
    const { calls, stub } = recorder(() => jsonReply({ data: [{ b64_json: 'AAAA' }] }))
    await requestOpenAiImage(providerRequest({ intent: 'background' }), { fetch: stub })
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/images/generations')
    const sent = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>
    expect(sent).not.toHaveProperty('intent')
    expect(sent.model).toBe(IMAGE_MODEL)
  })
})

// ── §L8 운영 배포 그대로 — 암구호 뒤에서 공급자만 바뀐다 ───────────────────

/**
 * 여기서 확인하는 것이 이 작업의 요점이다.
 *
 * **접근 인증과 공급자 자격은 다른 것이다.** 팀원이 우측 API 버튼으로 넣는
 * 암구호는 "이 사람이 PLANMAKER의 AI 기능을 써도 되는가"이고, OpenAI 키와
 * `LOCAL_IMAGE_API_KEY`는 각 공급자가 자기 문을 여는 값이다. 셋을 한 칸에 두면
 * 공급자를 바꿀 때마다 로그인 방식이 함께 흔들린다.
 *
 * 그래서 `serverAccess.ts`는 한 줄도 고치지 않았다. 운영 배포는
 * `OPENAI_API_KEY`와 `PLANMAKER_ACCESS_CODE`를 그대로 쥐고 있고 — 그 키는 지시
 * 다듬기가 계속 쓴다 — 화면은 지금까지처럼 암구호를 묻는다. 달라지는 것은
 * 암구호를 통과한 **뒤**, 이미지 한 장이 어느 주소로 나가는가 하나뿐이다.
 */
describe('§L8 접속 암구호는 그대로, 그 뒤에서 공급자만 바뀐다', () => {
  const SERVER_OPENAI_KEY = 'sk-server-openai-0000000000'
  const ACCESS_CODE = 'planmaker-2026'
  const LOCAL_KEY = 'local-adapter-secret-1'

  /** 운영 배포에 로컬 공급자만 얹은 환경. 기존 두 값은 그대로 있다. */
  const localEnv = () =>
    readServerEnv({
      OPENAI_API_KEY: SERVER_OPENAI_KEY,
      PLANMAKER_ACCESS_CODE: ACCESS_CODE,
      IMAGE_PROVIDER: 'local',
      LOCAL_IMAGE_API_URL: LOCAL_URL,
      LOCAL_IMAGE_API_KEY: LOCAL_KEY,
    })

  /** 암구호만 싣는다 — 작업자는 OpenAI 키를 갖고 있지 않다. */
  function codeOnlyRequest(code: string): Request {
    const form = new FormData()
    form.set('prompt', '배경 한 장')
    form.set('size', '832x992')
    form.set(FIELD_INTENT, 'plate')
    return new Request('https://planmaker.local/api/generate-image', {
      method: 'POST',
      headers: { [ACCESS_CODE_HEADER]: encodeAccessCode(code) },
      body: form,
    })
  }

  it('화면은 여전히 암구호를 묻는다 — 공급자가 바뀌어도 갈래는 server-key다', () => {
    // 우측 API 버튼이 키 입력칸이 아니라 암구호 칸을 띄우는 근거가 이 값이다.
    expect(accessModeOf(localEnv())).toBe('server-key')
  })

  it('C. 올바른 암구호면 OpenAI 키 없이 로컬로 나간다', async () => {
    const env = localEnv()
    const { calls, stub } = recorder(() =>
      jsonReply({ b64: 'AAAA', mimeType: 'image/png', model: 'qwen-image-edit-2511' }),
    )
    const response = await handleGenerateImage(codeOnlyRequest(ACCESS_CODE), {
      env,
      requestImage: resolveImageProvider(env)!,
      fetch: stub,
    })

    expect(response.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(LOCAL_URL)
    // 갈래 힌트도 그대로 실려 간다.
    expect((calls[0]!.init.body as FormData).get(LOCAL_FIELD_INTENT)).toBe('plate')
    // 로컬이 말한 이름이 화면까지 간다 — gpt-image-2라고 적히지 않는다.
    expect(((await response.json()) as { metadata: { model: string } }).metadata.model).toBe(
      'qwen-image-edit-2511',
    )
  })

  it('D. 암구호가 틀리거나 없으면 공급자까지 가지 않는다', async () => {
    const missing = new Request('https://planmaker.local/api/generate-image', {
      method: 'POST',
      body: new FormData(),
    })
    for (const request of [codeOnlyRequest('틀린암구호'), missing]) {
      const env = localEnv()
      const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
      const response = await handleGenerateImage(request, {
        env,
        requestImage: resolveImageProvider(env)!,
        fetch: stub,
      })
      expect(response.status).toBe(401)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('access_denied')
      // 문을 통과하지 못한 요청은 GPU를 건드리지 않는다.
      expect(calls).toHaveLength(0)
    }
  })

  it('E. adapter 인증은 LOCAL_IMAGE_API_KEY 하나뿐 — 서버 OpenAI 키는 나가지 않는다', async () => {
    const env = localEnv()
    const { calls, stub } = recorder(() => jsonReply({ b64: 'AAAA', mimeType: 'image/png' }))
    const response = await handleGenerateImage(codeOnlyRequest(ACCESS_CODE), {
      env,
      requestImage: resolveImageProvider(env)!,
      fetch: stub,
    })
    expect(response.status).toBe(200)

    const sent = calls[0]!
    expect((sent.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${LOCAL_KEY}`)
    // 서버가 쥔 OpenAI 키는 헤더에도 폼에도 없다.
    expect(JSON.stringify(sent.init.headers)).not.toContain(SERVER_OPENAI_KEY)
    const form = sent.init.body as FormData
    for (const key of form.keys()) {
      expect(String(form.get(key))).not.toContain(SERVER_OPENAI_KEY)
    }
    // 브라우저로 돌아가는 응답에도 두 비밀 어느 쪽도 실리지 않는다.
    const shown = JSON.stringify(await response.json())
    expect(shown).not.toContain(SERVER_OPENAI_KEY)
    expect(shown).not.toContain(LOCAL_KEY)
    expect(shown).not.toContain(ACCESS_CODE)
  })
})
