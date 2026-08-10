/**
 * 버튼이 깜빡이는 두 번째 프레임 (깜빡이는 버튼 Patch).
 *
 * 작업자가 보여 준 예는 같은 버튼의 진한 보라 ↔ 연한 라벤더였고, **글자는 흰색
 * 그대로**였다. 그리고 "버튼마다 디자인은 천차만별 색상도 천차만별"이므로 색을
 * 지정할 수 없다 — 그 색을 흔들 뿐이다.
 *
 * 여기서 붙드는 것은 셋이다. **글자와 아이콘이 그대로인가**(안 그러면 흰 글자가
 * 회색이 된다), **방향이 자동인가**(밝은 버튼을 더 밝히면 글자가 사라진다),
 * **원본을 건드리지 않는가**(건드리면 두 프레임이 같아져 안 깜빡인다).
 */

import { describe, it, expect } from 'vitest'
import { blinkFrame, blinkGoesBrighter, bodyLuma, BLINK_KEEP_GAP } from '../domain/buttonBlink'

type Rgb = [number, number, number]

/**
 * 몸통 색 위에 글자 몇 픽셀.
 *
 * 실제 버튼이 그렇듯 **몸통이 면적의 대부분**이다. 글자 색은 따로 준다 — 어두운
 * 버튼에는 흰 글자, 연한 버튼에는 어두운 글자가 실제 디자인이다.
 */
function button(body: Rgb, text: Rgb = [255, 255, 255], textPixels = 4): {
  data: Uint8ClampedArray
  width: number
  height: number
} {
  const width = 8
  const height = 4
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const rgb = i < textPixels ? text : body
    data[i * 4] = rgb[0]
    data[i * 4 + 1] = rgb[1]
    data[i * 4 + 2] = rgb[2]
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}

const WHITE: Rgb = [255, 255, 255]
const INK: Rgb = [30, 30, 40]

const at = (data: Uint8ClampedArray, i: number) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]

describe('§39-1 흔드는 방향', () => {
  it('어두운 버튼은 밝힌다', () => {
    expect(blinkGoesBrighter(button([60, 30, 120]))).toBe(true)
  })

  it('밝은 버튼은 어둡게 한다', () => {
    // 반대로 하면 흰 글자가 묻힌다.
    // 연한 버튼에는 어두운 글자가 실제 디자인이다.
    expect(blinkGoesBrighter(button([230, 225, 240], INK))).toBe(false)
  })

  it('흰 글자가 많아도 방향이 뒤집히지 않는다', () => {
    // 32칸 중 13칸이 흰 글자면 **평균은 131**이라 "밝은 버튼"으로 읽히고 방향이
    // 뒤집힌다. 최빈값은 몸통을 그대로 가리킨다.
    expect(blinkGoesBrighter(button([60, 30, 120], WHITE, 13))).toBe(true)
  })

  it('몸통 밝기는 글자에 끌려가지 않는다', () => {
    // 몸통 [60,30,120]의 밝기는 50 언저리다.
    expect(bodyLuma(button([60, 30, 120], WHITE, 13))).toBeLessThan(80)
  })

  it('빈 자리는 세지 않는다', () => {
    const empty = { data: new Uint8ClampedArray(4 * 4), width: 2, height: 2 }
    expect(blinkGoesBrighter(empty)).toBe(true)
  })
})

describe('§39-2 두 번째 프레임', () => {
  const dark = button([60, 30, 120])

  it('몸통이 밝아진다', () => {
    const next = blinkFrame(dark, 0.3)
    const [r, g, b] = at(next, 10)
    expect(r).toBeGreaterThan(60)
    expect(g).toBeGreaterThan(30)
    expect(b).toBeGreaterThan(120)
  })

  it('글자는 그대로다 — 어느 쪽으로 밀든', () => {
    // 샘플에서 글자는 두 프레임 모두 흰색이었다. 어둡게 미는 쪽에서도 글자가
    // 회색이 되면 안 된다.
    expect(at(blinkFrame(dark, 0.3), 0)).toEqual([255, 255, 255])
    const light = button([230, 225, 240], INK)
    expect(at(blinkFrame(light, 0.3), 0)).toEqual(INK)
  })

  it('연한 버튼도 몸통은 움직인다', () => {
    // "밝기 200 위는 글자"로 잡았을 때 연한 버튼이 통째로 글자로 읽혀 아무것도
    // 안 움직였다. 그 결함을 잡는 검사다.
    const light = button([230, 225, 240], INK)
    expect(at(blinkFrame(light, 0.3), 10)[0]!).toBeLessThan(230)
  })

  it('밝은 아이콘도 그대로다', () => {
    // `▶`나 `>` 같은 커서가 흰 글자와 같이 남아야 샘플과 같은 모양이 된다.
    const withIcon = button([60, 30, 120], WHITE, 0)
    const bright = Math.round(bodyLuma(withIcon) + BLINK_KEEP_GAP + 40)
    withIcon.data[20] = bright
    withIcon.data[21] = bright
    withIcon.data[22] = bright
    expect(at(blinkFrame(withIcon, 0.4), 5)).toEqual(at(withIcon.data, 5))
  })

  it('빈 자리는 건드리지 않는다', () => {
    const clear = { data: new Uint8ClampedArray(16), width: 2, height: 2 }
    expect([...blinkFrame(clear, 0.5)]).toEqual([...clear.data])
  })

  it('원본을 고치지 않는다', () => {
    // 고치면 두 프레임이 같아져 아무것도 깜빡이지 않는다.
    const before = [...dark.data]
    blinkFrame(dark, 0.4)
    expect([...dark.data]).toEqual(before)
  })

  it('세기가 0이면 아무것도 바뀌지 않는다', () => {
    expect([...blinkFrame(dark, 0)]).toEqual([...dark.data])
  })

  it('세기를 올리면 더 많이 움직인다', () => {
    const small = at(blinkFrame(dark, 0.1), 10)[0]!
    const big = at(blinkFrame(dark, 0.5), 10)[0]!
    expect(big).toBeGreaterThan(small)
  })

  it('아무리 밀어도 넘치지 않는다', () => {
    for (const next of [blinkFrame(dark, 1), blinkFrame(button([230, 225, 240], INK), 1)]) {
      for (const value of next) expect(value).toBeGreaterThanOrEqual(0)
      for (const value of next) expect(value).toBeLessThanOrEqual(255)
    }
  })
})
