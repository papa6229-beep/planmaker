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
import {
  ImageProviderError,
  safeProviderDetail,
  type ImageProviderRequest,
  type ImageProviderResult,
} from '../domain/imageProvider.js'

/**
 * 실패와 그 손질은 공급자 공통이라 `domain/imageProvider.ts`로 옮겼다. 부르는
 * 쪽이 달라지지 않도록 여기서 같은 이름으로 다시 내보낸다 — `instanceof`가
 * 가리키는 클래스도 하나 그대로다.
 */
export { ImageProviderError, safeProviderDetail }

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

/**
 * 이 파일의 요청·응답 모양은 이제 공급자 공통 계약 그대로다 (로컬 provider 1차).
 *
 * 이름을 남겨 두는 것은 부르는 쪽을 고치지 않기 위해서다. 모양이 하나여야
 * `handleGenerateImage`가 어느 공급자를 받든 같은 코드로 지나간다.
 *
 * `intent`는 여기 실려 오지만 **OpenAI 요청에는 실리지 않는다** — 아래에서 폼에
 * 넣는 이름이 정해져 있고 거기 없다. 지금까지의 요청 바이트가 한 글자도 달라지지
 * 않는다는 뜻이다.
 *
 * 그림 한 장의 모양(`ImageProviderInput`)은 이름을 남기지 않았다. 부르는 곳이
 * 없는 이름을 남겨 두면 다음 사람이 둘 중 어느 쪽을 써야 하는지 묻게 된다.
 */
export type OpenAiImageRequest = ImageProviderRequest
export type OpenAiImageResult = ImageProviderResult

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
