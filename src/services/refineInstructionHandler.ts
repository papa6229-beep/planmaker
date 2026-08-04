/**
 * 지시 다듬기 서버 함수의 알맹이 (실작업 UI 마감 §7).
 *
 * `api/refine-instruction.ts`는 이 함수를 부르기만 한다. 그래야 요청 검사·키 취급·
 * 응답 모양을 Vercel 없이 그대로 검사할 수 있다.
 *
 * 키에 대해 여기서 지키는 것은 이미지 함수와 같다: **이 요청의 헤더에서만** 오고,
 * 지역 변수 밖으로 나가지 않으며, 없으면 공급자를 부르지 않는다.
 */

import {
  REFINE_MODEL,
  REFINE_OVERALL_SCHEMA,
  REFINE_REASONING_EFFORT,
  REFINE_SYSTEM_INSTRUCTION,
  REFINE_TARGETS_SCHEMA,
  REFINE_OVERALL_MAX_TOKENS,
  refineTargetsMaxTokens,
  buildRefineUserText,
  readRefineOutput,
  type RefineErrorCode,
  type RefineFailure,
  type RefineRequestBody,
} from '../domain/instructionRefine.js'
import { API_KEY_HEADER } from '../domain/imageGeneration.js'
import { RefineProviderError, requestOpenAiRefine } from './openAiResponsesClient.js'

export interface RefineHandlerDeps {
  /** 검사에서 공급자 호출을 가로채기 위한 이음매. */
  requestRefine?: typeof requestOpenAiRefine
  fetch?: typeof fetch
  /** 개발자 확인용 기록. 키는 절대 넘기지 않는다. */
  log?: (entry: { code: string; status: number; requestId?: string }) => void
}

function fail(code: RefineErrorCode, status: number, message: string, requestId?: string): Response {
  const body: RefineFailure = {
    error: { code, message, ...(requestId === undefined ? {} : { requestId }) },
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 키를 공급하는 곳. 지금은 요청 헤더 하나뿐이다. */
export function refineApiKeyOf(request: Request): string | null {
  const key = request.headers.get(API_KEY_HEADER)?.trim()
  return key !== undefined && key.length > 0 ? key : null
}

/** 보내온 것이 우리가 아는 모양인가. 아니면 공급자를 부르지 않는다. */
function readBody(raw: unknown): RefineRequestBody | null {
  if (typeof raw !== 'object' || raw === null) return null
  const body = raw as Partial<RefineRequestBody>
  if (body.scope !== 'overall' && body.scope !== 'targets') return null
  if (typeof body.page !== 'object' || body.page === null) return null
  if (body.scope === 'overall') {
    if (typeof body.userText !== 'string' || body.userText.trim().length === 0) return null
  } else if (!Array.isArray(body.targets) || body.targets.length === 0) {
    return null
  }
  return {
    ...body,
    texts: Array.isArray(body.texts) ? body.texts : [],
    imageSlots: Array.isArray(body.imageSlots) ? body.imageSlots : [],
    buttons: Array.isArray(body.buttons) ? body.buttons : [],
    hasReference: body.hasReference === true,
  } as RefineRequestBody
}

export async function handleRefineInstruction(request: Request, deps: RefineHandlerDeps = {}): Promise<Response> {
  if (request.method !== 'POST') {
    return fail('unknown', 405, 'POST만 사용할 수 있습니다.')
  }

  const apiKey = refineApiKeyOf(request)
  if (apiKey === null) {
    return fail('missing_api_key', 400, 'OpenAI API 키를 먼저 입력해 주세요.')
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return fail('bad_request', 400, '요청 형식을 읽지 못했습니다.')
  }

  const body = readBody(raw)
  if (body === null) {
    return fail('bad_request', 400, '요청에 필요한 내용이 없습니다.')
  }

  const overall = body.scope === 'overall'
  const send = deps.requestRefine ?? requestOpenAiRefine
  try {
    const result = await send(
      {
        apiKey,
        model: REFINE_MODEL,
        reasoningEffort: REFINE_REASONING_EFFORT,
        systemText: REFINE_SYSTEM_INSTRUCTION,
        userText: buildRefineUserText(body),
        ...(body.previewImage === undefined ? {} : { imageDataUrl: body.previewImage }),
        schemaName: overall ? 'refined_overall_instruction' : 'refined_target_instructions',
        schema: overall ? REFINE_OVERALL_SCHEMA : REFINE_TARGETS_SCHEMA,
        maxOutputTokens: overall ? REFINE_OVERALL_MAX_TOKENS : refineTargetsMaxTokens((body.targets ?? []).length),
      },
      deps.fetch === undefined ? {} : { fetch: deps.fetch },
    )

    // 응답 경계에서 길이와 대상을 다시 확인한다 — 프롬프트로 부탁한 것만 믿지
    // 않는다. 넘으면 잘라 붙이지 않고 그대로 되돌린다 (손검수 Patch 1 §6).
    const read = readRefineOutput(body.scope, result.output, {
      allowedBlockIds: (body.targets ?? []).map((t) => t.blockId),
    })
    if (!read.ok) {
      deps.log?.({ code: read.code, status: 502, ...(result.requestId === undefined ? {} : { requestId: result.requestId }) })
      return fail(read.code, 502, '다듬은 지시를 그대로 쓸 수 없습니다.', result.requestId)
    }

    return new Response(JSON.stringify(read.value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const known = err instanceof RefineProviderError
    const code: RefineErrorCode = known ? err.code : 'unknown'
    const status = known && err.status >= 400 ? err.status : 502
    const requestId = known ? err.requestId : undefined
    // 조사에 필요한 것만 남긴다 — 코드, 상태, 요청 id. 키도 공급자 원문도 아니다.
    deps.log?.({ code, status, ...(requestId === undefined ? {} : { requestId }) })
    return fail(code, status, '지시를 다듬지 못했습니다.', requestId)
  }
}
