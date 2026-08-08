/**
 * 배너가 배경을 어디서 잘라 오고, 끝 색을 무엇으로 적는가 (배너 Patch §1).
 *
 * 배너의 배경은 새로 그리지 않는다 — 메인 이벤트 페이지의 배경을 잘라 쓴다.
 * 그래서 남는 물음이 둘이다.
 *
 *  - **어디를 자를 것인가.** 메인 배경에는 하트·풍선·반짝이가 흩어져 있고, 배너는
 *    작고 들어갈 말은 정해져 있다. 하필 무늬가 몰린 자리를 잘라 오면 가장 먼저
 *    무너지는 것이 가독성이다.
 *  - **끝 색이 무엇인가.** 얇은 띠 배너는 만든 뒤 끝부분 색을 따로 적어 내야 한다.
 *    지금은 사람이 스포이드로 찍는다.
 *
 * 둘 다 화소만 있으면 답이 나오는 일이라 여기서 붙든다. 캔버스가 없는 곳이므로
 * 화소 배열을 손으로 지어 놓고 잰다.
 */

import { describe, it, expect } from 'vitest'
import type { PixelBuffer } from '../domain/chromaKey'
import {
  QUIET_CELL,
  QUIET_ENOUGH,
  QUIET_OUTSIDE_WEIGHT,
  quietRegion,
  type QuietSlot,
} from '../domain/quietRegion'
import { EDGE_DEPTH, edgeColor, toHex } from '../domain/edgeColor'

type Paint = (x: number, y: number) => [number, number, number, number]

function make(width: number, height: number, paint: Paint): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y)
      const at = (y * width + x) * 4
      data[at] = r
      data[at + 1] = g
      data[at + 2] = b
      data[at + 3] = a
    }
  }
  return { data, width, height }
}

/** 매끈한 세로 그라디언트 — 이벤트2의 파스텔 하늘 같은 자리. */
const calm: Paint = (_x, y) => [40 + y * 2, 60 + y, 200, 255]

/** 격자무늬 — 하트·풍선처럼 윤곽이 잔뜩 있는 자리. */
function busy(amplitude: number): Paint {
  return (x, y) => {
    const on = (x + y) % 2 === 0 ? amplitude : 0
    return [on, on, on, 255]
  }
}

describe('§30-1 잔잔한 자리를 잘라 온다', () => {
  it('무늬가 몰린 쪽을 피한다', () => {
    // 위 절반은 매끈한 하늘, 아래 절반은 무늬투성이. 가로로 반쪽짜리 배너라면
    // 하늘 쪽을 잘라 와야 한다.
    const source = make(64, 64, (x, y) => (y < 32 ? calm(x, y) : busy(80)(x, y)))
    const pick = quietRegion(source, 64 / 32)

    expect(pick.rect.y).toBe(0)
    expect(pick.rect.height).toBe(32)
  })

  it('가장 크게 자른다 — 잘라 줄이면 무늬도 함께 작아진다', () => {
    // 작게 잘라 키우면 무늬만 커진다. 같은 비율이면 원본을 최대한 쓴다.
    const source = make(64, 64, calm)
    expect(quietRegion(source, 1).rect).toEqual({ x: 0, y: 0, width: 64, height: 64 })
  })

  it('목표 비율을 지키고 원본 밖으로 나가지 않는다', () => {
    // 1020×70 띠를 840×1180 메인 배경에서 잘라 오는 실제 경우.
    const source = make(210, 295, calm)
    const { rect } = quietRegion(source, 1020 / 70)

    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(source.width)
    expect(rect.y + rect.height).toBeLessThanOrEqual(source.height)
    // 비율이 어긋나면 잘라 온 것을 배너에 채울 때 늘어나거나 잘린다.
    expect(rect.width / rect.height).toBeCloseTo(1020 / 70, 0)
  })

  it('세로가 아주 얇아져도 한 줄은 남는다', () => {
    // 반올림이 0을 만들면 자를 것이 없어진다.
    const { rect } = quietRegion(make(64, 64, calm), 1000)
    expect(rect.height).toBeGreaterThanOrEqual(1)
    expect(rect.width).toBeGreaterThanOrEqual(1)
  })

  it('빈 그림에는 빈 자리를 돌려준다', () => {
    expect(quietRegion(make(0, 0, calm), 2).rect).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(quietRegion(make(8, 8, calm), 0).rect.width).toBe(0)
  })
})

describe('§30-2 얼마나 잔잔한지를 함께 말한다', () => {
  it('매끈한 곳은 낮고 무늬투성이는 높다', () => {
    // 이 값 하나로 사다리가 갈린다 — 잘라 쓸지, 흐리게 깔지, 색만 뽑아 헹굴지.
    const smooth = quietRegion(make(64, 64, calm), 1).activity
    const noisy = quietRegion(make(64, 64, busy(80)), 1).activity

    expect(smooth).toBeLessThan(QUIET_ENOUGH)
    expect(noisy).toBeGreaterThan(QUIET_ENOUGH)
  })

  it('그레인은 순위를 바꾸지 않는다', () => {
    // 그레인은 그림 전체에 고르게 얹힌다. 모든 칸에 같은 값을 더할 뿐이므로 어느
    // 자리가 더 잔잔한가는 그대로여야 한다.
    const grain = (x: number, y: number): number => ((x * 7 + y * 13) % 5) - 2
    const plain = make(64, 64, (x, y) => (y < 32 ? calm(x, y) : busy(80)(x, y)))
    const grainy = make(64, 64, (x, y) => {
      const [r, g, b, a] = y < 32 ? calm(x, y) : busy(80)(x, y)
      const n = grain(x, y)
      return [r + n, g + n, b + n, a]
    })

    expect(quietRegion(grainy, 64 / 32).rect.y).toBe(quietRegion(plain, 64 / 32).rect.y)
  })
})

describe('§30-3 글자가 놓일 자리를 먼저 본다', () => {
  /**
   * 아래쪽에 심한 무늬가, 위쪽에 옅은 무늬가 깔린 그림.
   *
   * 전체로 보면 위쪽이 잔잔하다. 그런데 글자가 창의 **아래 절반**에 놓인다면,
   * 위쪽을 잘라 오면 글자가 옅은 무늬 위에 앉고 아래쪽을 잘라 오면 아무것도 없는
   * 자리에 앉는다. 후자가 읽기 좋다.
   */
  function layered(): PixelBuffer {
    return make(64, 64, (x, y) => {
      if (y < 32) return busy(12)(x, y)
      if (y < 48) return busy(30)(x, y)
      return [230, 230, 240, 255]
    })
  }

  const bottomHalf: QuietSlot[] = [{ x: 0, y: 0.5, width: 1, height: 0.5 }]

  it('슬롯이 없으면 전체가 가장 잔잔한 자리를 고른다', () => {
    expect(quietRegion(layered(), 64 / 32).rect.y).toBe(0)
  })

  it('슬롯이 있으면 글자 밑이 잔잔한 자리를 고른다', () => {
    // 실패하면 전체로는 얌전한데 하필 글자 뒤에 무늬가 오는 배너가 나온다.
    const pick = quietRegion(layered(), 64 / 32, { slots: bottomHalf, outsideWeight: 0 })
    expect(pick.rect.y).toBe(32)
  })

  it('슬롯 바깥을 얼마나 볼지가 손잡이다', () => {
    // 글자 밑만 보면 배너 한 장이 통째로 어지러워도 개의치 않는다. 반대로 바깥만
    // 보면 슬롯이 없는 것과 같다. 그 두 끝 사이를 고르는 값이므로, 양쪽 끝에서
    // 각각 그 답이 나오는지를 붙든다.
    expect(QUIET_OUTSIDE_WEIGHT).toBeGreaterThan(0)
    const noSlot = quietRegion(layered(), 64 / 32).rect.y
    expect(quietRegion(layered(), 64 / 32, { slots: bottomHalf, outsideWeight: 0 }).rect.y).toBe(32)
    expect(quietRegion(layered(), 64 / 32, { slots: bottomHalf, outsideWeight: 1000 }).rect.y).toBe(noSlot)
  })

  it('칸 크기를 바꿔도 같은 쪽을 고른다', () => {
    // 칸은 속도를 위한 것이지 답을 정하는 것이 아니다.
    const source = make(64, 64, (x, y) => (y < 32 ? calm(x, y) : busy(80)(x, y)))
    expect(quietRegion(source, 64 / 32, { cell: QUIET_CELL / 2 }).rect.y).toBe(0)
    expect(quietRegion(source, 64 / 32, { cell: QUIET_CELL * 2 }).rect.y).toBe(0)
  })
})

describe('§30-4 끝단 색을 읽는다', () => {
  const NAVY: [number, number, number, number] = [0x35, 0x41, 0x51, 255]

  it('한쪽 끝의 색을 16진수로 준다', () => {
    // 사람이 스포이드로 찍어 적던 값이다. 대문자 `#RRGGBB`로 적는다.
    const banner = make(40, 10, (x) => (x >= 40 - EDGE_DEPTH ? NAVY : [255, 255, 255, 255]))
    expect(edgeColor(banner, 'right')).toBe('#354151')
  })

  it('끝줄에 걸린 조각 하나에 흔들리지 않는다', () => {
    // 로고나 테두리 한 획이 끝줄에 닿아 있을 수 있다. 평균이면 그쪽으로 끌려간다.
    const banner = make(40, 32, (x, y) => {
      if (x < 40 - EDGE_DEPTH) return [255, 255, 255, 255]
      return y < 4 ? [255, 0, 0, 255] : NAVY
    })
    expect(edgeColor(banner, 'right')).toBe('#354151')
  })

  it('투명한 화소는 세지 않는다', () => {
    // 세면 있지도 않은 색이 답에 섞인다.
    const banner = make(40, 32, (x, y) => {
      if (x < 40 - EDGE_DEPTH) return [255, 255, 255, 255]
      return y < 16 ? [255, 0, 0, 0] : NAVY
    })
    expect(edgeColor(banner, 'right')).toBe('#354151')
  })

  it('읽을 것이 없으면 모른다고 한다', () => {
    // 검정을 지어내면 받는 사람이 그 값을 믿고 배경에 칠한다.
    expect(edgeColor(make(10, 10, () => [0, 0, 0, 0]), 'left')).toBeNull()
    expect(edgeColor(make(0, 0, () => [0, 0, 0, 255]), 'left')).toBeNull()
  })

  it('네 방향을 각각 읽는다', () => {
    const banner = make(16, 16, (_x, y) => (y < EDGE_DEPTH ? [10, 20, 30, 255] : NAVY))
    expect(edgeColor(banner, 'top')).toBe('#0A141E')
    expect(edgeColor(banner, 'bottom')).toBe('#354151')
  })

  it('색 하나를 16진수로 적는다', () => {
    expect(toHex({ r: 0, g: 255, b: 16 })).toBe('#00FF10')
    // 범위를 벗어난 값이 그대로 흘러 나가면 세 자리짜리 코드가 나온다.
    expect(toHex({ r: -20, g: 300, b: 127.6 })).toBe('#00FF80')
  })
})
