/**
 * AI 지시 다듬기의 계약 (실작업 UI 마감 §6–§11).
 *
 * 이것은 이미지를 만드는 기능이 **아니다**. 작업자가 던진 거친 한 마디를, 이미지
 * 편집 모델이 실행하기 쉬운 지시로 바꾸는 텍스트 요청 한 번이다. 그래서 값이 싸고,
 * 그래서 결과를 사람이 읽고 고른 뒤에야 적용된다.
 *
 * 브라우저와 서버 함수가 같은 말을 쓰기 위한 곳이므로 여기 있는 것은 전부
 * 직렬화되는 값뿐이다. 이미지도, 키도 들어오지 않는다 — 분석용 축소 이미지 한 장만
 * data URL로 지나가고, 그것도 원본 자산을 바꾸지 않는다.
 *
 * 순수 모듈이다. 네트워크도 저장소도 화면도 모른다.
 */

/** 브라우저가 서버 함수를 부르는 곳. */
export const REFINE_INSTRUCTION_PATH = '/api/refine-instruction'

/** 이번 단계의 모델과 추론 강도 — 화면과 요청에 이 값이 그대로 간다. */
export const REFINE_MODEL = 'gpt-5.6-sol'
/**
 * 추론 강도 (손검수 Patch 1 §5).
 *
 * `xhigh`는 사용자의 한 줄을 "완성된 기획"으로 다시 짜려 들었다. 여기서 필요한
 * 것은 설계가 아니라 **모호한 표현 몇 개를 구체적으로 바꾸는 일**이다.
 */
export const REFINE_REASONING_EFFORT = 'high'

/**
 * 길이 계약 (§3, §4).
 *
 * 프롬프트로 부탁만 하고 끝내지 않는다. 이 숫자는 응답 경계에서 실제로 확인하는
 * 상한이고, 넘으면 **적용하지 않는다** — 중간을 잘라 붙이는 것은 사람이 읽지 않은
 * 문장을 사람이 쓴 것처럼 만드는 일이다.
 */
export const REFINE_OVERALL_MAX_CHARS = 1200
export const REFINE_TARGET_MAX_CHARS = 400
/** 프롬프트에 적어 주는 권장 범위 — 짧으면 억지로 채우지 않는다. */
export const REFINE_OVERALL_MIN_CHARS = 800
export const REFINE_OVERALL_MIN_ITEMS = 3
export const REFINE_OVERALL_MAX_ITEMS = 8

/**
 * 공급자가 쓸 수 있는 최대 토큰. 추론 토큰까지 함께 세므로 글자 상한보다 넉넉히
 * 두되, 끝없이 길어지는 응답에 값을 치르지는 않는다.
 */
export const REFINE_OVERALL_MAX_TOKENS = 4000
export function refineTargetsMaxTokens(targetCount: number): number {
  return 3000 + 700 * Math.max(1, targetCount)
}
/** 한 번 누르면 한 번 나간다. 자동 재시도는 없다. */
export const REFINE_CALLS_PER_CLICK = 1

/** 버튼 곁에 붙는 한 줄. 과장하지 않고, 값이 드는 일이라는 사실만 말한다. */
export const REFINE_COST_NOTE = '지시 다듬기는 텍스트 AI 요청 1회이며 이미지를 생성하지 않습니다.'

/** 분석용으로 보내는 축소 이미지의 최대 가로. 입력 비용을 위해 작게 보낸다. */
export const REFINE_PREVIEW_MAX_WIDTH = 512

/**
 * 지시 다듬기 헌법 (§8).
 *
 * 사용자의 문장과 섞지 않고 시스템 자리에 따로 싣는다. 섞으면 사용자의 한 문장이
 * 규칙을 지워 버릴 수 있고, 무엇이 규칙이고 무엇이 사람 뜻인지 검사할 수 없다.
 */
export const REFINE_SYSTEM_INSTRUCTION = [
  '당신은 쇼핑몰 이벤트 페이지를 검수하는 수석 웹디자인 팀장입니다.',
  '',
  '당신이 하는 일은 하나입니다: 사용자가 **추가로 적은 주문**에서 모호한 표현만 구체화하는 것.',
  '구체화의 기준은 이미지 생성·편집 모델이 실행하기 쉬운 표현인가입니다.',
  '기획서 전체를 재작성하지 마십시오. 기획서의 문구·좌표·자산 목록과 공통 보존 규칙은',
  '별도 구조 데이터로 이미 전달되므로 반복하지 마십시오.',
  '',
  '돌려줄 것:',
  '- 원하는 배경 분위기',
  '- 제품 배치에 대한 추가 허용·금지',
  '- 강조하고 싶은 시각적 우선순위',
  '- 색상·폰트·효과에 대한 추가 요구',
  '- 사용자가 직접 말한 보존 요구',
  '',
  '돌려주지 말 것:',
  '- 모든 문구 원문 재열거',
  '- 모든 좌표 재열거',
  '- 모든 제품·로고 목록 재열거',
  '- 캔버스 전체 구조 재작성',
  '- 기획서에 이미 들어 있는 공통 보존 규칙 반복',
  '- 사용자가 말하지 않은 디자인·혜택·상품 정보 추가',
  '',
  '반드시 지킬 것:',
  '1. 기획서의 모든 문구 원문은 한 글자도 바꾸지 않습니다.',
  '2. 사용자가 요구하지 않은 상품·가격·혜택·문구·로고를 추가하지 않습니다.',
  '3. 좌표를 언급해야 한다면 지금 다루는 그 대상의 것만 적습니다.',
  '4. 선택하지 않은 유사 문구·이미지·배경은 유지하라고 **한 문장으로만** 적습니다.',
  '5. "예쁘게", "밋밋하게", "중앙으로" 같은 말은 시각적으로 판정 가능한 표현으로 바꿉니다.',
  '   (예: 자간·굵기·대비·색상·정렬 기준·여백을 무엇에 맞출 것인지)',
  '6. 정확한 픽셀 이동이나 픽셀 단위 보존을 보장한다고 쓰지 않습니다. 그것은 거짓말입니다.',
  '7. 통이미지 편집 특성상 선택 밖 주변이 일부 달라질 수 있는 경우에는 짧은 경고를 함께 돌려줍니다.',
  '8. 분석·서문·맺음말을 붙이지 않고, 설명·사과·잡담 없이, 바로 이미지 모델에 전달할 실행 지시만 돌려줍니다.',
  '9. 같은 의미를 다른 말로 되풀이하지 않습니다.',
].join('\n')

export type RefineScope = 'overall' | 'targets'

export interface RefineBox {
  x: number
  y: number
  width: number
  height: number
}

/** 고른 대상 하나와, 그 대상에만 적용할 사람의 문장. */
export interface RefineTargetInput {
  /** 블록 id. 배경은 블록이 아니므로 `background`가 그 자리를 쓴다. */
  blockId: string
  label: string
  kind: 'text' | 'image' | 'background'
  content?: string
  box?: RefineBox
  hasProduct?: boolean
  instruction: string
}

export interface RefinePageInfo {
  title: string
  number: number
  total: number
  width: number
  height: number
}

export interface RefineTextInfo {
  blockId: string
  content: string
  box: RefineBox
}

export interface RefineImageSlotInfo {
  blockId: string
  description?: string
  box: RefineBox
  hasProduct: boolean
}

export interface RefineButtonInfo {
  blockId: string
  text: string
}

export interface RefineRequestBody {
  scope: RefineScope
  /** `overall`에서 사람이 쓴 원문. */
  userText?: string
  /** `targets`에서 고른 대상들. */
  targets?: RefineTargetInput[]
  /** 고르지 않은 대상 — "건드리지 말 것"으로 함께 보낸다. */
  untouched?: string[]
  page: RefinePageInfo
  concept?: string
  designerNote?: string
  texts: RefineTextInfo[]
  imageSlots: RefineImageSlotInfo[]
  buttons: RefineButtonInfo[]
  hasReference: boolean
  /** 분석용 축소 이미지 (data URL). 없으면 글로만 판단한다. */
  previewImage?: string
}

export interface RefineOverallResult {
  revisedInstruction: string
  warnings: string[]
}

export interface RefineTargetResult {
  blockId: string
  revisedInstruction: string
  warning?: string
}

export interface RefineTargetsResult {
  items: RefineTargetResult[]
}

export type RefineSuccess =
  | { scope: 'overall'; result: RefineOverallResult }
  | { scope: 'targets'; result: RefineTargetsResult }

export type RefineErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'model_not_found'
  | 'insufficient_quota'
  | 'rate_limited'
  | 'function_timeout'
  | 'network_error'
  /** 구조화 응답이 약속한 모양으로 오지 않았다. */
  | 'bad_output'
  /** 모양은 맞지만 길이·대상 계약을 넘었다 — 잘라 붙이지 않고 되돌린다 (§6). */
  | 'output_too_long'
  | 'bad_request'
  | 'unknown'

export interface RefineFailure {
  error: { code: RefineErrorCode; message: string; requestId?: string }
}

/** 짧은 원인과 다음 행동. 공급자 원문은 절대 여기 오지 않는다 (§11). */
export const REFINE_ERROR_TEXT: Record<RefineErrorCode, string> = {
  missing_api_key: 'OpenAI API 키를 먼저 입력해 주세요.',
  invalid_api_key: 'API 키가 올바르지 않습니다. 키를 다시 입력해 주세요.',
  model_not_found: '이 키로는 해당 텍스트 모델을 사용할 수 없습니다. 조직의 모델 사용 권한을 확인해 주세요.',
  insufficient_quota: '크레딧 또는 결제에 문제가 있어 다듬지 못했습니다. OpenAI 결제 상태를 확인해 주세요.',
  rate_limited: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
  function_timeout: '다듬는 데 시간이 너무 오래 걸렸습니다. 잠시 후 다시 시도해 주세요.',
  network_error: '네트워크 문제로 요청을 마치지 못했습니다. 연결을 확인하고 다시 시도해 주세요.',
  bad_output: '다듬은 지시를 약속된 형식으로 받지 못했습니다. 다시 시도해 주세요.',
  output_too_long: 'AI가 지시를 너무 길게 작성했습니다. 다시 다듬어 주세요.',
  bad_request: '보낼 내용이 올바르지 않습니다. 지시를 적었는지 확인해 주세요.',
  unknown: '지시를 다듬지 못했습니다. 잠시 후 다시 시도해 주세요.',
}

export function refineErrorTextFor(code: string | undefined): string {
  return REFINE_ERROR_TEXT[(code ?? 'unknown') as RefineErrorCode] ?? REFINE_ERROR_TEXT.unknown
}

function boxText(box: RefineBox | undefined): string {
  if (box === undefined) return ''
  return `x ${String(Math.round(box.x))}, y ${String(Math.round(box.y))}, 가로 ${String(Math.round(box.width))}, 세로 ${String(Math.round(box.height))}`
}

/**
 * 사람 자리에 실리는 한 장.
 *
 * 규칙은 시스템 자리에 있고 여기에는 **사실만** 적는다. 기획서의 구조는 참고용으로
 * 딸려 가되, 그것을 다시 적어 내라는 뜻이 아니라는 것을 분명히 해 둔다 — 앞선
 * 손검수에서 모델은 이 목록을 "돌려줄 내용의 초안"으로 읽고 통째로 되풀이했다
 * (손검수 Patch 1 §1).
 */
export function buildRefineUserText(body: RefineRequestBody): string {
  const lines: string[] = []

  lines.push('## 참고용 기획서 구조 (그대로 되풀이하지 마십시오)')
  lines.push('아래는 판단에만 쓰는 참고 자료입니다. 이 내용은 이미지 생성기의 정규 프롬프트가 따로 전달하므로,')
  lines.push('돌려주는 지시문에 문구 원문·좌표·자산 목록을 반복하지 마십시오.')
  lines.push('')
  lines.push(
    `- 페이지: ${body.page.title} (${String(body.page.number)} / ${String(body.page.total)}) · 가로 ${String(body.page.width)} × 세로 ${String(body.page.height)}`,
  )
  if (body.concept !== undefined && body.concept.trim().length > 0) lines.push(`- 전체 컨셉: ${body.concept}`)
  if (body.designerNote !== undefined && body.designerNote.trim().length > 0) {
    lines.push(`- 기획서 전달사항: ${body.designerNote}`)
  }
  lines.push(`- 참고 이미지: ${body.hasReference ? '있음' : '없음'}`)
  for (const text of body.texts) lines.push(`- 문구 "${text.content}" · ${boxText(text.box)}`)
  for (const slot of body.imageSlots) {
    const what = slot.description === undefined || slot.description.length === 0 ? '설명 없음' : slot.description
    lines.push(`- 이미지 자리 ${what} · ${boxText(slot.box)} · 실제 제품 이미지 ${slot.hasProduct ? '연결됨' : '미연결'}`)
  }
  for (const button of body.buttons) lines.push(`- 버튼 "${button.text}"`)
  lines.push('')

  if (body.scope === 'overall') {
    lines.push('## 사용자가 추가로 적은 주문 (원문)')
    lines.push(body.userText ?? '')
    lines.push('')
    lines.push('## 이번에 돌려줄 것')
    lines.push('위 추가 주문에서 모호한 표현만 구체화한 지시문 하나.')
    lines.push(
      `지시 ${String(REFINE_OVERALL_MIN_ITEMS)}~${String(REFINE_OVERALL_MAX_ITEMS)}개, 전체 ${String(REFINE_OVERALL_MIN_CHARS)}~${String(REFINE_OVERALL_MAX_CHARS)}자 이내.`,
    )
    lines.push(`${String(REFINE_OVERALL_MAX_CHARS)}자를 넘으면 적용되지 않습니다. 주문이 짧으면 억지로 채우지 마십시오.`)
    lines.push('기획서 구조를 다시 쓰지 말고, 사용자가 말한 것만 실행 가능한 문장으로 바꾸십시오.')
    return lines.join('\n')
  }

  lines.push('## 다듬을 대상과 사용자가 쓴 말')
  for (const target of body.targets ?? []) {
    lines.push(`### ${target.label} (blockId: ${target.blockId})`)
    lines.push(`종류: ${target.kind === 'image' ? '이미지 자리' : target.kind === 'background' ? '페이지 전체 배경' : '문구'}`)
    if (target.content !== undefined) lines.push(`원문: ${target.content}`)
    if (target.box !== undefined) lines.push(`좌표: ${boxText(target.box)}`)
    if (target.hasProduct === true) lines.push('이 자리에는 실제 제품·로고 원본이 연결돼 있습니다.')
    lines.push('사용자가 쓴 말:')
    lines.push(target.instruction)
    lines.push('')
  }

  lines.push('## 이번에 건드리지 말아야 할 것')
  if ((body.untouched ?? []).length === 0) lines.push('- (없음)')
  for (const label of body.untouched ?? []) lines.push(`- ${label}`)
  lines.push('')

  lines.push('## 이번에 돌려줄 것')
  lines.push('고른 대상마다 그 대상 하나에만 적용되는 짧은 수정 지시.')
  lines.push(`대상 하나당 지시 1~3개, 2~4문장, 300자 안팎, 최대 ${String(REFINE_TARGET_MAX_CHARS)}자.`)
  lines.push(`${String(REFINE_TARGET_MAX_CHARS)}자를 넘는 지시는 적용되지 않습니다.`)
  lines.push('그 대상에 필요한 좌표·정렬·간격만 적고, 선택하지 않은 부분을 유지하라는 말은 한 문장으로만 적으십시오.')
  lines.push('한 대상의 지시가 다른 대상에 적용되면 안 되고, 고른 대상은 하나도 빠뜨리지 마십시오.')

  return lines.join('\n')
}

/** 구조화 응답의 모양. 모델이 이 틀 밖으로 나가지 못하게 한다. */
export const REFINE_OVERALL_SCHEMA = {
  type: 'object',
  properties: {
    revisedInstruction: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['revisedInstruction', 'warnings'],
  additionalProperties: false,
} as const

export const REFINE_TARGETS_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          blockId: { type: 'string' },
          revisedInstruction: { type: 'string' },
          warning: { type: 'string' },
        },
        required: ['blockId', 'revisedInstruction', 'warning'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

/** 응답 경계에서 무엇을 확인할 수 있는가. */
export interface RefineOutputOptions {
  /** `targets`에서 사람이 실제로 고른 blockId 전부. 이 밖의 id는 받지 않는다. */
  allowedBlockIds?: readonly string[]
}

export type RefineOutputProblem = 'bad_output' | 'output_too_long'

export type RefineOutputResult =
  | { ok: true; value: RefineSuccess }
  | { ok: false; code: RefineOutputProblem }

/**
 * 모델이 돌려준 것을 우리 모양으로 좁힌다 (§6).
 *
 * 여기서 **자르지 않는다.** 길거나 어긋나면 통째로 거절한다 — 중간을 잘라 붙이면
 * 사람이 읽지 않은 문장이 사람이 쓴 것처럼 남고, 그것이 다음 유료 호출로 나간다.
 * 스스로 다시 부르지도 않는다.
 */
export function readRefineOutput(
  scope: RefineScope,
  raw: unknown,
  options: RefineOutputOptions = {},
): RefineOutputResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'bad_output' }
  const value = raw as Record<string, unknown>

  if (scope === 'overall') {
    const revised = value.revisedInstruction
    if (typeof revised !== 'string' || revised.trim().length === 0) return { ok: false, code: 'bad_output' }
    const trimmed = revised.trim()
    if (trimmed.length > REFINE_OVERALL_MAX_CHARS) return { ok: false, code: 'output_too_long' }
    const warnings = Array.isArray(value.warnings)
      ? value.warnings.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
      : []
    return { ok: true, value: { scope: 'overall', result: { revisedInstruction: trimmed, warnings } } }
  }

  const items = value.items
  if (!Array.isArray(items)) return { ok: false, code: 'bad_output' }

  const allowed = options.allowedBlockIds
  const seen = new Set<string>()
  const parsed: RefineTargetResult[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return { ok: false, code: 'bad_output' }
    const entry = item as Record<string, unknown>
    const blockId = entry.blockId
    const revised = entry.revisedInstruction
    if (typeof blockId !== 'string' || typeof revised !== 'string' || revised.trim().length === 0) {
      return { ok: false, code: 'bad_output' }
    }
    // 같은 대상을 두 번 말하면 어느 쪽이 그 대상의 지시인지 알 수 없다.
    if (seen.has(blockId)) return { ok: false, code: 'bad_output' }
    // 고르지 않은 대상의 지시는 받지 않는다 — 사람이 고르지 않은 것이 바뀐다.
    if (allowed !== undefined && !allowed.includes(blockId)) return { ok: false, code: 'bad_output' }
    const trimmed = revised.trim()
    if (trimmed.length > REFINE_TARGET_MAX_CHARS) return { ok: false, code: 'output_too_long' }
    seen.add(blockId)
    const warning = typeof entry.warning === 'string' && entry.warning.trim().length > 0 ? entry.warning.trim() : undefined
    parsed.push({ blockId, revisedInstruction: trimmed, ...(warning === undefined ? {} : { warning }) })
  }
  if (parsed.length === 0) return { ok: false, code: 'bad_output' }
  // 고른 대상이 하나라도 빠지면, 빈 칸이 왜 비었는지 사람이 알 수 없다.
  if (allowed !== undefined && allowed.some((id) => !seen.has(id))) return { ok: false, code: 'bad_output' }

  return { ok: true, value: { scope: 'targets', result: { items: parsed } } }
}

/** 얇은 겉면 — 통과하면 값, 아니면 `null`. */
export function parseRefineOutput(
  scope: RefineScope,
  raw: unknown,
  options: RefineOutputOptions = {},
): RefineSuccess | null {
  const read = readRefineOutput(scope, raw, options)
  return read.ok ? read.value : null
}
