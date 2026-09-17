/**
 * 돈이 **어디로** 나갔는가 (사용량 기록 Patch).
 *
 * ## 왜 총액이 아니라 갈래인가
 *
 * 얼마 썼는지는 OpenAI 대시보드가 이미 정확히 알려 준다. 거기서 얻을 수 없는 것은
 * **그 돈이 우리 화면의 어느 동작에서 나갔는가**다. 한 페이지를 만드는 일이 호출
 * 한 번이 아니기 때문이다 — 배경 판 한 번, 그 위에 얹을 문구 겹이 블록 수만큼,
 * 부분수정은 고친 개수만큼, 배경 합성은 또 따로다.
 *
 * 갈래를 함께 적어 두면 일주일 뒤 "돈의 몇 할이 문구 겹에서 나간다"를 숫자로 말할
 * 수 있고, 줄일 자리를 짐작이 아니라 근거로 고를 수 있다. 갈래 없이 총량만 모으면
 * 대시보드와 같은 말을 한 번 더 하는 것뿐이다.
 *
 * ## 토큰이 없어도 기록한다
 *
 * 공급자가 사용량을 안 보내 줄 수도 있다. 그때도 **호출이 있었다는 사실**은 남긴다 —
 * 갈래별 횟수만으로도 "어디를 자주 부르는가"는 드러나고, 그것이 이 기록의 절반이다.
 *
 * 여기 있는 것은 전부 순수 함수다. 저장은 `services/usageStore.ts`가 맡는다.
 */

/** 어느 동작이 부른 호출인가. */
export const USAGE_KINDS = ['plate', 'text-layer', 'edit', 'background'] as const
export type UsageKind = (typeof USAGE_KINDS)[number]

/** 사람이 읽는 이름. 화면과 기록이 같은 말을 쓰게 한다. */
export const USAGE_KIND_LABEL: Record<UsageKind, string> = {
  plate: '배경 판',
  'text-layer': '문구 겹',
  edit: '부분수정',
  background: '배경 합성',
}

export interface ImageUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/** 호출 한 건. 토큰은 공급자가 줄 때만 있다. */
export interface UsageCall {
  at: number
  kind: UsageKind
  usage?: ImageUsage
}

/** 이보다 오래된 것부터 지운다. 요금을 판단하는 데 몇 달 치가 필요하지는 않다. */
export const USAGE_KEEP = 2000

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * 공급자가 보낸 사용량에서 **숫자 셋만** 꺼낸다.
 *
 * 받은 것을 그대로 저장하지 않는 이유가 있다. 이 값은 우리가 모양을 정하지 않은
 * 남의 응답이고, 통째로 넣으면 무엇이 브라우저에 쌓이는지 우리가 모르게 된다.
 * 아는 이름 셋만, 그것도 유한한 0 이상의 수일 때만 옮긴다.
 *
 * 쓸 만한 것이 하나도 없으면 `null`이다 — 호출 사실만 남고 토큰 자리는 빈다.
 */
export function readImageUsage(raw: unknown): ImageUsage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const body = raw as Record<string, unknown>
  const usage: ImageUsage = {
    ...(positive(body.input_tokens) === undefined ? {} : { inputTokens: positive(body.input_tokens)! }),
    ...(positive(body.output_tokens) === undefined ? {} : { outputTokens: positive(body.output_tokens)! }),
    ...(positive(body.total_tokens) === undefined ? {} : { totalTokens: positive(body.total_tokens)! }),
  }
  return Object.keys(usage).length === 0 ? null : usage
}

/** 이 호출이 쓴 토큰. 합계를 안 주면 들어온 것과 나간 것을 더한다. */
export function tokensOf(call: UsageCall): number {
  const usage = call.usage
  if (usage === undefined) return 0
  return usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
}

export interface UsageSummary {
  calls: number
  tokens: number
  byKind: Record<UsageKind, { calls: number; tokens: number }>
}

/**
 * 갈래별로 묶는다. 갈래가 하나도 없어도 **네 칸은 언제나 있다** — 0이라는 사실도
 * 읽을 값이고, 없는 칸을 화면이 따로 다루게 만들 이유가 없다.
 */
export function summarizeUsage(calls: readonly UsageCall[]): UsageSummary {
  const byKind = Object.fromEntries(
    USAGE_KINDS.map((kind) => [kind, { calls: 0, tokens: 0 }]),
  ) as UsageSummary['byKind']
  let tokens = 0
  for (const call of calls) {
    const slot = byKind[call.kind]
    // 모르는 갈래는 총계에만 들어간다 — 예전 판이 적어 둔 것이 있을 수 있다.
    const used = tokensOf(call)
    tokens += used
    if (slot !== undefined) {
      slot.calls += 1
      slot.tokens += used
    }
  }
  return { calls: calls.length, tokens, byKind }
}
