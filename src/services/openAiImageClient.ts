/**
 * OpenAI Image API 호출 경계 (1단계 §9).
 *
 * 이 모듈만 OpenAI를 안다. 프롬프트를 만들지도, 결과를 저장하지도 않는다 —
 * 정해진 값으로 한 번 요청하고, 응답을 우리 말로 옮겨 돌려줄 뿐이다. `fetch`를
 * 주입받으므로 네트워크 없이 "무엇을 보내는가"를 그대로 검사할 수 있다.
 *
 * 공식 API 명세(openai-openapi)에서 확인한 것:
 *
 *  - `POST /v1/images/edits`, multipart/form-data
 *  - `image`는 배열로 최대 16장, png·webp·jpg, 각 50MB 미만
 *  - `size`는 `gpt-image-2`에서 임의의 `가로x세로` 문자열이며 두 변 모두 16의
 *    배수, 비율 1:3~3:1, 최대 3840x2160
 *  - `quality`는 `medium`을 포함하는 열거값
 *  - GPT 이미지 모델은 언제나 base64로 돌려준다 (`data[0].b64_json`)
 *
 * 자동 재시도는 없다. 한 번 눌러 한 번 나가고, 실패하면 실패한 채로 돌아온다 —
 * 이미지 생성은 무료가 아니므로 우리 판단으로 두 번 결제하지 않는다.
 */

import {
  IMAGE_MODEL,
  IMAGE_OUTPUT_FORMAT,
  IMAGE_QUALITY,
  type ImageGenerationErrorCode,
} from '../domain/imageGeneration.js'

const OPENAI_IMAGE_EDITS_URL = 'https://api.openai.com/v1/images/edits'

export interface OpenAiInputImage {
  fileName: string
  blob: Blob
}

export interface OpenAiImageRequest {
  apiKey: string
  prompt: string
  /** `가로x세로` — `resolveGptImageSize`가 만든 값. */
  size: string
  images: readonly OpenAiInputImage[]
}

export interface OpenAiImageResult {
  b64: string
  mimeType: string
  requestId?: string
  /** 공급자가 준 사용량 그대로. 비용을 여기서 계산하지 않는다. */
  usage?: unknown
}

/**
 * 실패 하나. **공급자가 보낸 문장은 담지 않는다** — 그 안에 키가 그대로 들어
 * 있는 경우가 있고, 한 번 객체에 담기면 로그·화면·오류 보고 어디로든 새어 나간다.
 * 남기는 것은 우리가 분류한 코드와, 조사에 쓸 요청 id뿐이다.
 */
export class ImageProviderError extends Error {
  readonly code: ImageGenerationErrorCode
  readonly status: number
  readonly requestId?: string

  constructor(code: ImageGenerationErrorCode, status: number, requestId?: string) {
    super(`image provider failed: ${code}`)
    this.name = 'ImageProviderError'
    this.code = code
    this.status = status
    if (requestId !== undefined) this.requestId = requestId
  }
}

/** 공급자의 상태 코드와 오류 코드를 우리 분류로 옮긴다. */
export function classifyProviderError(status: number, providerCode: unknown): ImageGenerationErrorCode {
  const code = typeof providerCode === 'string' ? providerCode : ''
  if (status === 401 || code === 'invalid_api_key') return 'invalid_api_key'
  if (status === 403 || code === 'model_not_found' || code === 'model_not_available') return 'model_not_found'
  if (status === 429 || code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
    return 'insufficient_quota'
  }
  if (code === 'moderation_blocked' || code === 'content_policy_violation') return 'moderation_blocked'
  if (status === 400) return 'invalid_size'
  if (status === 504 || status === 408) return 'function_timeout'
  return 'unknown'
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 한 번 요청한다. 실패는 `ImageProviderError`로만 나온다. */
export async function requestOpenAiImage(
  request: OpenAiImageRequest,
  deps: { fetch?: typeof fetch } = {},
): Promise<OpenAiImageResult> {
  const doFetch = deps.fetch ?? fetch

  const form = new FormData()
  form.set('model', IMAGE_MODEL)
  form.set('prompt', request.prompt)
  form.set('size', request.size)
  form.set('quality', IMAGE_QUALITY)
  form.set('n', '1')
  form.set('output_format', IMAGE_OUTPUT_FORMAT)
  // `input_fidelity`는 넣지 않는다 — gpt-image-2는 이미지 입력을 스스로 고정밀
  // 처리하므로, 여기서 지정하면 모델의 기본 동작을 덮어쓰게 된다.
  // 스트리밍과 중간 이미지도 쓰지 않으므로 아예 보내지 않는다.
  for (const image of request.images) {
    form.append('image[]', new File([image.blob], image.fileName, { type: image.blob.type || 'image/png' }))
  }

  let response: Response
  try {
    response = await doFetch(OPENAI_IMAGE_EDITS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${request.apiKey}` },
      body: form,
    })
  } catch {
    // 재시도하지 않는다. 여기서 한 번 더 부르면 사용자가 모르는 결제가 생긴다.
    throw new ImageProviderError('network_error', 0)
  }

  const requestId = response.headers.get('x-request-id') ?? undefined
  const text = await response.text()
  const body = parseJson(text)

  if (!response.ok) {
    const error = body?.error
    const providerCode =
      typeof error === 'object' && error !== null ? (error as Record<string, unknown>).code : undefined
    throw new ImageProviderError(classifyProviderError(response.status, providerCode), response.status, requestId)
  }

  const data = body?.data
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  const b64 = first?.b64_json
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new ImageProviderError('no_image', response.status, requestId)
  }

  const outputFormat = typeof body?.output_format === 'string' ? body.output_format : IMAGE_OUTPUT_FORMAT
  return {
    b64,
    mimeType: `image/${outputFormat === 'jpeg' ? 'jpeg' : outputFormat}`,
    ...(requestId === undefined ? {} : { requestId }),
    ...(body?.usage === undefined ? {} : { usage: body.usage }),
  }
}
