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

function plan(crop?: { x: number; y: number; width: number; height: number }): CompositePlan {
  return {
    size: { width: 1020, height: 70 },
    background: { assetId: 'bg', source: 'ai' },
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
function backgroundSource(): { x: number; y: number; width: number; height: number } | null {
  const nine = drawn.args.find((a) => a.length >= 8)
  if (nine === undefined) return null
  return { x: nine[0]!, y: nine[1]!, width: nine[2]!, height: nine[3]! }
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
