/**
 * id는 새로고침을 넘어 겹치지 않는다 (id 충돌 Patch).
 *
 * 2026-09-16 회사 서버 배포(`http://192.168.0.128:3000`)에서 실제로 난 일이다.
 * `crypto.randomUUID`는 보안 컨텍스트에서만 존재하는데 평문 HTTP 주소는 그것이
 * 아니어서, id가 언제나 모듈 카운터로 떨어졌다. 카운터는 새로고침마다 0부터 다시
 * 세므로 두 번째 방문의 첫 자산이 첫 방문의 첫 자산과 **같은 id**를 받았고,
 * 자산 저장소는 id로 덮어쓰기 때문에 작업자가 올린 스타일 레퍼런스의 내용이 방금
 * 만든 결과물로 바뀌었다. 그 다음 생성부터 AI는 자기 결과를 레퍼런스로 다시 봤다.
 *
 * 그래서 검사는 "형식이 그럴듯한가"가 아니라 **모듈을 다시 읽어도 겹치지 않는가**를
 * 본다. 모듈을 새로 읽는 것이 곧 새로고침이다.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

async function freshCreateId(): Promise<(prefix?: string) => string> {
  vi.resetModules()
  const mod = (await import('../domain/factory')) as { createId: (prefix?: string) => string }
  return mod.createId
}

/** 그 배포의 브라우저 그대로 — getRandomValues는 있고 randomUUID는 없다. */
function insecureContext(): void {
  const real = globalThis.crypto
  vi.stubGlobal('crypto', {
    getRandomValues: real.getRandomValues.bind(real),
  } as unknown as Crypto)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('createId', () => {
  it('보안 컨텍스트가 아니어도 새로고침을 넘어 겹치지 않는다', async () => {
    insecureContext()
    // 첫 방문: 레퍼런스를 올리고 몇 가지를 만든다.
    const first = await freshCreateId()
    const before = [first('asset'), first('asset'), first('blk')]
    // 새로고침: 모듈이 다시 읽히고 카운터가 있었다면 0으로 돌아간다.
    const second = await freshCreateId()
    const after = [second('asset'), second('asset'), second('blk')]

    expect(new Set([...before, ...after]).size).toBe(6)
    // 예전 판이 내던 값. 하나라도 이 모양이면 새로고침 충돌이 되살아난 것이다.
    expect(before).not.toContain('asset_1')
    expect(after).not.toContain('asset_1')
  })

  it('난수 자체가 없는 환경에서도 겹치지 않는다', async () => {
    vi.stubGlobal('crypto', {} as unknown as Crypto)
    const first = await freshCreateId()
    const before = [first('asset'), first('asset')]
    const second = await freshCreateId()
    const after = [second('asset'), second('asset')]

    expect(new Set([...before, ...after]).size).toBe(4)
  })

  it('보안 컨텍스트에서는 지금까지처럼 randomUUID를 쓴다', async () => {
    const uuid = vi.fn(() => '11111111-2222-3333-4444-555555555555')
    vi.stubGlobal('crypto', { randomUUID: uuid } as unknown as Crypto)
    const createId = await freshCreateId()

    expect(createId('asset')).toBe('asset_11111111-2222-3333-4444-555555555555')
    expect(uuid).toHaveBeenCalledTimes(1)
  })

  it('접두사는 그대로 앞에 붙는다', async () => {
    insecureContext()
    const createId = await freshCreateId()
    expect(createId('asset').startsWith('asset_')).toBe(true)
    expect(createId().startsWith('blk_')).toBe(true)
  })
})
