/**
 * 요금을 판단할 자료를 모은다 (사용량 기록 Patch).
 *
 * 얼마 썼는지는 OpenAI 대시보드가 안다. 거기서 못 얻는 것은 **그 돈이 우리 화면의
 * 어느 동작에서 나갔는가**다 — 한 페이지가 호출 한 번이 아니기 때문이다.
 *
 * 여기서 지키는 것:
 *
 *  1. 공급자가 보낸 것에서 **아는 숫자 셋만** 옮긴다. 남의 응답을 통째로 브라우저에
 *     쌓지 않는다.
 *  2. 사용량을 안 줘도 **호출이 있었다는 사실**은 남는다.
 *  3. 장부는 무한히 자라지 않는다.
 *  4. 장부에 못 적어도 **작업은 그대로다** — `recordCall`은 던지지 않는다.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  readImageUsage,
  summarizeUsage,
  tokensOf,
  USAGE_KEEP,
  USAGE_KINDS,
  type UsageCall,
} from '../domain/imageUsage'
import { clearUsage, listCalls, recordCall, resetUsageStoreForTests } from '../services/usageStore'

describe('§U1 공급자가 보낸 사용량 읽기', () => {
  it('아는 숫자 셋만 옮기고 나머지는 버린다', () => {
    expect(
      readImageUsage({
        input_tokens: 1200,
        output_tokens: 340,
        total_tokens: 1540,
        // 우리가 모양을 정하지 않은 것들 — 통째로 저장하지 않는다.
        input_tokens_details: { text_tokens: 40, image_tokens: 1160 },
        prompt: '여름 감사제 40%',
      }),
    ).toEqual({ inputTokens: 1200, outputTokens: 340, totalTokens: 1540 })
  })

  it('숫자가 아니거나 음수면 그 칸만 빠진다', () => {
    expect(readImageUsage({ input_tokens: '1200', output_tokens: 340 })).toEqual({ outputTokens: 340 })
    expect(readImageUsage({ input_tokens: -5, total_tokens: Number.NaN })).toBeNull()
    expect(readImageUsage({ input_tokens: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('쓸 만한 것이 없으면 null이다 — 호출 사실만 남는다', () => {
    expect(readImageUsage(null)).toBeNull()
    expect(readImageUsage(undefined)).toBeNull()
    expect(readImageUsage({})).toBeNull()
    expect(readImageUsage('usage')).toBeNull()
    expect(readImageUsage({ cost_usd: 0.04 })).toBeNull()
  })

  it('합계를 안 주면 들어온 것과 나간 것을 더한다', () => {
    expect(tokensOf({ at: 1, kind: 'plate', usage: { totalTokens: 900 } })).toBe(900)
    expect(tokensOf({ at: 1, kind: 'plate', usage: { inputTokens: 700, outputTokens: 200 } })).toBe(900)
    // 사용량이 없어도 호출은 셈에 든다 — 토큰만 0이다.
    expect(tokensOf({ at: 1, kind: 'plate' })).toBe(0)
  })
})

describe('§U2 갈래별로 묶기', () => {
  it('한 페이지가 호출 한 번이 아니라는 것이 숫자로 보인다', () => {
    const calls: UsageCall[] = [
      { at: 1, kind: 'plate', usage: { totalTokens: 1000 } },
      { at: 2, kind: 'text-layer', usage: { totalTokens: 800 } },
      { at: 3, kind: 'text-layer', usage: { totalTokens: 800 } },
      { at: 4, kind: 'text-layer' },
      { at: 5, kind: 'edit', usage: { inputTokens: 300, outputTokens: 100 } },
    ]
    const summary = summarizeUsage(calls)
    expect(summary.calls).toBe(5)
    expect(summary.tokens).toBe(1000 + 800 + 800 + 0 + 400)
    expect(summary.byKind['text-layer']).toEqual({ calls: 3, tokens: 1600 })
    expect(summary.byKind.plate).toEqual({ calls: 1, tokens: 1000 })
    expect(summary.byKind.edit).toEqual({ calls: 1, tokens: 400 })
    // 부르지 않은 갈래도 칸은 있다 — 0도 읽을 값이다.
    expect(summary.byKind.background).toEqual({ calls: 0, tokens: 0 })
    expect(Object.keys(summary.byKind).toSorted()).toEqual([...USAGE_KINDS].toSorted())
  })

  it('빈 장부는 전부 0이다', () => {
    const summary = summarizeUsage([])
    expect(summary).toEqual({
      calls: 0,
      tokens: 0,
      byKind: {
        plate: { calls: 0, tokens: 0 },
        'text-layer': { calls: 0, tokens: 0 },
        edit: { calls: 0, tokens: 0 },
        background: { calls: 0, tokens: 0 },
      },
    })
  })
})

describe('§U3 장부', () => {
  beforeEach(async () => {
    resetUsageStoreForTests()
    await clearUsage()
  })

  it('적은 것이 그대로 돌아오고, 갈래가 남는다', async () => {
    await recordCall({ at: 10, kind: 'plate', usage: { totalTokens: 900 } })
    await recordCall({ at: 20, kind: 'text-layer' })
    const calls = await listCalls()
    expect(calls).toEqual([
      { at: 10, kind: 'plate', usage: { totalTokens: 900 } },
      { at: 20, kind: 'text-layer' },
    ])
    // 요약은 장부를 그대로 읽는다.
    expect(summarizeUsage(calls).byKind['text-layer'].calls).toBe(1)
  })

  /**
   * 장부가 무한히 자라면 작업 자료와 저장 한도를 나눠 쓰게 된다 — 기록하려던 것이
   * 기록을 방해한다.
   */
  it('오래된 것부터 지워 정해진 수만 남는다', async () => {
    for (let i = 0; i < USAGE_KEEP + 5; i += 1) {
      await recordCall({ at: i, kind: 'text-layer' })
    }
    const calls = await listCalls()
    expect(calls).toHaveLength(USAGE_KEEP)
    // 남은 것은 **최근** 것이다.
    expect(calls[0]?.at).toBe(5)
    expect(calls.at(-1)?.at).toBe(USAGE_KEEP + 4)
  }, 30000)

  it('비우면 작업 자료가 아니라 장부만 사라진다', async () => {
    await recordCall({ at: 1, kind: 'edit' })
    await clearUsage()
    expect(await listCalls()).toEqual([])
  })
})
