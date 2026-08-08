/**
 * 흰 글자 가장자리의 자주색 띠 (자주색 테두리 Patch).
 *
 * 손검수에서 두 번 나온 문제다. 완성본에서 **제일 큰 문구**의 바깥이 흰색일 때,
 * 그 테두리가 깨진 것처럼 분홍/보라로 남았다. 작은 문구와 이미지 블록은 멀쩡했다.
 *
 * 원인은 둘이 겹친 것이다.
 *
 *  1. `gpt-image-2`는 투명 배경을 만들어 주지 않아, 마젠타(255,0,255) 위에 글자를
 *     그리게 하고 그 색을 지운다. 글자 가장자리는 안티앨리어싱 때문에 글자색과
 *     마젠타가 **섞인 색**이 되는데, 판정이 "지운다 / 안 지운다" 둘뿐이라 반쯤
 *     섞인 픽셀이 통째로 "안 지움"에 몰렸다.
 *  2. 흰색과 마젠타는 **빨강과 파랑이 똑같다**. 그래서 흰 글자의 가장자리는 섞여도
 *     그 두 채널이 가득 찬 채 남는다 — 남는 색이 곧 진분홍이다. 어두운 글자는
 *     세 채널이 다 달라 섞인 색이 마젠타에서 멀어지고, 남더라도 눈에 안 띈다.
 *
 * 제일 큰 문구에서만 보이는 이유는 세 번째 사실 때문이다. 문구 판은 크기와 상관
 * 없이 비슷한 픽셀 수로 생성되고 각자 제 상자로 **줄여서** 붙는다. 작은 문구는
 * 다섯 배씩 줄어 띠가 뭉개지고, 제일 큰 문구는 두 배도 안 줄어 그대로 남는다.
 * 그래서 이 검사는 "띠가 안 보인다"가 아니라 **"띠가 아예 안 생긴다"**를 본다.
 */

import { describe, it, expect } from 'vitest'
import {
  keyEdgeAlpha,
  keyOutBackground,
  unspillKeyEdges,
  KEY_EDGE_DEPTH,
  TEXT_KEY_COLOR,
} from '../domain/chromaKey'

const KEY = TEXT_KEY_COLOR

/** 마젠타와 어떤 색을 `t`만큼 섞은 픽셀 — 안티앨리어싱이 만드는 바로 그 색. */
function mixed(fg: [number, number, number], t: number): { r: number; g: number; b: number } {
  return {
    r: Math.round(fg[0] * t + KEY.r * (1 - t)),
    g: Math.round(fg[1] * t + KEY.g * (1 - t)),
    b: Math.round(fg[2] * t + KEY.b * (1 - t)),
  }
}

interface Sheet {
  data: Uint8ClampedArray
  width: number
  height: number
}

function sheet(width: number, height: number, fill: [number, number, number]): Sheet {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}

function put(s: Sheet, x: number, y: number, rgb: { r: number; g: number; b: number }): void {
  const at = (y * s.width + x) * 4
  s.data[at] = rgb.r
  s.data[at + 1] = rgb.g
  s.data[at + 2] = rgb.b
  s.data[at + 3] = 255
}

function pixel(s: Sheet, x: number, y: number): [number, number, number, number] {
  const at = (y * s.width + x) * 4
  return [s.data[at]!, s.data[at + 1]!, s.data[at + 2]!, s.data[at + 3]!]
}

describe('§26-1 섞인 정도를 안쪽 색에 견주어 잰다', () => {
  it('어떤 색이든 섞인 만큼이 그대로 나온다', () => {
    // 원래 색을 알면 나눗셈 한 번이다. 흰색만이 아니라 **색 있는 글자에서도**
    // 맞아야 한다 — 앞선 판이 무너진 자리가 여기였다.
    for (const fg of [[255, 255, 255], [0, 0, 0], [247, 120, 150], [40, 160, 220]] as [number, number, number][]) {
      for (const t of [0.25, 0.5, 0.75]) {
        const alpha = keyEdgeAlpha(mixed(fg, t), { r: fg[0], g: fg[1], b: fg[2] }, KEY)
        expect(alpha).toBeCloseTo(t, 1)
      }
    }
  })

  it('키 색 자체는 0, 안 섞인 색은 1', () => {
    expect(keyEdgeAlpha({ r: 255, g: 0, b: 255 }, { r: 255, g: 255, b: 255 }, KEY)).toBe(0)
    expect(keyEdgeAlpha({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 }, KEY)).toBe(1)
  })

  it('안쪽 색이 키 색과 구별되지 않으면 손대지 않는다', () => {
    // 나눌 수가 없다. 지어내는 대신 그대로 둔다.
    expect(keyEdgeAlpha({ r: 255, g: 10, b: 255 }, { r: 255, g: 0, b: 255 }, KEY)).toBe(1)
  })
})

describe('§26-2 지워진 자리에 맞닿은 겹만 고친다', () => {
  /**
   * 20×20 마젠타 위에 흰 사각형. 그 둘레 한 겹은 반쯤 섞인 색 — 모델이 그린
   * 안티앨리어싱을 그대로 흉내 낸 것이다.
   */
  function whiteBlockOnKey(): Sheet {
    const s = sheet(20, 20, [255, 0, 255])
    for (let y = 5; y < 15; y += 1) {
      for (let x = 5; x < 15; x += 1) put(s, x, y, { r: 255, g: 255, b: 255 })
    }
    for (let i = 4; i <= 15; i += 1) {
      for (const [x, y] of [[i, 4], [i, 15], [4, i], [15, i]] as [number, number][]) {
        put(s, x, y, mixed([255, 255, 255], 0.5))
      }
    }
    return s
  }

  it('고치기 전에는 자주색 띠가 남는다 — 이것이 화면에 보이던 것이다', () => {
    const s = whiteBlockOnKey()
    keyOutBackground(s, KEY)
    // (255,128,255): 마젠타에서 거리 128이라 허용치 110 밖 → 지워지지 않는다.
    const [r, g, b, a] = pixel(s, 10, 4)
    expect(a).toBe(255)
    expect(r).toBe(255)
    expect(b).toBe(255)
    expect(g).toBeLessThan(200)
  })

  it('고치면 그 자리가 반투명한 흰색이 된다', () => {
    const s = whiteBlockOnKey()
    keyOutBackground(s, KEY)
    const fixed = unspillKeyEdges(s, KEY)
    expect(fixed).toBeGreaterThan(0)

    const [r, g, b, a] = pixel(s, 10, 4)
    expect([r, g, b]).toEqual([255, 255, 255])
    expect(a).toBeCloseTo(128, -1)
  })

  it('색 있는 글자도 제 색으로 풀린다 — 흰색만 맞던 자리다', () => {
    /**
     * 분홍 사각형의 가장자리. 앞선 판은 원래 색을 모르는 채 풀어서 이 자리를
     * 연두색으로 만들었다. 안쪽 색을 물어보면 분홍 그대로다.
     *
     * 섞임을 0.75로 잡은 데는 이유가 있다. 분홍은 마젠타와 가까워서 반쯤 섞이면
     * 허용치 안에 들어 **지워져 버린다** — 남아서 띠가 되는 것은 더 진하게 덮인
     * 쪽뿐이다. 흰색이 유독 문제였던 까닭이 여기서도 보인다.
     */
    const pink: [number, number, number] = [247, 120, 150]
    const s = sheet(20, 20, [255, 0, 255])
    for (let y = 5; y < 15; y += 1) {
      for (let x = 5; x < 15; x += 1) put(s, x, y, { r: pink[0], g: pink[1], b: pink[2] })
    }
    for (let i = 4; i <= 15; i += 1) {
      for (const [x, y] of [[i, 4], [i, 15], [4, i], [15, i]] as [number, number][]) {
        put(s, x, y, mixed(pink, 0.75))
      }
    }
    keyOutBackground(s, KEY)
    unspillKeyEdges(s, KEY)

    const [r, g, b, a] = pixel(s, 10, 4)
    expect([r, g, b]).toEqual(pink)
    expect(a).toBeCloseTo(191, -1)
  })

  it('물어볼 안쪽이 없는 얇은 획은 그대로 둔다', () => {
    // 겹 두께보다 얇으면 전부가 가장자리다. 지어내는 대신 손대지 않는다.
    const s = sheet(9, 9, [255, 0, 255])
    for (let x = 1; x < 8; x += 1) put(s, x, 4, { r: 255, g: 255, b: 255 })
    keyOutBackground(s, KEY)
    expect(unspillKeyEdges(s, KEY)).toBe(0)
    expect(pixel(s, 4, 4)).toEqual([255, 255, 255, 255])
  })

  it('이진 판정이 잘라 버린 안티앨리어싱을 되살린다', () => {
    /**
     * 이것이 "끝처리가 딱 떨어지지 않는" 자리다.
     *
     * 살짝 덮인 가장자리(25%)는 마젠타에 가까워 **통째로 지워진다**. 그러면 알파가
     * 0 아니면 255뿐인 1비트 엣지가 남고, 그것을 상자 크기로 줄여 붙이면 글자
     * 둘레가 계단처럼 보인다 — 글자마다, 크기와 상관없이. 자주색 띠와는 다른
     * 문제이고, 띠보다 훨씬 넓은 자리를 차지한다.
     */
    const s = sheet(20, 20, [255, 0, 255])
    for (let y = 5; y < 15; y += 1) {
      for (let x = 5; x < 15; x += 1) put(s, x, y, { r: 255, g: 255, b: 255 })
    }
    for (let i = 4; i <= 15; i += 1) {
      for (const [x, y] of [[i, 4], [i, 15], [4, i], [15, i]] as [number, number][]) {
        put(s, x, y, mixed([255, 255, 255], 0.25))
      }
    }

    keyOutBackground(s, KEY)
    // 지워졌다 — 알파가 0이고, 글자 둘레는 칼로 자른 듯 딱 끊긴다.
    expect(pixel(s, 10, 4)[3]).toBe(0)

    unspillKeyEdges(s, KEY)
    // 되살아난다: 흰색에 4분의 1쯤의 투명도.
    const [r, g, b, a] = pixel(s, 10, 4)
    expect([r, g, b]).toEqual([255, 255, 255])
    expect(a).toBeGreaterThan(40)
    expect(a).toBeLessThan(90)
    // 진짜 배경은 그대로 투명하다 — 계산이 0을 주기 때문이다.
    expect(pixel(s, 0, 0)[3]).toBe(0)
    expect(pixel(s, 10, 2)[3]).toBe(0)
  })

  it('글자 속은 건드리지 않는다 — 디자인이 쓴 분홍이 살아남는다', () => {
    // 흰 사각형 한가운데에 분홍 하트를 심는다. 배경에 닿지 않으므로 원래 색
    // 그대로여야 한다. 그림 전체에 되돌리기를 걸면 이것이 흰색으로 펴진다.
    const s = whiteBlockOnKey()
    const pink = { r: 255, g: 105, b: 180 }
    for (let y = 9; y < 11; y += 1) for (let x = 9; x < 11; x += 1) put(s, x, y, pink)

    keyOutBackground(s, KEY)
    unspillKeyEdges(s, KEY)

    expect(pixel(s, 9, 9)).toEqual([255, 105, 180, 255])
    expect(pixel(s, 10, 10)).toEqual([255, 105, 180, 255])
  })

  it('정한 겹수보다 안쪽은 손대지 않는다', () => {
    const s = whiteBlockOnKey()
    keyOutBackground(s, KEY)
    unspillKeyEdges(s, KEY, 1)
    // 한 겹만 고치라고 했으므로 그 안쪽 흰색은 온전히 불투명하다.
    expect(pixel(s, 10, 5)).toEqual([255, 255, 255, 255])
    expect(KEY_EDGE_DEPTH).toBeGreaterThanOrEqual(1)
  })

  it('지워진 픽셀이 하나도 없으면 아무것도 고치지 않는다', () => {
    // 모델이 단색 배경을 통째로 무시한 경우. 여기서 가장자리를 찾아 헤매면
    // 멀쩡한 그림을 갉아먹는다.
    const s = sheet(8, 8, [10, 200, 40])
    expect(unspillKeyEdges(s, KEY)).toBe(0)
    expect(pixel(s, 4, 4)).toEqual([10, 200, 40, 255])
  })

  it('한 번 더 돌려도 더 깎이지 않는다', () => {
    // 이미 만든 완성본에 뒤늦게 적용할 수 있으려면, 두 번 걸려도 같은 그림이어야
    // 한다. 그러지 않으면 다시 합칠 때마다 글자가 조금씩 얇아진다.
    const s = whiteBlockOnKey()
    keyOutBackground(s, KEY)
    unspillKeyEdges(s, KEY)
    const once = [...s.data]
    unspillKeyEdges(s, KEY)
    expect([...s.data]).toEqual(once)
  })
})
