/**
 * GIF를 직접 짠다 (깜빡이는 버튼 Patch).
 *
 * 라이브러리를 들이지 않았으므로, 나온 바이트가 정말 GIF인지는 **다시 읽어 확인해야**
 * 안다. 그림이 보이는지는 눈으로 보면 되지만 — 눈으로 볼 수 없는 것이 셋 있다:
 * 무한 반복 표시, 프레임의 지연 시간, 그리고 둘째 프레임이 정말 버튼 자리만 담았는가.
 * 셋 다 틀려도 화면에서는 그럴듯해 보인다(한 번 돌고 멈추거나, 너무 빨리 깜빡이거나,
 * 파일이 두 배거나). 그래서 여기서 바이트를 뜯는다.
 */

import { describe, it, expect } from 'vitest'
import { buildPalette, encodeGif, quantize, GIF_MAX_COLORS, type GifFrame } from '../domain/gifEncode'

/** 단색 사각형. */
function solid(width: number, height: number, rgb: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
    data[i + 3] = 255
  }
  return data
}

/** 가로 그라데이션 — 팔레트가 어디에 색을 쓰는지 보려고. */
function ramp(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const v = Math.round((x / Math.max(1, width - 1)) * 255)
      data[i] = v
      data[i + 1] = 255 - v
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }
  return data
}

const frame = (over: Partial<GifFrame> = {}): GifFrame => ({
  data: solid(4, 4, [10, 20, 30]),
  width: 4,
  height: 4,
  left: 0,
  top: 0,
  delayCs: 100,
  ...over,
})

/** 바이트에서 그 부분 배열이 처음 나오는 자리. */
function indexOf(bytes: Uint8Array, needle: readonly number[]): number {
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (const [j, want] of needle.entries()) if (bytes[i + j] !== want) continue outer
    return i
  }
  return -1
}

/** 그림 서술자(0x2C)들의 자리 — 프레임 수와 각자의 사각형이 여기 있다. */
function imageDescriptors(bytes: Uint8Array): { left: number; top: number; width: number; height: number }[] {
  const found: { left: number; top: number; width: number; height: number }[] = []
  const read16 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8)
  // 그림 서술자는 언제나 그림 제어 확장(0x21 0xF9 0x04) 여덟 바이트 뒤에 온다.
  for (let i = 0; i + 18 < bytes.length; i += 1) {
    if (bytes[i] !== 0x21 || bytes[i + 1] !== 0xf9 || bytes[i + 2] !== 4) continue
    const at = i + 8
    if (bytes[at] !== 0x2c) continue
    found.push({ left: read16(at + 1), top: read16(at + 3), width: read16(at + 5), height: read16(at + 7) })
  }
  return found
}

describe('§38-1 GIF의 뼈대', () => {
  const bytes = encodeGif({ width: 4, height: 4 }, [frame(), frame({ data: solid(2, 2, [200, 40, 40]), width: 2, height: 2, left: 1, top: 1 })])

  it('GIF89a로 시작하고 0x3B로 끝난다', () => {
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a')
    expect(bytes.at(-1)).toBe(0x3b)
  })

  it('화면 크기가 머리에 적힌다', () => {
    expect(bytes[6]! | (bytes[7]! << 8)).toBe(4)
    expect(bytes[8]! | (bytes[9]! << 8)).toBe(4)
  })

  it('무한 반복이라고 적는다', () => {
    // 이것이 없으면 브라우저가 한 번 돌고 멈춘다 — 화면에서는 "안 깜빡인다"로 보인다.
    const at = indexOf(bytes, [...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)))
    expect(at).toBeGreaterThan(0)
    // 뒤따르는 블록: 길이 3, 부호 1, 반복 횟수 0(무한).
    expect([...bytes.subarray(at + 11, at + 16)]).toEqual([3, 1, 0, 0, 0])
  })

  it('프레임마다 1초를 준다', () => {
    let seen = 0
    for (let i = 0; i + 6 < bytes.length; i += 1) {
      if (bytes[i] !== 0x21 || bytes[i + 1] !== 0xf9 || bytes[i + 2] !== 4) continue
      expect(bytes[i + 4]! | (bytes[i + 5]! << 8)).toBe(100)
      seen += 1
    }
    expect(seen).toBe(2)
  })

  it('둘째 프레임은 준 자리만 담는다', () => {
    // 통짜로 두 번 담으면 파일이 두 배가 된다.
    const boxes = imageDescriptors(bytes)
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).toEqual({ left: 0, top: 0, width: 4, height: 4 })
    expect(boxes[1]).toEqual({ left: 1, top: 1, width: 2, height: 2 })
  })

  it('부분 프레임이 앞 프레임을 지우지 않는다', () => {
    // 폐기 방식이 "배경으로 되돌리기"면 버튼 자리만 남고 나머지가 사라진다.
    for (let i = 0; i + 3 < bytes.length; i += 1) {
      if (bytes[i] !== 0x21 || bytes[i + 1] !== 0xf9 || bytes[i + 2] !== 4) continue
      expect((bytes[i + 3]! >> 2) & 0b111).toBe(1)
    }
  })
})

/**
 * LZW를 되읽는다.
 *
 * 여기가 이 모듈에서 유일하게 **틀려도 그럴듯해 보이는** 자리다. 부호 길이를 한
 * 박자 늦게 올리거나 사전을 늦게 비우면, 뷰어에 따라 열리기도 하고 색이 밀린 채로
 * 열리기도 한다. 그래서 눈이 아니라 되읽기로 확인한다.
 */
function decodeFirstFrame(bytes: Uint8Array): { indices: number[]; palette: number[] } {
  const read16 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8)
  let at = -1
  for (let i = 0; i + 10 < bytes.length; i += 1) {
    if (bytes[i] === 0x2c) {
      at = i
      break
    }
  }
  if (at === -1) throw new Error('no image descriptor')
  const width = read16(at + 5)
  const height = read16(at + 7)
  const packed = bytes[at + 9]!
  const entries = 1 << ((packed & 0b111) + 1)
  let p = at + 10
  const palette: number[] = []
  for (let i = 0; i < entries; i += 1, p += 3) {
    palette.push((bytes[p]! << 16) | (bytes[p + 1]! << 8) | bytes[p + 2]!)
  }
  const minCodeSize = bytes[p]!
  p += 1
  const data: number[] = []
  for (;;) {
    const len = bytes[p]!
    p += 1
    if (len === 0) break
    for (let i = 0; i < len; i += 1) data.push(bytes[p + i]!)
    p += len
  }

  const clear = 1 << minCodeSize
  const end = clear + 1
  let codeSize = minCodeSize + 1
  let dict: number[][] = []
  const reset = () => {
    dict = []
    for (let i = 0; i < clear; i += 1) dict.push([i])
    dict.push([], [])
    codeSize = minCodeSize + 1
  }
  reset()

  const indices: number[] = []
  let bitPos = 0
  let previous: number[] | null = null
  const nextCode = (): number | null => {
    let value = 0
    for (let i = 0; i < codeSize; i += 1) {
      const byte = data[(bitPos >> 3)]
      if (byte === undefined) return null
      value |= ((byte >> (bitPos & 7)) & 1) << i
      bitPos += 1
    }
    return value
  }
  for (;;) {
    const code = nextCode()
    if (code === null || code === end) break
    if (code === clear) {
      reset()
      previous = null
      continue
    }
    let entry: number[]
    if (code < dict.length && dict[code]!.length > 0) entry = dict[code]!
    else if (previous !== null) entry = [...previous, previous[0]!]
    else throw new Error('bad code')
    indices.push(...entry)
    if (previous !== null) {
      dict.push([...previous, entry[0]!])
      // 되읽는 쪽은 사전이 한 칸 뒤처져 있다 — 방금 채운 길이가 지금 폭의 한계에
      // 닿으면 그때 넓힌다. 여기를 한 칸 어긋내면 뒤쪽 부호를 통째로 잘못 읽는다.
      if (dict.length === (1 << codeSize) && codeSize < 12) codeSize += 1
    }
    previous = entry
  }
  expect(indices).toHaveLength(width * height)
  return { indices, palette }
}

describe('§38-3 짠 것을 되읽는다', () => {
  it('단색 그림이 그 색 하나로 돌아온다', () => {
    const bytes = encodeGif({ width: 8, height: 8 }, [frame({ data: solid(8, 8, [17, 34, 51]), width: 8, height: 8 })])
    const { indices, palette } = decodeFirstFrame(bytes)
    expect(new Set(indices).size).toBe(1)
    expect(palette[indices[0]!]).toBe((17 << 16) | (34 << 8) | 51)
  })

  it('무늬가 자리마다 그대로 돌아온다', () => {
    // 부호 길이를 한 박자 늦게 올리면 여기서 색이 밀린다.
    const width = 24
    const height = 6
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i += 1) {
      const on = (i % 5 === 0)
      data[i * 4] = on ? 240 : 12
      data[i * 4 + 1] = on ? 240 : 12
      data[i * 4 + 2] = on ? 240 : 12
      data[i * 4 + 3] = 255
    }
    const bytes = encodeGif({ width, height }, [frame({ data, width, height })])
    const { indices, palette } = decodeFirstFrame(bytes)
    for (let i = 0; i < width * height; i += 1) {
      const want = data[i * 4]! > 128
      expect(((palette[indices[i]!]! >> 16) & 255) > 128).toBe(want)
    }
  })

  it('긴 그라데이션도 길이가 맞는다', () => {
    // 사전이 가득 찼을 때 비우는 자리 — 여기서 어긋나면 뒤쪽이 통째로 밀린다.
    const width = 200
    const height = 40
    const bytes = encodeGif({ width, height }, [frame({ data: ramp(width, height), width, height })])
    expect(decodeFirstFrame(bytes).indices).toHaveLength(width * height)
  })
})

describe('§38-2 팔레트와 오차 확산', () => {
  it('색이 적으면 그대로 담는다', () => {
    expect(buildPalette(solid(8, 8, [1, 2, 3]))).toEqual([(1 << 16) | (2 << 8) | 3])
  })

  it('256색을 넘기지 않는다', () => {
    const palette = buildPalette(ramp(600, 4))
    expect(palette.length).toBeLessThanOrEqual(GIF_MAX_COLORS)
    expect(palette.length).toBeGreaterThan(1)
  })

  it('모든 픽셀이 팔레트 안의 번호를 받는다', () => {
    const width = 40
    const height = 8
    const data = ramp(width, height)
    const palette = buildPalette(data, 16)
    const indices = quantize(data, width, height, palette)
    expect(indices).toHaveLength(width * height)
    for (const index of indices) expect(index).toBeLessThan(palette.length)
  })

  it('그라데이션을 한 색으로 뭉개지 않는다', () => {
    // 실패하면 파스텔 배경이 통짜 색면이 된다.
    const data = ramp(64, 4)
    const palette = buildPalette(data, 16)
    const used = new Set(quantize(data, 64, 4, palette))
    expect(used.size).toBeGreaterThan(4)
  })

  it('단색은 오차를 뿌려도 단색이다', () => {
    // 오차 확산이 없는 자리에서 잔모래를 만들면, 평평한 바탕이 지저분해진다.
    const data = solid(16, 16, [200, 100, 50])
    const palette = buildPalette(data)
    expect(new Set(quantize(data, 16, 16, palette)).size).toBe(1)
  })
})
