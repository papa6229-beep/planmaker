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
export const REFINE_REASONING_EFFORT = 'xhigh'
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
  '사용자의 짧고 모호한 말을, 실제 이미지 생성·편집 모델이 실행하기 쉬운 구체적인 지시로 바꿉니다.',
  '',
  '반드시 지킬 것:',
  '1. 기획서의 모든 문구 원문은 한 글자도 바꾸지 않습니다. 지시문에서도 원문을 그대로 인용합니다.',
  '2. 사용자가 요구하지 않은 상품·가격·혜택·문구·로고를 추가하지 않습니다.',
  '3. 수정할 대상과 그 좌표 범위를 지시문 안에 분명히 적습니다.',
  '4. 선택하지 않은 유사 문구·이미지·배경은 변경하지 말라고 분명히 적습니다.',
  '5. "예쁘게", "밋밋하게", "중앙으로" 같은 말은 시각적으로 판정 가능한 표현으로 바꿉니다.',
  '   (예: 자간·굵기·대비·색상·정렬 기준·여백을 무엇에 맞출 것인지)',
  '6. 정확한 픽셀 이동이나 픽셀 단위 보존을 보장한다고 쓰지 않습니다. 그것은 거짓말입니다.',
  '7. 통이미지 편집 특성상 선택 밖 주변이 일부 달라질 수 있는 경우에는 짧은 경고를 함께 돌려줍니다.',
  '8. 설명·사과·잡담 없이 실제 실행 지시만 돌려줍니다.',
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
 * 규칙은 시스템 자리에 있고 여기에는 **사실만** 적는다 — 지금 페이지가 무엇이고,
 * 어떤 문구가 어디에 있고, 사람이 무엇을 원한다고 말했는가.
 */
export function buildRefineUserText(body: RefineRequestBody): string {
  const lines: string[] = []

  lines.push('## 지금 페이지')
  lines.push(
    `${body.page.title} (${String(body.page.number)} / ${String(body.page.total)}) · 가로 ${String(body.page.width)} × 세로 ${String(body.page.height)}`,
  )
  if (body.concept !== undefined && body.concept.trim().length > 0) lines.push(`전체 컨셉: ${body.concept}`)
  if (body.designerNote !== undefined && body.designerNote.trim().length > 0) {
    lines.push(`기획서 전달사항: ${body.designerNote}`)
  }
  lines.push(`참고 이미지: ${body.hasReference ? '있음' : '없음'}`)
  lines.push('')

  lines.push('## 페이지의 문구 (원문 그대로)')
  if (body.texts.length === 0) lines.push('- (없음)')
  for (const text of body.texts) lines.push(`- "${text.content}" · ${boxText(text.box)}`)
  lines.push('')

  lines.push('## 이미지 자리')
  if (body.imageSlots.length === 0) lines.push('- (없음)')
  for (const slot of body.imageSlots) {
    const what = slot.description === undefined || slot.description.length === 0 ? '설명 없음' : slot.description
    lines.push(`- ${what} · ${boxText(slot.box)} · 실제 제품 이미지 ${slot.hasProduct ? '연결됨' : '미연결'}`)
  }
  lines.push('')

  if (body.buttons.length > 0) {
    lines.push('## 버튼 문구')
    for (const button of body.buttons) lines.push(`- "${button.text}"`)
    lines.push('')
  }

  if (body.scope === 'overall') {
    lines.push('## 사용자가 쓴 말 (원문)')
    lines.push(body.userText ?? '')
    lines.push('')
    lines.push('위 한 문장을, 이 페이지 전체 생성에 붙일 실행 가능한 추가 지시로 다듬어 주세요.')
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
  lines.push('각 대상마다 그 대상 하나에만 적용되는 지시를 따로 돌려주세요. 한 대상의 지시가 다른 대상에 적용되면 안 됩니다.')

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

/** 모델이 돌려준 것을 우리 모양으로 좁힌다. 모양이 아니면 `null`. */
export function parseRefineOutput(scope: RefineScope, raw: unknown): RefineSuccess | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>

  if (scope === 'overall') {
    const revised = value.revisedInstruction
    if (typeof revised !== 'string' || revised.trim().length === 0) return null
    const warnings = Array.isArray(value.warnings)
      ? value.warnings.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
      : []
    return { scope: 'overall', result: { revisedInstruction: revised.trim(), warnings } }
  }

  const items = value.items
  if (!Array.isArray(items)) return null
  const parsed: RefineTargetResult[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const blockId = entry.blockId
    const revised = entry.revisedInstruction
    if (typeof blockId !== 'string' || typeof revised !== 'string' || revised.trim().length === 0) continue
    const warning = typeof entry.warning === 'string' && entry.warning.trim().length > 0 ? entry.warning.trim() : undefined
    parsed.push({ blockId, revisedInstruction: revised.trim(), ...(warning === undefined ? {} : { warning }) })
  }
  if (parsed.length === 0) return null
  return { scope: 'targets', result: { items: parsed } }
}
