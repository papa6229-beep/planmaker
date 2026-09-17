/**
 * 로컬 이미지 엔진 호출 경계 (로컬 provider 1차).
 *
 * `openAiImageClient.ts`의 형제다. 하는 일도 같다 — 정해진 값으로 **한 번**
 * 요청하고, 응답을 우리 말로 옮겨 돌려준다. `fetch`를 주입받으므로 네트워크 없이
 * "무엇을 보내는가"를 그대로 검사할 수 있다.
 *
 * ## 이 파일이 모르는 것
 *
 * 여기에는 엔진 이름이 없다. 워크플로도, 노드 번호도, 큐도, 진행 상황을 묻는
 * 두 번째 요청도 없다. 이 파일이 아는 것은 **주소 하나에 폼을 보내면 그림 한 장이
 * 온다**는 사실뿐이다.
 *
 * 일부러 그렇게 둔다. 특정 도구의 그래프 JSON이 한 번 이 안에 들어오면 그 도구를
 * 바꾸는 일이 곧 PLANMAKER를 고치는 일이 된다. 그 변환은 이 주소 **뒤쪽**에
 * 두어야 하고, 그러면 도구를 갈아 끼워도 여기는 그대로다.
 *
 * ## 자격은 여기서만 온다
 *
 * `request.apiKey`를 **읽지 않는다.** 그 값은 OpenAI 키일 수 있고, 읽는 순간
 * 남의 키가 로컬 주소로 나간다. 로컬의 자격은 환경변수에서 와서 이 모듈이 쥐고
 * 있는 설정(`config.apiKey`)뿐이다.
 *
 * ## 시간 제한이 여기 있는 이유
 *
 * 지금까지 이 경로에는 시간 제한이 없었다. 유일한 상한이 서버 함수의 실행시간
 * (300초)이라, 엔진이 막히면 그 300초를 통째로 기다린 뒤에야 화면이 실패를
 * 말한다. 로컬 엔진은 GPU 한 장을 여럿이 나눠 쓰므로 막히는 일이 드물지 않다.
 *
 * **자동 재시도는 없다.** 실패하면 실패한 채로 돌아온다 — 로컬이 무료라도
 * 마찬가지다. 스스로 다시 부르면 실패한 이유가 화면에서 사라진다.
 */

import type { ImageGenerationErrorCode } from '../domain/imageGeneration.js'
import {
  ImageProviderError,
  safeProviderDetail,
  type ImageProvider,
  type ImageProviderResult,
} from '../domain/imageProvider.js'

/**
 * 로컬 API가 받는 폼 이름 — **이 저장소가 정하는 계약**이다.
 *
 * 우리 서버 함수가 브라우저에서 받는 이름(`domain/imageGeneration.ts`)과 값이
 * 같지만 같은 것은 아니다. 한쪽은 브라우저와 우리 서버 사이의 약속이고, 이쪽은
 * 우리 서버와 로컬 엔진 사이의 약속이다. 한 상수를 둘로 쓰면 한쪽을 고칠 때
 * 다른 쪽이 조용히 따라 바뀐다.
 */
export const LOCAL_FIELD_PROMPT = 'prompt'
export const LOCAL_FIELD_SIZE = 'size'
export const LOCAL_FIELD_INTENT = 'intent'
export const LOCAL_FIELD_MODEL = 'model'
export const LOCAL_FIELD_BACKGROUND = 'background'
export const LOCAL_FIELD_IMAGES = 'images[]'
/** 말 없이 레퍼런스만 왔을 때 체크박스 상태를 싣는 칸 (레퍼런스만 Patch). */
export const LOCAL_FIELD_REFERENCE_MODE = 'reference_mode'
/** 제품의 대표색을 싣는 칸 (제품 색맞춤 Patch). 그림이 아니라 숫자다. */
export const LOCAL_FIELD_PRODUCT_TONE = 'product_tone'
/** 문구 판에 입힐 재질 이름 (문구 꾸미기 Patch). 어댑터가 고정 문장으로 바꾼다. */
export const LOCAL_FIELD_TEXT_FINISH = 'text_finish'

/**
 * 기다리는 시간의 기본값.
 *
 * 한 장에 수십 초가 걸리는 일이라 짧게 잡을 수 없고, 서버 함수의 상한(300초)보다는
 * 확실히 짧아야 한다 — 그래야 "엔진이 늦다"와 "함수가 잘렸다"가 구분된다.
 */
export const DEFAULT_LOCAL_TIMEOUT_MS = 120_000

export interface LocalImageConfig {
  /** `LOCAL_IMAGE_API_URL`. 이 주소 하나만 안다. */
  apiUrl: string
  /** `LOCAL_IMAGE_MODEL`. 그대로 실어 보낼 뿐, 이 코드가 해석하지 않는다. */
  model?: string | undefined
  /** `LOCAL_IMAGE_API_KEY`. 사내망 게이트웨이용. 없으면 인증 헤더를 붙이지 않는다. */
  apiKey?: string | undefined
  timeoutMs: number
}

/**
 * 로컬 엔진의 상태 코드를 우리 분류로 옮긴다.
 *
 * 없는 코드를 지어내지 않는다. 짚이는 곳이 없으면 `unknown`으로 두고, 실제 상태
 * 번호와 손질한 설명은 서버 기록에 남긴다 — 화면 문구를 그럴듯하게 만들자고
 * "크기 문제"라고 말하면 사람이 엉뚱한 곳을 고치게 된다.
 */
export function classifyLocalStatus(status: number): ImageGenerationErrorCode {
  if (status === 401 || status === 403) return 'invalid_api_key'
  if (status === 408 || status === 504 || status === 524) return 'function_timeout'
  if (status === 413) return 'inputs_too_large'
  if (status === 429) return 'rate_limited'
  if (status === 400 || status === 422) return 'invalid_size'
  if (status >= 500) return 'network_error'
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

/** 시간이 다 된 것인가, 길이 끊긴 것인가. 둘은 사람이 할 일이 다르다. */
function stopCode(signal: AbortSignal, err: unknown): ImageGenerationErrorCode {
  if (signal.aborted) return 'function_timeout'
  return err instanceof Error && err.name === 'AbortError' ? 'function_timeout' : 'network_error'
}

/**
 * 설정 하나로 묶인 공급자 하나.
 *
 * 설정을 인자로 받지 않고 **닫아 두는** 것은, 요청마다 환경을 다시 읽지 않기
 * 위해서이기도 하지만 그보다 `request.apiKey`가 여기로 흘러들 자리를 아예
 * 없애기 위해서다.
 */
export function createLocalImageClient(config: LocalImageConfig): ImageProvider {
  return async (request, deps = {}): Promise<ImageProviderResult> => {
    const doFetch = deps.fetch ?? fetch

    // 작업자의 말과 레퍼런스가 함께 왔으면 **그것만** 보낸다 (직접 전달 Patch).
    // 브라우저가 지은 긴 주문도, 번역도, 덧붙이는 규칙도 없다 — 모델이 작업자의
    // 말을 알아듣는지부터 본다.
    // 말이 비어 있으면 프롬프트 칸도 비워서 보낸다. 빈 자리를 무엇으로 채울지는
    // 엔진을 아는 쪽(어댑터)이 `reference_mode`를 보고 정한다 — 브라우저가 지은
    // 긴 주문이 그 자리로 되돌아오는 일은 없다 (레퍼런스만 Patch).
    const prompt = request.direct === undefined ? request.prompt : request.direct.note
    const images = request.direct === undefined ? request.images : [request.direct.reference]

    const form = new FormData()
    form.set(LOCAL_FIELD_PROMPT, prompt)
    // 말이 있으면 그 말이 곧 지시다. 상태는 말이 없을 때만 나간다.
    if (request.direct !== undefined && prompt.length === 0 && request.direct.mode !== undefined) {
      form.set(LOCAL_FIELD_REFERENCE_MODE, request.direct.mode)
    }
    // 제품의 색. 말이 있든 없든 함께 간다 — 배경이 그 제품과 겉돌지 않게 하는 일은
    // 작업자가 무엇을 주문했는지와 무관하게 언제나 필요하다.
    if (request.direct?.productTone !== undefined && request.direct.productTone.length > 0) {
      form.set(LOCAL_FIELD_PRODUCT_TONE, request.direct.productTone)
    }
    if (request.direct?.textFinish !== undefined) {
      form.set(LOCAL_FIELD_TEXT_FINISH, request.direct.textFinish)
    }
    form.set(LOCAL_FIELD_SIZE, request.size)
    if (request.intent !== undefined) form.set(LOCAL_FIELD_INTENT, request.intent)
    if (config.model !== undefined && config.model.length > 0) form.set(LOCAL_FIELD_MODEL, config.model)
    if (request.background === 'transparent') form.set(LOCAL_FIELD_BACKGROUND, 'transparent')
    // 파일명을 그대로 옮긴다. 이름이 곧 역할이라, 어느 장이 스타일 레퍼런스이고
    // 어느 장이 고칠 조각인지 엔진 쪽이 알아볼 수 있는 유일한 단서다.
    for (const image of images) {
      form.append(LOCAL_FIELD_IMAGES, new File([image.blob], image.fileName, { type: image.blob.type || 'image/png' }))
    }

    const headers: Record<string, string> = {}
    // 로컬의 자격만. `request.apiKey`는 여기서 읽지 않는다.
    if (config.apiKey !== undefined && config.apiKey.length > 0) {
      headers.Authorization = `Bearer ${config.apiKey}`
    }

    const controller = new AbortController()
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      let response: Response
      try {
        response = await doFetch(config.apiUrl, {
          method: 'POST',
          headers,
          body: form,
          signal: controller.signal,
        })
      } catch (err) {
        // 다시 부르지 않는다. 한 번 나갔고, 한 번으로 끝난다.
        throw new ImageProviderError(stopCode(controller.signal, err), 0)
      }

      const requestId = response.headers.get('x-request-id') ?? undefined
      let text: string
      try {
        text = await response.text()
      } catch (err) {
        // 헤더만 오고 본문이 끊긴 경우다. 성공으로 보지 않는다.
        throw new ImageProviderError(stopCode(controller.signal, err), response.status, requestId)
      }
      const body = parseJson(text)

      if (!response.ok) {
        const error = body?.error
        const fields = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
        // 본문이 JSON이 아닐 수도 있다. 그때는 받은 글의 첫 줄을 손질해 남긴다 —
        // 키도 base64도 긴 인용도 지워진 뒤의 문자열이다.
        const detail = safeProviderDetail(fields.message ?? text)
        // 413은 둘이다 — 그림이 너무 크거나, **너무 많거나**. 어댑터가 붙인 이름으로
        // 가른다. 앞선 판은 장수 초과(Klein 한도 3장)를 "너무 커서"라고 알려, 작업자가
        // 멀쩡한 파일을 줄이러 갔다 (2026-09-17).
        const code =
          response.status === 413 && fields.code === 'too_many_images'
            ? 'too_many_inputs'
            : classifyLocalStatus(response.status)
        throw new ImageProviderError(code, response.status, requestId, {
          ...(typeof fields.code === 'string' ? { code: fields.code } : {}),
          ...(typeof fields.type === 'string' ? { type: fields.type } : {}),
          ...(typeof fields.param === 'string' ? { param: fields.param } : {}),
          ...(detail === undefined ? {} : { detail }),
        })
      }

      // 200이어도 그림이 없으면 성공이 아니다. 둘 다 있어야 한다 — `mimeType`이
      // 없으면 저장은 되지만 나중에 무엇으로 열어야 할지 알 수 없다.
      const b64 = body?.b64
      const mimeType = body?.mimeType
      if (typeof b64 !== 'string' || b64.length === 0 || typeof mimeType !== 'string' || mimeType.length === 0) {
        throw new ImageProviderError('no_image', response.status, requestId)
      }

      const model = body?.model
      const usage = body?.usage
      return {
        b64,
        mimeType,
        ...(typeof model === 'string' && model.length > 0 ? { model } : {}),
        ...(requestId === undefined ? {} : { requestId }),
        ...(usage === undefined ? {} : { usage }),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
