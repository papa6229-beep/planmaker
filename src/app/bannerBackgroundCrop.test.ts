/**
 * 배경의 **어디를** 잘라 쓰는가 (배너 Patch §3).
 *
 * 합성기는 지금까지 배경을 `cover`로 깔았다. 세로로 긴 이벤트 배경을 1020×70에
 * 넣으면 가운데 한 줄만 남는데, 하필 거기가 하트·풍선이 몰린 자리면 글자가 묻힌다.
 *
 * 그래서 계획이 자리를 정할 수 있게 했다. 이 검사가 붙드는 것은 그 자리가 정말로
 * 붓에게 전달되는가다. 타입만 붙어 있고 실제로는 늘 가운데를 그리는 일은 눈으로
 * 보기 전에는 알 수 없다 — 그림은 어차피 나오기 때문이다.
 *
 * 캔버스가 없는 곳이므로 **붓이 받은 지시**를 적어 두고 읽는다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CompositePlan } from '../domain/composite'

interface Drawn {
  /** `drawImage`에 넘어간 숫자들. 9개짜리면 앞 넷이 원본에서 잘라 온 자리다. */
  args: number[][]
}

let drawn: Drawn

function installCanvas(): void {
  drawn = { args: [] }
  const make = (): HTMLCanvasElement => {
    let width = 0
    let height = 0
    const ctx = {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      font: '',
      textAlign: 'left',
      filter: '',
      scale: () => {},
      fillRect: () => {},
      drawImage: (...args: unknown[]) => {
        drawn.args.push(args.filter((v): v is number => typeof v === 'number'))
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
        return width
      },
      set width(v: number) {
        width = v
      },
      get height() {
        return height
      },
      set height(v: number) {
        height = v
      },
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([1])], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement
  }
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? make() : ({} as HTMLElement)) as typeof document.createElement)
}

/** 배경 원본은 840×1180 — 실제 이벤트 페이지 크기. */
const BACKGROUND = { width: 840, height: 1180 }

type Box = { x: number; y: number; width: number; height: number }

function plan(crop?: Box, at?: Box): CompositePlan {
  return {
    size: { width: 1020, height: 70 },
    background: { assetId: 'bg', source: 'ai', ...(at === undefined ? {} : { rect: at }) },
    ...(crop === undefined ? {} : { backgroundCrop: crop }),
    layers: [],
    texts: [],
    grain: 0,
    tone: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
    externalCalls: 0,
  }
}

const SOURCES = {
  blobs: new Map<string, Blob>([['bg', new Blob([new Uint8Array([1])], { type: 'image/png' })]]),
  analyses: new Map(),
  papers: new Map(),
  boxes: new Map(),
}

beforeEach(() => {
  vi.restoreAllMocks()
  installCanvas()
  // jsdom 에는 이미지 디코더가 없다. 합성기가 먼저 찾는 길을 대신 세워 둔다 —
  // 여기서 알고 싶은 것은 픽셀이 아니라 **원본의 어느 자리를 읽었는가**뿐이다.
  vi.stubGlobal('createImageBitmap', async () => ({ ...BACKGROUND, close: () => {} }))
})

/** 배경을 그린 첫 `drawImage`의 원본 자리. */
function backgroundSource(): Box | null {
  const nine = drawn.args.find((a) => a.length >= 8)
  if (nine === undefined) return null
  return { x: nine[0]!, y: nine[1]!, width: nine[2]!, height: nine[3]! }
}

/** 그리고 캔버스의 **어디에** 놓았는가. */
function backgroundDest(): Box | null {
  const nine = drawn.args.find((a) => a.length >= 8)
  if (nine === undefined) return null
  return { x: nine[4]!, y: nine[5]!, width: nine[6]!, height: nine[7]! }
}

describe('§34 배경에서 잘라 쓸 자리', () => {
  it('자리를 주면 그 자리를 편다', async () => {
    const { renderComposite } = await import('../services/compositeRenderer')
    const crop = { x: 0, y: 620, width: 840, height: 58 }
    await renderComposite(plan(crop), SOURCES)

    // 실패하면 `quietRegion`이 고른 잔잔한 자리가 버려지고 늘 가운데가 나온다.
    expect(backgroundSource()).toEqual(crop)
  })

  it('주지 않으면 지금까지처럼 가운데를 채운다', async () => {
    const { renderComposite } = await import('../services/compositeRenderer')
    await renderComposite(plan(), SOURCES)

    const source = backgroundSource()!
    // `cover`는 가로를 다 쓰고 세로를 잘라 가운데를 남긴다.
    expect(source.width).toBeCloseTo(840, 6)
    expect(source.height).toBeLessThan(BACKGROUND.height)
    expect(source.y).toBeGreaterThan(0)
  })

  it('원본 밖으로 나가는 자리는 원본 안으로 접는다', async () => {
    const { renderComposite } = await import('../services/compositeRenderer')
    await renderComposite(plan({ x: 700, y: 1150, width: 900, height: 400 }), SOURCES)

    const source = backgroundSource()!
    expect(source.x + source.width).toBeLessThanOrEqual(BACKGROUND.width)
    expect(source.y + source.height).toBeLessThanOrEqual(BACKGROUND.height)
    expect(source.width).toBeGreaterThan(0)
    expect(source.height).toBeGreaterThan(0)
  })
})

/**
 * 배경도 옮기고 키운다 (배경 이동 Patch).
 *
 * 작업자가 이벤트 페이지 작업창과의 **유일한 차이**로 꼽은 것이다 — "차이점은
 * 배경도 위치, 크기 조절 가능한 것뿐이야." 자리를 안 주면 지금까지와 한 픽셀도
 * 달라지지 않아야 한다: 이벤트 페이지가 그 길로 다닌다.
 */
describe('§34-2 배경을 놓을 자리', () => {
  it('자리를 주면 그 자리에 놓는다', async () => {
    const { renderComposite } = await import('../services/compositeRenderer')
    const at = { x: -120, y: -30, width: 1400, height: 200 }
    await renderComposite(plan(undefined, at), SOURCES)
    expect(backgroundDest()).toEqual(at)
  })

  it('캔버스 밖으로 걸쳐도 접지 않는다', async () => {
    // 큰 배경의 한 조각만 보이는 것이 이 기능의 요점이다. 안으로 가두면 아무것도
    // 못 한다.
    const { renderComposite } = await import('../services/compositeRenderer')
    await renderComposite(plan(undefined, { x: -400, y: -400, width: 2000, height: 900 }), SOURCES)
    expect(backgroundDest()!.x).toBe(-400)
  })

  it('자리를 안 주면 지금까지처럼 캔버스를 채운다', async () => {
    // 이벤트 페이지가 다니는 길이다. 여기가 달라지면 배너를 고치려다 완성본을
    // 건드린 것이다.
    const { renderComposite } = await import('../services/compositeRenderer')
    await renderComposite(plan(), SOURCES)
    expect(backgroundDest()).toEqual({ x: 0, y: 0, width: 1020, height: 70 })
  })

  it('잘라 쓸 자리와 놓을 자리를 함께 쓴다', async () => {
    const { renderComposite } = await import('../services/compositeRenderer')
    const crop = { x: 0, y: 620, width: 840, height: 58 }
    const at = { x: 10, y: 5, width: 900, height: 60 }
    await renderComposite(plan(crop, at), SOURCES)
    expect(backgroundSource()).toEqual(crop)
    expect(backgroundDest()).toEqual(at)
  })
})
