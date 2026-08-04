/**
 * OpenAI Responses API 호출 경계 (실작업 UI 마감 §7).
 *
 * 이 모듈만 Responses API를 안다. 무엇을 다듬을지 정하지도, 결과를 적용하지도
 * 않는다 — 정해진 값으로 한 번 요청하고, 구조화 응답의 알맹이를 돌려줄 뿐이다.
 * `fetch`를 주입받으므로 네트워크 없이 "무엇을 보내는가"를 그대로 검사할 수 있다.
 *
 * 이미지 클라이언트와 같은 두 규칙을 지킨다.
 *
 *  - 공급자가 보낸 문장은 오류 객체에 담지 않는다. 그 안에 키가 들어 있는 경우가
 *    있고, 한 번 담기면 로그·화면 어디로든 새어 나간다.
 *  - 자동 재시도가 없다. 실패하면 실패한 채로 돌아온다.
 */

import type { RefineErrorCode } from '../domain/instructionRefine.js'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

export interface ResponsesRequest {
  apiKey: string
  model: string
  reasoningEffort: string
  systemText: string
  userText: string
  /** 분석용 축소 이미지 (data URL). 없으면 글로만 판단한다. */
  imageDataUrl?: string
  /** 구조화 응답의 이름과 모양. */
  schemaName: string
  schema: unknown
}

export interface ResponsesResult {
  /** 구조화 응답의 알맹이 — 이미 JSON으로 풀어 둔 값. */
  output: unknown
  requestId?: string
}

export class RefineProviderError extends Error {
  readonly code: RefineErrorCode
  readonly status: number
  readonly requestId?: string

  constructor(code: RefineErrorCode, status: number, requestId?: string) {
    super(`refine provider failed: ${code}`)
    this.name = 'RefineProviderError'
    this.code = code
    this.status = status
    if (requestId !== undefined) this.requestId = requestId
  }
}

/** 공급자의 상태 코드와 오류 코드를 우리 분류로 옮긴다 (§11). */
export function classifyRefineError(status: number, providerCode: unknown): RefineErrorCode {
  const code = typeof providerCode === 'string' ? providerCode : ''
  if (status === 401 || code === 'invalid_api_key') return 'invalid_api_key'
  if (status === 403 || code === 'model_not_found' || code === 'model_not_available') return 'model_not_found'
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return 'insufficient_quota'
  if (status === 429) return 'rate_limited'
  if (status === 504 || status === 408) return 'function_timeout'
  if (status === 400) return 'bad_request'
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

/**
 * 구조화 응답의 본문을 꺼낸다.
 *
 * 편의 필드(`output_text`)가 있으면 그것을, 없으면 `output[].content[]`를 훑어
 * 첫 텍스트를 쓴다. 모델이 어느 모양으로 돌려주든 우리 쪽은 한 곳에서 읽는다.
 */
export function extractStructuredText(body: Record<string, unknown> | null): string | null {
  if (body === null) return null
  if (typeof body.output_text === 'string' && body.output_text.trim().length > 0) return body.output_text

  const output = body.output
  if (!Array.isArray(output)) return null
  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === 'string' && text.trim().length > 0) return text
    }
  }
  return null
}

/** 한 번 요청한다. 실패는 `RefineProviderError`로만 나온다. */
export async function requestOpenAiRefine(
  request: ResponsesRequest,
  deps: { fetch?: typeof fetch } = {},
): Promise<ResponsesResult> {
  const doFetch = deps.fetch ?? fetch

  const userContent: unknown[] = [{ type: 'input_text', text: request.userText }]
  if (request.imageDataUrl !== undefined && request.imageDataUrl.length > 0) {
    // 분석용으로만 보낸다. 원본 자산은 이 요청으로 조금도 바뀌지 않는다.
    userContent.push({ type: 'input_image', image_url: request.imageDataUrl, detail: 'low' })
  }

  const payload = {
    model: request.model,
    reasoning: { effort: request.reasoningEffort },
    input: [
      { role: 'system', content: [{ type: 'input_text', text: request.systemText }] },
      { role: 'user', content: userContent },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: request.schemaName,
        schema: request.schema,
        strict: true,
      },
    },
  }

  let response: Response
  try {
    response = await doFetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch {
    // 재시도하지 않는다. 다음 호출은 언제나 사람의 클릭이다.
    throw new RefineProviderError('network_error', 0)
  }

  const requestId = response.headers.get('x-request-id') ?? undefined
  const text = await response.text()
  const body = parseJson(text)

  if (!response.ok) {
    const error = body?.error
    const providerCode =
      typeof error === 'object' && error !== null ? (error as Record<string, unknown>).code : undefined
    throw new RefineProviderError(classifyRefineError(response.status, providerCode), response.status, requestId)
  }

  const structured = extractStructuredText(body)
  if (structured === null) throw new RefineProviderError('bad_output', response.status, requestId)
  const output = parseJson(structured)
  if (output === null) throw new RefineProviderError('bad_output', response.status, requestId)

  return { output, ...(requestId === undefined ? {} : { requestId }) }
}
