/**
 * 서버 함수의 알맹이 (1단계 §9).
 *
 * `api/generate-image.ts`는 이 함수를 부르기만 한다. 그래야 요청 검사·키 취급·
 * 응답 모양을 Vercel 없이 그대로 검사할 수 있다.
 *
 * 키에 대해 여기서 지키는 것:
 *
 *  - 키는 **이 요청의 헤더에서만** 온다. 환경변수도, 파일도, 전역도 읽지 않는다.
 *  - 지역 변수 밖으로 나가지 않는다. 저장하지 않고, 로그에 찍지 않고, 응답에
 *    담지 않는다.
 *  - 없으면 OpenAI를 부르지 않는다 — 키 없이 부르면 실패가 아니라 낭비다.
 *
 * 나중에 회사 시스템으로 옮길 때 바뀌는 곳은 `apiKeyOf` 하나다. 이미지 요청·
 * 응답 처리는 그대로 남는다.
 */

import {
  API_KEY_HEADER,
  FIELD_BACKGROUND,
  FIELD_IMAGES,
  FIELD_PROMPT,
  FIELD_SIZE,
  IMAGE_MODEL,
  IMAGE_QUALITY,
  type GenerateImageFailure,
  type GenerateImageSuccess,
  type ImageGenerationErrorCode,
} from '../domain/imageGeneration.js'
import { ImageProviderError, requestOpenAiImage } from './openAiImageClient.js'

export interface HandlerDeps {
  /** 검사에서 공급자 호출을 가로채기 위한 이음매. */
  requestImage?: typeof requestOpenAiImage
  fetch?: typeof fetch
  /** 개발자 확인용 기록. 키는 절대 넘기지 않는다. */
  log?: (entry: {
    code: string
    status: number
    requestId?: string
    /** 공급자가 붙인 분류 이름. 문장이 아니라 짧은 이름표다. */
    providerCode?: string
    providerType?: string
    /** 어느 요청 항목이 문제였는가 — 항목의 **이름**이다. */
    providerParam?: string
    /** 손질을 거친 짧은 설명. 키·프롬프트·이미지는 지워진 뒤의 문자열이다. */
    providerDetail?: string
  }) => void
}

function fail(code: ImageGenerationErrorCode, status: number, message: string, requestId?: string): Response {
  const body: GenerateImageFailure = {
    error: { code, message, ...(requestId === undefined ? {} : { requestId }) },
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * 키를 공급하는 곳. 지금은 요청 헤더 하나뿐이다 (§3).
 *
 * 회사 시스템으로 옮길 때 이 함수만 서버 보관 키를 읽도록 바꾸면 되고, 아래
 * 생성 흐름은 손대지 않는다.
 */
export function apiKeyOf(request: Request): string | null {
  const key = request.headers.get(API_KEY_HEADER)?.trim()
  return key !== undefined && key.length > 0 ? key : null
}

export async function handleGenerateImage(request: Request, deps: HandlerDeps = {}): Promise<Response> {
  if (request.method !== 'POST') {
    return fail('unknown', 405, 'POST만 사용할 수 있습니다.')
  }

  const apiKey = apiKeyOf(request)
  if (apiKey === null) {
    return fail('missing_api_key', 400, 'OpenAI API 키를 먼저 입력해 주세요.')
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail('invalid_size', 400, '요청 형식을 읽지 못했습니다.')
  }

  const prompt = form.get(FIELD_PROMPT)
  const size = form.get(FIELD_SIZE)
  if (typeof prompt !== 'string' || prompt.length === 0 || typeof size !== 'string' || size.length === 0) {
    return fail('invalid_size', 400, '요청에 프롬프트나 크기가 없습니다.')
  }

  const images = form.getAll(FIELD_IMAGES).filter((v): v is File => typeof v !== 'string')
  // 아는 값 하나만 통과시킨다. 모르는 값은 조용히 무시하고 지금까지의 요청 그대로
  // 나간다 — 이 필드는 전경 문구 레이어 하나를 위해 생겼다.
  const transparent = form.get(FIELD_BACKGROUND) === 'transparent'

  const send = deps.requestImage ?? requestOpenAiImage
  try {
    const result = await send(
      {
        apiKey,
        prompt,
        size,
        images: images.map((file) => ({ fileName: file.name, blob: file })),
        ...(transparent ? { background: 'transparent' as const } : {}),
      },
      deps.fetch === undefined ? {} : { fetch: deps.fetch },
    )
    const body: GenerateImageSuccess = {
      image: { b64: result.b64, mimeType: result.mimeType },
      metadata: {
        model: IMAGE_MODEL,
        quality: IMAGE_QUALITY,
        requestedSize: size,
        ...(result.requestId === undefined ? {} : { requestId: result.requestId }),
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      },
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const known = err instanceof ImageProviderError
    const code: ImageGenerationErrorCode = known ? err.code : 'unknown'
    const status = known && err.status >= 400 ? err.status : 502
    const requestId = known ? err.requestId : undefined
    // 조사에 필요한 것만 남긴다 — 우리 분류, 상태, 요청 id, 그리고 공급자가 붙인
    // 분류 이름. 키도 공급자의 **문장**도 아니다.
    //
    // 공급자 이름표를 남기는 이유가 있다: 우리 분류는 400을 전부 `invalid_size`
    // 한 칸에 넣으므로, 이것이 없으면 "크기 문제"라는 화면 문구만 남고 실제
    // 원인은 어디에도 남지 않는다.
    deps.log?.({
      code,
      status,
      ...(requestId === undefined ? {} : { requestId }),
      ...(known && err.providerCode !== undefined ? { providerCode: err.providerCode } : {}),
      ...(known && err.providerType !== undefined ? { providerType: err.providerType } : {}),
      // `invalid_value`만으로는 어느 값인지 알 수 없다. 항목 이름과 손질한 설명이
      // 그 자리를 가리킨다.
      ...(known && err.providerParam !== undefined ? { providerParam: err.providerParam } : {}),
      ...(known && err.providerDetail !== undefined ? { providerDetail: err.providerDetail } : {}),
    })
    return fail(code, status, '이미지를 생성하지 못했습니다.', requestId)
  }
}
