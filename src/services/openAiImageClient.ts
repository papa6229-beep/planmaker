/**
 * OpenAI Image API 호출 경계 (1단계 §9).
 *
 * 이 모듈만 OpenAI를 안다. 프롬프트를 만들지도, 결과를 저장하지도 않는다 —
 * 정해진 값으로 한 번 요청하고, 응답을 우리 말로 옮겨 돌려줄 뿐이다. `fetch`를
 * 주입받으므로 네트워크 없이 "무엇을 보내는가"를 그대로 검사할 수 있다.
 *
 * 공식 API 명세(openai-openapi)에서 확인한 것:
 *
 *  - `POST /v1/images/edits`, multipart/form-data — 원본을 함께 보내는 편집
 *  - `POST /v1/images/generations`, JSON — 글만으로 만드는 생성
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
/**
 * 원본 없이 글만으로 만드는 길 (배경 합성 1차 §8).
 *
 * 편집 엔드포인트는 이미지를 **요구한다**. 빈 배경을 만드는 요청에는 보낼
 * 이미지가 없고, 있어서도 안 된다 — 원본을 보내지 않는 것이 이 방식의 전부다.
 * 그래서 보낼 이미지가 하나도 없을 때만 이쪽으로 나간다. 어느 쪽이든 모델과
 * 키를 다루는 방식은 같다.
 */
const OPENAI_IMAGE_GENERATIONS_URL = 'https://api.openai.com/v1/images/generations'

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
  /**
   * 배경을 투명하게 받을 것인가 (한방 생성 Patch 2).
   *
   * 값이 없으면 아무것도 보내지 않는다 — 지금까지의 요청 바이트가 한 글자도
   * 달라지지 않도록. `png` 출력에서만 뜻이 있고, 우리는 언제나 `png`다.
   */
  background?: 'transparent'
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
  /**
   * 공급자가 붙인 분류값 (`error.code` / `error.type`) 그대로 — **짧은 이름뿐**.
   *
   * 문장은 여전히 담지 않는다. 담지 않는 이유는 그 안에 키가 섞여 나온 적이
   * 있어서이고, 그 위험은 이름표에는 없다. 이것이 없으면 400을 받았을 때
   * 무엇이 잘못됐는지 알 길이 아예 없다 — 우리 분류는 모든 400을 한 칸에 넣는다.
   */
  readonly providerCode?: string
  readonly providerType?: string
  /** 어느 요청 항목이 문제였는가 (`error.param`). 값이 아니라 **이름**이다. */
  readonly providerParam?: string
  /** 남겨도 되는 만큼만 손질한 설명 — `safeProviderDetail`을 지난 문자열. */
  readonly providerDetail?: string

  constructor(
    code: ImageGenerationErrorCode,
    status: number,
    requestId?: string,
    provider?: { code?: string; type?: string; param?: string; detail?: string },
  ) {
    super(`image provider failed: ${code}`)
    this.name = 'ImageProviderError'
    this.code = code
    this.status = status
    if (requestId !== undefined) this.requestId = requestId
    if (provider?.code !== undefined) this.providerCode = provider.code
    if (provider?.type !== undefined) this.providerType = provider.type
    if (provider?.param !== undefined) this.providerParam = provider.param
    if (provider?.detail !== undefined) this.providerDetail = provider.detail
  }
}

/**
 * 공급자 설명 중 **남겨도 되는 만큼**.
 *
 * 원문을 그대로 담지 않는 규칙은 그대로다 — 그 안에 키가 실려 온 적이 있기
 * 때문이다. 그렇다고 통째로 버리면 `invalid_value`가 어느 값을 가리키는지 알
 * 길이 없어, 다음 실제 생성에서도 같은 자리에 서게 된다.
 *
 * 그래서 지우고 남긴다.
 *
 *  - 키 모양(`sk-…`, `Bearer …`)은 통째로
 *  - 40자 넘게 이어지는 토큰은 무엇이든 (키든 base64든)
 *  - 따옴표 안이 40자 넘으면 — 우리가 보낸 글이 되돌아온 것이다
 *  - 첫 줄만, 200자까지
 *
 * 남는 것은 `Invalid value: 'transparent'. Supported values are: …` 같은 짧은
 * 문장이다. 키도, 프롬프트도, 이미지도 여기 남지 않는다.
 */
export function safeProviderDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const redacted = (value.split('\n')[0] ?? '')
    .replace(/\b(?:sk|rk|org|proj)[-_][A-Za-z0-9_-]{6,}/gi, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, '[redacted]')
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, '[redacted]')
    .replace(/(['"])[^'"]{40,}?\1/g, '$1[redacted]$1')
    .trim()
  return redacted.length === 0 ? undefined : redacted.slice(0, 200)
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

  const textOnly = request.images.length === 0
  const url = textOnly ? OPENAI_IMAGE_GENERATIONS_URL : OPENAI_IMAGE_EDITS_URL

  const form = new FormData()
  form.set('model', IMAGE_MODEL)
  form.set('prompt', request.prompt)
  form.set('size', request.size)
  form.set('quality', IMAGE_QUALITY)
  form.set('n', '1')
  form.set('output_format', IMAGE_OUTPUT_FORMAT)
  if (request.background === 'transparent') form.set('background', 'transparent')
  // `input_fidelity`는 넣지 않는다 — gpt-image-2는 이미지 입력을 스스로 고정밀
  // 처리하므로, 여기서 지정하면 모델의 기본 동작을 덮어쓰게 된다.
  // 스트리밍과 중간 이미지도 쓰지 않으므로 아예 보내지 않는다.
  for (const image of request.images) {
    form.append('image[]', new File([image.blob], image.fileName, { type: image.blob.type || 'image/png' }))
  }

  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        ...(textOnly ? { 'content-type': 'application/json' } : {}),
      },
      // 생성은 보낼 파일이 없으므로 JSON 한 덩이다. multipart로 감싸 봐야
      // 경계 문자열만 늘고, 무엇을 보냈는지 읽기만 어려워진다.
      body: textOnly
        ? JSON.stringify({
            model: IMAGE_MODEL,
            prompt: request.prompt,
            size: request.size,
            quality: IMAGE_QUALITY,
            n: 1,
            output_format: IMAGE_OUTPUT_FORMAT,
            ...(request.background === 'transparent' ? { background: 'transparent' } : {}),
          })
        : form,
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
    const fields = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
    const providerCode = fields.code
    const providerType = fields.type
    const providerParam = fields.param
    const detail = safeProviderDetail(fields.message)
    throw new ImageProviderError(
      classifyProviderError(response.status, providerCode),
      response.status,
      requestId,
      {
        ...(typeof providerCode === 'string' ? { code: providerCode } : {}),
        ...(typeof providerType === 'string' ? { type: providerType } : {}),
        ...(typeof providerParam === 'string' ? { param: providerParam } : {}),
        ...(detail === undefined ? {} : { detail }),
      },
    )
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
