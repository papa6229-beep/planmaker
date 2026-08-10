/**
 * GIF 한 장 짜기 (깜빡이는 버튼 Patch).
 *
 * 쇼핑몰이 요구하는 것은 **1초마다 색이 바뀌는 CTA 버튼**이고, 올리는 것은 통이미지
 * 한 장이다. 그러니 이벤트 페이지 전체가 GIF가 되어야 한다 — 버튼만 잘라 낸 작은
 * GIF는 얹을 자리가 없다.
 *
 * 라이브러리를 들이지 않는다. GIF는 형식이 단순하고, 여기서 필요한 것은 그중에서도
 * 가장 좁은 갈래다: 프레임 둘, 각자 제 팔레트, 무한 반복.
 *
 * ## 화질을 어디서 잃는가
 *
 * GIF는 **한 프레임에 256색**뿐이고 반투명이 없다. 파스텔 그라데이션이 깔린
 * 완성본에서는 띠가 생긴다. 그것을 감수하기로 했으므로, 대신 잃는 양을 줄인다.
 *
 *  - 팔레트를 **그 그림에서 직접 뽑는다**(중앙값 자르기). 고정 팔레트를 쓰면 파스텔
 *    한 계열에 쓸 수 있는 색이 몇 개 안 남는다.
 *  - **오차 확산**으로 흩뿌린다. 띠 대신 잔모래가 되는데, 그라데이션에서는 그쪽이
 *    눈에 훨씬 덜 거슬린다.
 *  - 두 프레임이 **버튼 자리 빼고 똑같으므로**, 둘째 프레임은 바뀐 사각형만 담는다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다 — 픽셀을 받아 바이트를 돌려줄 뿐이다.
 */

export interface GifFrame {
  /** RGBA 픽셀. `width * height * 4`. */
  data: Uint8ClampedArray
  width: number
  height: number
  /** 화면 안에서 이 프레임이 놓이는 자리. 부분 프레임이면 0이 아니다. */
  left: number
  top: number
  /** 이 프레임을 몇 백분의 1초 동안 보여 주는가. */
  delayCs: number
}

export const GIF_MAX_COLORS = 256

/** 색 하나를 24비트 정수로. 같은 색을 세는 열쇠다. */
function keyOf(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b
}

interface Box {
  colors: number[]
  counts: number[]
}

/** 이 상자에서 가장 넓게 퍼진 축 — 그 축의 가운데에서 자른다. */
function widestAxis(box: Box): 0 | 1 | 2 {
  let lo = [255, 255, 255]
  let hi = [0, 0, 0]
  for (const color of box.colors) {
    const rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255]
    lo = lo.map((v, i) => Math.min(v, rgb[i]!))
    hi = hi.map((v, i) => Math.max(v, rgb[i]!))
  }
  const span = hi.map((v, i) => v - lo[i]!)
  const max = Math.max(span[0]!, span[1]!, span[2]!)
  return span[0] === max ? 0 : span[1] === max ? 1 : 2
}

/**
 * 그림에서 팔레트를 뽑는다 (중앙값 자르기).
 *
 * 색이 많이 쓰인 쪽을 먼저 쪼갠다. 배경이 지면의 대부분이면 배경 계열에 색이 많이
 * 가고, 그래야 그라데이션의 띠가 줄어든다.
 */
export function buildPalette(data: Uint8ClampedArray, limit = GIF_MAX_COLORS): number[] {
  const tally = new Map<number, number>()
  for (let i = 0; i < data.length; i += 4) {
    const key = keyOf(data[i]!, data[i + 1]!, data[i + 2]!)
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  const colors = [...tally.keys()]
  if (colors.length <= limit) return colors

  let boxes: Box[] = [{ colors, counts: colors.map((c) => tally.get(c)!) }]
  while (boxes.length < limit) {
    // 픽셀을 가장 많이 담은 상자부터 쪼갠다. 색 가짓수가 아니라 넓이 기준이다.
    let pick = -1
    let most = 0
    for (const [index, box] of boxes.entries()) {
      if (box.colors.length < 2) continue
      const weight = box.counts.reduce((sum, n) => sum + n, 0)
      if (weight > most) {
        most = weight
        pick = index
      }
    }
    if (pick === -1) break
    const box = boxes[pick]!
    const axis = widestAxis(box)
    const shift = axis === 0 ? 16 : axis === 1 ? 8 : 0
    const order = box.colors
      .map((c, i) => ({ c, n: box.counts[i]! }))
      .sort((a, b) => ((a.c >> shift) & 255) - ((b.c >> shift) & 255))
    const half = Math.max(1, Math.floor(order.length / 2))
    boxes = [
      ...boxes.slice(0, pick),
      { colors: order.slice(0, half).map((o) => o.c), counts: order.slice(0, half).map((o) => o.n) },
      { colors: order.slice(half).map((o) => o.c), counts: order.slice(half).map((o) => o.n) },
      ...boxes.slice(pick + 1),
    ]
  }

  // 상자마다 **픽셀 수로 가중한 평균**. 가운데를 쓰면 거의 안 쓰인 극단 색이 상자를
  // 끌어당겨, 실제로 넓은 면적의 색이 어긋난다.
  return boxes.map((box) => {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (const [i, color] of box.colors.entries()) {
      const weight = box.counts[i]!
      r += ((color >> 16) & 255) * weight
      g += ((color >> 8) & 255) * weight
      b += (color & 255) * weight
      n += weight
    }
    return n === 0 ? 0 : keyOf(Math.round(r / n), Math.round(g / n), Math.round(b / n))
  })
}

/** 가장 가까운 팔레트 색의 번호. 찾은 답은 5비트 격자로 기억해 둔다. */
function nearest(palette: readonly number[], cache: Int16Array, r: number, g: number, b: number): number {
  const slot = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
  const known = cache[slot]!
  if (known >= 0) return known
  let best = 0
  let bestGap = Infinity
  for (const [index, color] of palette.entries()) {
    const dr = ((color >> 16) & 255) - r
    const dg = ((color >> 8) & 255) - g
    const db = (color & 255) - b
    const gap = dr * dr + dg * dg + db * db
    if (gap < bestGap) {
      best = index
      bestGap = gap
      if (gap === 0) break
    }
  }
  cache[slot] = best
  return best
}

/**
 * 픽셀을 팔레트 번호로 옮긴다 — 오차를 옆으로 흩뿌리면서 (Floyd–Steinberg).
 *
 * 흩뿌리지 않으면 파스텔 그라데이션이 굵은 띠가 된다. 흩뿌리면 잔모래가 되는데,
 * 같은 정보를 잃고도 눈에 훨씬 덜 거슬린다.
 */
export function quantize(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  palette: readonly number[],
): Uint8Array {
  const out = new Uint8Array(width * height)
  const cache = new Int16Array(32768).fill(-1)
  // 오차는 소수로 쌓이므로 원본을 건드리지 않고 따로 둔다.
  const buf = new Float32Array(width * height * 3)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    buf[j] = data[i]!
    buf[j + 1] = data[i + 1]!
    buf[j + 2] = data[i + 2]!
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 3
      const r = Math.max(0, Math.min(255, Math.round(buf[p]!)))
      const g = Math.max(0, Math.min(255, Math.round(buf[p + 1]!)))
      const b = Math.max(0, Math.min(255, Math.round(buf[p + 2]!)))
      const index = nearest(palette, cache, r, g, b)
      out[y * width + x] = index
      const color = palette[index]!
      const err = [r - ((color >> 16) & 255), g - ((color >> 8) & 255), b - (color & 255)]
      // 오른쪽 7/16, 왼쪽아래 3/16, 아래 5/16, 오른쪽아래 1/16.
      const spread = (dx: number, dy: number, factor: number) => {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny >= height) return
        const q = (ny * width + nx) * 3
        buf[q] = buf[q]! + err[0]! * factor
        buf[q + 1] = buf[q + 1]! + err[1]! * factor
        buf[q + 2] = buf[q + 2]! + err[2]! * factor
      }
      spread(1, 0, 7 / 16)
      spread(-1, 1, 3 / 16)
      spread(0, 1, 5 / 16)
      spread(1, 1, 1 / 16)
    }
  }
  return out
}

/** 팔레트 길이를 2의 거듭제곱으로 올린 지수 — GIF가 이 값을 요구한다. */
function tableExponent(size: number): number {
  let bits = 1
  while (1 << bits < size) bits += 1
  return Math.max(1, Math.min(8, bits))
}

/**
 * 자라나는 바이트 통.
 *
 * 배열을 `push(...arr)`로 이어 붙이면 **큰 그림에서 스택이 터진다** — 840×1107
 * 완성본의 부호는 수십만 바이트이고, 그것을 인자로 펼치는 순간 끝이다. 작은 검사
 * 그림에서는 걸리지 않아 실물에서만 드러났다. 그래서 통에 한 바이트씩 넣는다.
 */
class Bytes {
  private buf = new Uint8Array(1024)
  private len = 0

  push(...values: number[]): void {
    for (const value of values) {
      if (this.len === this.buf.length) {
        const bigger = new Uint8Array(this.buf.length * 2)
        bigger.set(this.buf)
        this.buf = bigger
      }
      this.buf[this.len] = value
      this.len += 1
    }
  }

  get length(): number {
    return this.len
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

/** GIF의 LZW. 부호 길이가 자라고, 사전이 차면 비운다. */
function lzw(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize
  const end = clear + 1
  let dict = new Map<string, number>()
  let next = end + 1
  let codeSize = minCodeSize + 1

  const out = new Bytes()
  let bits = 0
  let acc = 0
  const emit = (code: number) => {
    acc |= code << bits
    bits += codeSize
    while (bits >= 8) {
      out.push(acc & 255)
      acc >>= 8
      bits -= 8
    }
  }
  const reset = () => {
    dict = new Map()
    next = end + 1
    codeSize = minCodeSize + 1
  }

  emit(clear)
  reset()
  let run = String(indices[0] ?? 0)
  for (let i = 1; i < indices.length; i += 1) {
    const ch = String(indices[i]!)
    const joined = `${run},${ch}`
    if (dict.has(joined)) {
      run = joined
      continue
    }
    emit(run.includes(',') ? dict.get(run)! : Number(run))
    if (next < 4096) {
      dict.set(joined, next)
      next += 1
      if (next - 1 === (1 << codeSize) && codeSize < 12) codeSize += 1
    } else {
      emit(clear)
      reset()
    }
    run = ch
  }
  if (indices.length > 0) emit(run.includes(',') ? dict.get(run)! : Number(run))
  emit(end)
  if (bits > 0) out.push(acc & 255)
  return out.done()
}

/** 255바이트씩 끊어 담는 GIF의 자료 덩어리. */
function writeSubBlocks(out: Bytes, bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i += 255) {
    const size = Math.min(255, bytes.length - i)
    out.push(size)
    for (let j = 0; j < size; j += 1) out.push(bytes[i + j]!)
  }
  out.push(0)
}

/**
 * 프레임들을 GIF 한 장으로.
 *
 * 프레임마다 **제 팔레트**를 준다(지역 색표). 하나의 전역 팔레트를 나눠 쓰면, 버튼만
 * 바뀌는 둘째 프레임 때문에 배경의 색 몫이 줄어든다.
 */
export function encodeGif(
  size: { width: number; height: number },
  frames: readonly GifFrame[],
): Uint8Array {
  const bytes = new Bytes()
  const push16 = (n: number) => bytes.push(n & 255, (n >> 8) & 255)

  for (const ch of 'GIF89a') bytes.push(ch.charCodeAt(0))
  push16(size.width)
  push16(size.height)
  // 전역 색표 없음, 색 깊이 8비트.
  bytes.push(0b0111_0000, 0, 0)

  // 무한 반복. 이 확장이 없으면 브라우저가 한 번 돌고 멈춘다.
  bytes.push(0x21, 0xff, 11)
  for (const ch of 'NETSCAPE2.0') bytes.push(ch.charCodeAt(0))
  bytes.push(3, 1, 0, 0, 0)

  for (const frame of frames) {
    const palette = buildPalette(frame.data)
    const indices = quantize(frame.data, frame.width, frame.height, palette)

    // 그림 제어: 앞 프레임을 지우지 않고 그 위에 덮는다(폐기 방식 1). 둘째 프레임이
    // 버튼 자리만 담을 수 있는 것이 이 덕이다.
    bytes.push(0x21, 0xf9, 4, 0b0000_0100)
    push16(Math.max(1, Math.round(frame.delayCs)))
    bytes.push(0, 0)

    bytes.push(0x2c)
    push16(frame.left)
    push16(frame.top)
    push16(frame.width)
    push16(frame.height)
    const exponent = tableExponent(palette.length)
    // 지역 색표 있음, 크기 지수.
    bytes.push(0b1000_0000 | (exponent - 1))
    const entries = 1 << exponent
    for (let i = 0; i < entries; i += 1) {
      const color = palette[i] ?? 0
      bytes.push((color >> 16) & 255, (color >> 8) & 255, color & 255)
    }

    // 최소 부호 길이는 2보다 작을 수 없다 — 색이 둘뿐인 프레임도 마찬가지다.
    const minCodeSize = Math.max(2, exponent)
    bytes.push(minCodeSize)
    writeSubBlocks(bytes, lzw(indices, minCodeSize))
  }

  bytes.push(0x3b)
  return bytes.done()
}
