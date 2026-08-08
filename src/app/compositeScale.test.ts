/**
 * 합성이 배율을 받는다 (임의 크기 합성 Patch).
 *
 * 지금까지 완성본은 **가로 840px 한 가지**로만 나왔다. 기획서 캔버스의 가로가
 * 그 값이고, 합성이 그 값을 그대로 결과 크기로 썼기 때문이다.
 *
 * 그 고정이 두 가지를 막고 있었다.
 *
 *  - **배너.** 규격마다 크기가 다른데 내놓을 수 있는 크기가 하나뿐이었다.
 *  - **해상도.** 문구 조각은 모델에게 1400px 안팎으로 받아 놓고 840 캔버스에
 *    줄여 붙인다. 버리는 해상도가 절반이 넘는데 되찾을 길이 없었다.
 *
 * 고치는 방법은 계획을 건드리지 않는 쪽이다. 계획의 모든 자리는 기획서 좌표이고,
 * **그리는 면만** 배수만큼 키운 뒤 붓에 같은 배수를 건다. 그러면 합성 코드는 배수를
 * 모르는 채로 더 큰 그림을 그린다 — 자리를 다시 계산하는 곳이 없으니 어긋날 곳도
 * 없다.
 *
 * 다만 "배수를 모른다"가 성립하지 않는 자리가 둘 있고, 이 검사가 그 둘을 붙든다.
 *
 *  - **그레인**은 장치 픽셀로 그리면 크게 뽑을수록 결이 촘촘해진다. 같은 그림인데
 *    배수마다 질감이 달라지면 그것은 같은 그림이 아니다.
 *  - **종이 테두리**는 원본을 384px까지만 훑어 만든다. 그 값을 그대로 두고 두 배로
 *    뽑으면 그림만 선명해지고 테두리는 뭉개진다 — 한 장 안에서 해상도가 어긋나는
 *    쪽이 전체가 조금 무른 것보다 눈에 띈다.
 *
 * 캔버스가 없는 곳이므로 **붓이 받은 지시**를 적어 두고 읽는다. 실제 픽셀은
 * 브라우저에서만 나오고, 여기서 지키는 것은 좌표와 배수의 약속이다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

/** 이 검사가 캔버스에게 시킨 일. */
interface Drawn {
  width: number
  height: number
  scaleX: number
  scaleY: number
  fills: { x: number; y: number; w: number; h: number }[]
  images: { w: number; h: number }[]
}

let drawn: Drawn[] = []

vi.mock('../domain/toneAdjust', async () => {
  const actual = await vi.importActual<typeof import('../domain/toneAdjust')>('../domain/toneAdjust')
  return actual
})

/** 캔버스 흉내. 받은 지시를 그대로 적는다. */
function installCanvas(): void {
  drawn = []
  const make = (): HTMLCanvasElement => {
    const record: Drawn = { width: 0, height: 0, scaleX: 1, scaleY: 1, fills: [], images: [] }
    drawn.push(record)
    const ctx = {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      font: '',
      textAlign: 'left',
      filter: '',
      scale: (x: number, y: number) => {
        record.scaleX *= x
        record.scaleY *= y
      },
      fillRect: (x: number, y: number, w: number, h: number) => record.fills.push({ x, y, w, h }),
      drawImage: (...args: unknown[]) => {
        const [, ...rest] = args
        const nums = rest.filter((v): v is number => typeof v === 'number')
        const [w, h] = nums.length >= 8 ? nums.slice(6, 8) : nums.slice(2, 4)
        record.images.push({ w: w ?? 0, h: h ?? 0 })
      },
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      clip: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      rect: () => {},
      fillText: () => {},
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
      putImageData: () => {},
    }
    return {
      get width() {
        return record.width
      },
      set width(v: number) {
        record.width = v
      },
      get height() {
        return record.height
      },
      set height(v: number) {
        record.height = v
      },
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([1])], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement
  }
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? make() : ({} as HTMLElement)) as typeof document.createElement)
}

const PLAN: import('../domain/composite').CompositePlan = {
  size: { width: 840, height: 1200 },
  layers: [],
  texts: [],
  grain: 0.5,
  tone: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
  externalCalls: 0,
}

const SOURCES = {
  blobs: new Map<string, Blob>(),
  analyses: new Map(),
  papers: new Map(),
  boxes: new Map(),
}

beforeEach(() => {
  vi.restoreAllMocks()
  installCanvas()
})

describe('§27 합성이 배율을 받는다', () => {
  it('배수를 주지 않으면 지금까지와 한 픽셀도 다르지 않다', async () => {
    const { renderComposite } = await import('../services/compositeRenderer')
    await renderComposite(PLAN, SOURCES)

    const out = drawn[0]!
    expect([out.width, out.height]).toEqual([840, 1200])
    // 붓에 배수를 걸지 않는다 — 걸면 1배에서도 반올림 오차가 생긴다.
    expect([out.scaleX, out.scaleY]).toEqual([1, 1])
    expect(out.fills[0]).toEqual({ x: 0, y: 0, w: 840, h: 1200 })
  })

  it('배수를 주면 면만 커지고 좌표계는 그대로다', async () => {
    const { renderComposite } = await import('../services/compositeRenderer')
    await renderComposite(PLAN, SOURCES, { scale: 2 })

    const out = drawn[0]!
    expect([out.width, out.height]).toEqual([1680, 2400])
    expect(out.scaleX).toBeCloseTo(2, 6)
    expect(out.scaleY).toBeCloseTo(2, 6)
    // 흰 바탕은 **기획서 좌표**로 채운다. 장치 픽셀로 채우면 붓에 걸린 배수가
    // 한 번 더 곱해져 캔버스 밖으로 넘친다.
    expect(out.fills[0]).toEqual({ x: 0, y: 0, w: 840, h: 1200 })
  })

  it('그레인은 배수와 상관없이 같은 결이다', async () => {
    const { renderComposite } = await import('../services/compositeRenderer')
    await renderComposite(PLAN, SOURCES, { scale: 3 })

    const out = drawn[0]!
    // 그레인은 마지막에 화면 전체로 한 번 그려진다. 그 크기가 기획서 좌표여야
    // 배수를 올려도 결이 촘촘해지지 않는다.
    expect(out.images.at(-1)).toEqual({ w: 840, h: 1200 })
  })

  it('아주 작은 배수도 그림이 사라지지 않는다', async () => {
    const { renderComposite } = await import('../services/compositeRenderer')
    await renderComposite(PLAN, SOURCES, { scale: 0.001 })

    const out = drawn[0]!
    expect(out.width).toBeGreaterThanOrEqual(1)
    expect(out.height).toBeGreaterThanOrEqual(1)
  })
})

describe('§27-2 종이 테두리도 배수를 따라간다', () => {
  it('크게 뽑으면 종이 모양도 그만큼 촘촘히 만든다', async () => {
    vi.resetModules()
    const seen: number[] = []
    vi.doMock('../services/paperCutoutShape', () => ({
      PAPER_WORK_MAX: 384,
      buildPaperCanvas: async (_b: Blob, _x: unknown, _s: string, _w: number, scale: number) => {
        seen.push(scale)
        return null
      },
    }))
    vi.doMock('../services/assetStore', () => ({
      getAsset: async () => ({ id: 'a', blob: new Blob(['x']), fileName: 'a.png', mimeType: 'image/png', byteSize: 1 }),
    }))
    vi.doMock('../services/imageAnalysisRunner', () => ({ analyzeImageBlob: async () => null }))
    vi.doMock('../services/photoContent', () => ({ measurePhoto: async () => null }))

    const { collectCompositeSources } = await import('../services/compositeSources')
    const plan = {
      ...PLAN,
      layers: [
        {
          blockId: 'blk',
          assetId: 'a',
          rect: { x: 0, y: 0, width: 100, height: 100 },
          fit: 'cover',
          order: 0,
          effects: { paperCutout: true, paperWeight: 0.3, paperOpacity: 1 },
        },
      ],
    } as unknown as Parameters<typeof collectCompositeSources>[0]

    await collectCompositeSources(plan)
    await collectCompositeSources(plan, { scale: 2 })

    // 실패하면 그림만 선명해지고 종이 가장자리는 384짜리를 늘린 채로 남는다.
    expect(seen).toEqual([1, 2])
    vi.doUnmock('../services/paperCutoutShape')
    vi.resetModules()
  })
})
