/**
 * 종이 컷아웃 외곽선 (Studio Patch §3).
 *
 * 오려 낸 종이 위에 사진이 붙어 있는 모양을 만든다. AI가 그림을 다시 그리거나
 * 해석하지 않는다 — 여기서 하는 일은 **PNG의 알파 경계를 밖으로 넓히는 것**
 * 하나뿐이다.
 *
 * 두 가지를 반드시 지킨다.
 *
 *  - **사각형이 아니다.** 이미지 전체에 테두리를 두르면 그건 액자이지 컷아웃이
 *    아니다. 불투명한 픽셀의 외곽만 따라간다.
 *  - **매번 같은 모양이다.** 넓히는 폭은 각도마다 흔들리지만, 그 흔들림은 자산
 *    번호에서 나온 씨앗으로 정해진다. 그래서 다시 그려도, 미리보기에서도,
 *    최종 합성에서도 같은 외곽선이 나온다. 무작위였다면 화면을 볼 때마다 종이가
 *    다시 잘렸을 것이다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

/** 넓히는 폭 — 내용의 짧은 변에 대한 비율. */
export const PAPER_PAD_RATIO = 0.05
export const PAPER_MIN_PAD = 2

/**
 * 종이 테두리의 두께 (한방 생성 Patch §3).
 *
 * 세 단계뿐이다. 자유로운 숫자를 주면 작업자가 "몇이 맞는지"를 매번 정해야
 * 하고, 그 답은 사실 그림마다 다르지 않다 — 얇거나, 보통이거나, 두껍다.
 */
export type PaperWeight = 'thin' | 'normal' | 'thick'
export const DEFAULT_PAPER_WEIGHT: PaperWeight = 'normal'

/** 기준 폭에 곱하는 값. `normal`이 1이므로 지금까지의 결과가 기본이다. */
export const PAPER_WEIGHTS: Record<PaperWeight, number> = { thin: 0.6, normal: 1, thick: 1.7 }

export const PAPER_WEIGHT_OPTIONS: readonly { value: PaperWeight; label: string }[] = [
  { value: 'thin', label: '얇게' },
  { value: 'normal', label: '보통' },
  { value: 'thick', label: '두껍게' },
]

/** 모르는 값은 보통으로 읽는다 — 예전 작업이 열리기만 해도 달라지지 않게. */
export function paperWeightOf(value: unknown): PaperWeight {
  return value === 'thin' || value === 'thick' ? value : DEFAULT_PAPER_WEIGHT
}
/** 각도마다 폭이 흔들리는 정도 0..1. 0이면 정확한 원, 1이면 너덜너덜. */
export const PAPER_ROUGHNESS = 0.42
/** 외곽을 훑는 각도 수. 촘촘할수록 테두리가 매끈하다. */
export const PAPER_STAMPS = 96
/** 따뜻한 흰색. 순백은 화면에서 배경과 붙어 종이로 읽히지 않는다. */
export const PAPER_COLOR = { r: 253, g: 251, b: 244 }

/** 종이 뒤에 지는 얕은 그림자 — 값은 내용의 짧은 변에 대한 비율. */
export const PAPER_SHADOW = { dx: 0, dy: 0.014, blur: 0.028, opacity: 0.3 }

export interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface MaskBuffer {
  /** 픽셀당 1바이트. 0이면 종이가 아니다. */
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface PaperOffset {
  dx: number
  dy: number
}

/** 이 알파 아래는 그림이 아니다 (`photoBox`와 같은 기준). */
export const PAPER_ALPHA = 8

/** 문자열 하나에서 나오는 32비트 씨앗 (FNV-1a). 같은 글자는 언제나 같은 값. */
export function paperSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** 씨앗에서 뽑는 0..1 값. 같은 (씨앗, 번호)는 언제나 같은 값. */
function pick(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff
}

/** 이 크기의 그림을 얼마나 밖으로 넓힐 것인가. */
export function paperPad(
  content: { width: number; height: number },
  weight: PaperWeight = DEFAULT_PAPER_WEIGHT,
): number {
  const short = Math.min(content.width, content.height)
  return Math.max(PAPER_MIN_PAD, Math.round(short * PAPER_PAD_RATIO * PAPER_WEIGHTS[weight]))
}

/**
 * 외곽을 넓힐 방향과 거리.
 *
 * 정확한 원이 아니라 세 개의 물결을 겹쳐 흔든다 — 하나만 쓰면 규칙적인 타원이
 * 되고, 너무 많이 겹치면 톱니가 된다. 위상은 씨앗에서 나오므로 같은 자산은
 * 언제나 같은 결로 잘린다.
 */
export function paperOffsets(pad: number, seed: number, count = PAPER_STAMPS): PaperOffset[] {
  const p1 = pick(seed, 1) * Math.PI * 2
  const p2 = pick(seed, 2) * Math.PI * 2
  const p3 = pick(seed, 3) * Math.PI * 2
  const offsets: PaperOffset[] = []
  for (let i = 0; i < count; i += 1) {
    const t = (i / count) * Math.PI * 2
    // -1..1 사이의 결. 진폭을 나누어 큰 굴곡 위에 작은 흔들림이 얹히게 한다.
    const wob =
      Math.sin(t * 3 + p1) * 0.55 + Math.sin(t * 7 + p2) * 0.3 + Math.sin(t * 13 + p3) * 0.15
    const radius = pad * (1 - PAPER_ROUGHNESS / 2 + (PAPER_ROUGHNESS / 2) * wob)
    offsets.push({ dx: Math.round(Math.cos(t) * radius), dy: Math.round(Math.sin(t) * radius) })
  }
  return offsets
}

/** 이 픽셀이 알파 경계에 있는가 — 불투명하면서 이웃 하나가 비어 있는 자리. */
function isEdge(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): boolean {
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true
  return (
    (data[(y * width + x - 1) * 4 + 3] ?? 0) <= PAPER_ALPHA ||
    (data[(y * width + x + 1) * 4 + 3] ?? 0) <= PAPER_ALPHA ||
    (data[((y - 1) * width + x) * 4 + 3] ?? 0) <= PAPER_ALPHA ||
    (data[((y + 1) * width + x) * 4 + 3] ?? 0) <= PAPER_ALPHA
  )
}

/**
 * 종이 모양.
 *
 * 원래 그림이 있던 자리를 먼저 채우고, **경계에 있는 픽셀만** 바깥으로 찍는다.
 * 안쪽 픽셀까지 전부 찍어도 결과는 같고 시간만 몇 배로 든다 — 안쪽은 이미
 * 채워져 있기 때문이다.
 *
 * 결과는 원본보다 사방으로 `pad`만큼 크다. 원본 픽셀은 하나도 바뀌지 않는다.
 */
export function paperMask(source: PixelBuffer, pad: number, offsets: readonly PaperOffset[]): MaskBuffer {
  const { data, width, height } = source
  const ow = width + pad * 2
  const oh = height + pad * 2
  const out = new Uint8ClampedArray(ow * oh)

  const put = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= ow || y >= oh) return
    out[y * ow + x] = 255
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) <= PAPER_ALPHA) continue
      put(x + pad, y + pad)
      if (!isEdge(data, width, height, x, y)) continue
      // 각도 사이에 생기는 틈은 2×2로 찍어 메운다. 이웃한 경계 픽셀들이 같은
      // 각도로 함께 찍히므로 테두리는 이어진다.
      for (const off of offsets) {
        const px = x + pad + off.dx
        const py = y + pad + off.dy
        put(px, py)
        put(px + 1, py)
        put(px, py + 1)
        put(px + 1, py + 1)
      }
    }
  }

  return { data: out, width: ow, height: oh }
}

/**
 * 종이가 블록 밖으로 얼마나 나가는가 — 블록 크기에 대한 비율.
 *
 * 블록은 그림의 경계와 같으므로, 종이는 그만큼 사방으로 삐져나온다. 그리는
 * 쪽은 이 값으로 종이 레이어의 자리를 잡는다.
 */
export function paperOutset(content: { width: number; height: number }, pad: number): { x: number; y: number } {
  return {
    x: content.width > 0 ? pad / content.width : 0,
    y: content.height > 0 ? pad / content.height : 0,
  }
}
