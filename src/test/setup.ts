/**
 * Vitest setup. @testing-library/react auto-cleans between tests when the
 * framework's afterEach global is present (vitest `globals: true`), but we
 * register cleanup explicitly so the suite is robust regardless of config.
 */
import 'fake-indexeddb/auto'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom does not implement PointerEvent; provide a MouseEvent-based shim so
// drag/resize tests can carry clientX/clientY and modifier keys.
class PointerEventShim extends MouseEvent {
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
  }
}
if (!('PointerEvent' in globalThis)) {
  Object.defineProperty(globalThis, 'PointerEvent', {
    value: PointerEventShim,
    configurable: true,
    writable: true,
  })
}

// jsdom does not implement object URLs; provide harmless stubs so asset code
// that creates/revokes URLs can run under tests.
if (typeof URL.createObjectURL !== 'function') {
  let counter = 0
  URL.createObjectURL = () => `blob:mock/${(counter += 1)}`
  URL.revokeObjectURL = () => {}
}

afterEach(() => {
  cleanup()
})

// ── 문구 꾸미기 (2026-09-17) ────────────────────────────────────────────────
//
// 문구는 이제 **글꼴을 고른 블록만** 만들어진다 (글꼴 필수). 화면 흐름을 보는
// 검사들은 글꼴을 고르지 않은 채 문구 오브젝트가 생기기를 기다리므로, 여기서
// 모든 문구 블록에 시험용 글꼴 하나를 고른 것으로 둔다. 글꼴 파일과 캔버스
// 그리기는 jsdom에 없으므로 흉내만 낸다 — 규칙은 `textStyle.test.ts`가 숫자로 잰다.
// 글꼴이 없을 때 만들지 않는 것은 `textDecorate.test.tsx`가 따로 본다.
import { vi } from 'vitest'

export const TEST_FONT_FAMILY = '시험 글꼴'

vi.mock('../domain/studioJob', async () => {
  const actual = await vi.importActual<typeof import('../domain/studioJob')>('../domain/studioJob')
  return {
    ...actual,
    blockOrderOf: (job: Parameters<typeof actual.blockOrderOf>[0], blockId: string) => {
      const order = actual.blockOrderOf(job, blockId)
      if ((globalThis as { __noTestFont?: boolean }).__noTestFont === true) return order
      return order.fontFamily === undefined ? { fontFamily: TEST_FONT_FAMILY, ...order } : order
    },
  }
})

vi.mock('../services/fontLoader', async () => {
  const actual = await vi.importActual<typeof import('../services/fontLoader')>('../services/fontLoader')
  const file = { file: 'test-700.woff2', family: TEST_FONT_FAMILY, weight: 700, group: '시험', script: 'ko' as const, bytes: 1 }
  return {
    ...actual,
    fetchFontCatalog: async () => [file],
    loadFont: async () => true,
    loadFamilyWeight: async () => file,
  }
})

vi.mock('../services/textPlateRenderer', async () => {
  const actual = await vi.importActual<typeof import('../services/textPlateRenderer')>('../services/textPlateRenderer')
  return {
    ...actual,
    renderTextPlate: async (request: { plate: { width: number; height: number }; keyed: boolean }) => ({
      blob: new Blob([new Uint8Array([request.keyed ? 7 : 8])], { type: 'image/png' }),
      layout: { fontSize: 10, lineHeight: 12, lines: [], fill: 0.94 },
    }),
  }
})
