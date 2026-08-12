/**
 * 연결된 실제 사용 이미지를 브라우저에서 읽는다 (배경 합성 1차 §7).
 *
 * 이 모듈이 있는 이유 하나: **원본을 모델에게 보내지 않기 위해서**다. 배경을
 * 만드는 데 필요한 것은 "이 제품이 어떤 색이고 어디가 밝은가"라는 몇 개의
 * 숫자이지 사진 자체가 아니다. 그래서 여기서 숫자만 뽑고, 요청에는 그 숫자만
 * 싣는다. 파일명도, 바이트도, data URL도 이 모듈을 지나가지 않는다 — 애초에
 * 들어오지도 않는다. 들어오는 것은 픽셀 배열 하나뿐이다.
 *
 * 투명한 픽셀은 세지 않는다. 누끼의 바깥은 제품이 아니고, 그것까지 평균에
 * 넣으면 배경색이 제품색인 것처럼 읽힌다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

/** 이 알파 아래는 제품이 아니라 빈 자리로 본다. */
export const OPAQUE_ALPHA = 128

/**
 * 대표 색을 셀 때 각 채널을 나누는 칸 수.
 *
 * 너무 거칠면 밝기만 다른 같은 색이 한 칸에 뭉쳐 대표색이 하나로 줄고, 너무
 * 잘면 노이즈가 저마다 자기 칸을 차지한다. 8칸(32단계)은 그 사이다.
 */
export const PALETTE_LEVELS = 8
export const MAX_PALETTE = 5

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface PaletteEntry {
  /** 소문자 16진수. 화면과 프롬프트가 같은 표기를 쓴다. */
  hex: string
  /** 불투명 영역에서 이 색이 차지하는 비율 0..1. */
  share: number
}

/**
 * 대략적인 광원 방향 (§7 마지막 줄).
 *
 * `x`는 -1(왼쪽에서 옴) ~ +1(오른쪽에서 옴), `y`는 -1(위) ~ +1(아래).
 *
 * `confidence`가 언제나 `'low'`인 것은 실수가 아니라 계약이다. 이 값은 밝기
 * 기울기 하나로 추정한 것이라, 원래 색이 다른 영역이 있으면 그냥 틀린다.
 * 절대값처럼 쓰지 말라는 말을 주석이 아니라 타입에 적어 둔다.
 */
export interface LightEstimate {
  x: number
  y: number
  confidence: 'low'
}

export interface OpaqueBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ImageAnalysis {
  /** 대표 색 3~5개, 많이 쓰인 순서. */
  palette: PaletteEntry[]
  average: Rgb
  /** 평균 명도 0..1. */
  brightness: number
  /** 명암 대비 0..1 — 밝은 쪽과 어두운 쪽의 거리. */
  contrast: number
  /** 채도 0..1. */
  saturation: number
  /** 색온도 -1(차가움) ~ +1(따뜻함). */
  temperature: number
  /** 불투명 픽셀의 비율 0..1. */
  opaqueRatio: number
  /** 불투명 영역의 경계 (픽셀 좌표). 전부 투명하면 `null`. */
  bounds: OpaqueBounds | null
  /**
   * 실루엣이 얼마나 **찼는가** 0..1 — 불투명 화소가 그 경계 상자를 채운 비율
   * (그림자 Patch).
   *
   * `opaqueRatio`와 다르다. 저쪽은 그림 전체에서 제품이 차지하는 넓이이고,
   * 이쪽은 **제품이 있는 자리 안에서** 얼마나 뚫려 있는가다. 작게 찍힌 병은
   * `opaqueRatio`가 낮아도 이 값은 높고, 화면을 가득 채운 로고는 그 반대다.
   *
   * 덩어리 하나를 가정하는 효과(접지 그림자)가 이 그림에 어울리는지를 여기서
   * 가른다. 규칙 자체는 `shadowFit.ts`에 있다 — 여기는 재기만 한다.
   */
  fill: number
  light: LightEstimate
}

export interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

function toHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** 사람 눈이 느끼는 밝기 0..1. */
export function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function saturationOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === 0) return 0
  return (max - min) / max
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(-1, value))
}

/**
 * 불투명한 픽셀만 읽어 이 이미지가 어떤 색·밝기·빛인지 말한다.
 *
 * 읽을 픽셀이 하나도 없으면 `null`. 0으로 나눈 평균을 "검정"으로 내놓는 것보다,
 * 볼 것이 없었다고 말하는 편이 뒤에서 거짓말을 하지 않는다.
 */
export function analyzeCutout(pixels: PixelBuffer): ImageAnalysis | null {
  const { data, width, height } = pixels
  const total = width * height
  if (total <= 0) return null

  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  const step = 256 / PALETTE_LEVELS

  let opaque = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let sumSat = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const lums: number[] = []
  // 좌우·상하 밝기 — 광원 방향은 이 네 숫자만으로 추정한다.
  let leftLum = 0
  let leftN = 0
  let rightLum = 0
  let rightN = 0
  let topLum = 0
  let topN = 0
  let bottomLum = 0
  let bottomN = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      if ((data[i + 3] ?? 0) < OPAQUE_ALPHA) continue
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0

      opaque += 1
      sumR += r
      sumG += g
      sumB += b
      sumSat += saturationOf(r, g, b)
      const lum = luminance(r, g, b)
      lums.push(lum)

      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y

      const key =
        Math.min(PALETTE_LEVELS - 1, Math.floor(r / step)) * PALETTE_LEVELS * PALETTE_LEVELS +
        Math.min(PALETTE_LEVELS - 1, Math.floor(g / step)) * PALETTE_LEVELS +
        Math.min(PALETTE_LEVELS - 1, Math.floor(b / step))
      const bucket = buckets.get(key)
      if (bucket === undefined) buckets.set(key, { count: 1, r, g, b })
      else {
        bucket.count += 1
        bucket.r += r
        bucket.g += g
        bucket.b += b
      }
    }
  }

  if (opaque === 0) return null

  // 경계는 위에서 이미 재어 두었으므로, 좌우·상하 밝기는 그 경계를 기준으로
  // 다시 한 번 훑는다. 캔버스 전체가 아니라 **제품이 있는 영역**의 좌우를 비교
  // 해야 광원 방향이 뜻을 갖는다.
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const i = (y * width + x) * 4
      if ((data[i + 3] ?? 0) < OPAQUE_ALPHA) continue
      const lum = luminance(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
      if (x < midX) {
        leftLum += lum
        leftN += 1
      } else {
        rightLum += lum
        rightN += 1
      }
      if (y < midY) {
        topLum += lum
        topN += 1
      } else {
        bottomLum += lum
        bottomN += 1
      }
    }
  }

  const left = leftN > 0 ? leftLum / leftN : 0
  const right = rightN > 0 ? rightLum / rightN : 0
  const top = topN > 0 ? topLum / topN : 0
  const bottom = bottomN > 0 ? bottomLum / bottomN : 0
  const horizontalBase = (left + right) / 2
  const verticalBase = (top + bottom) / 2

  const sorted = lums.slice().sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] ?? 0

  const palette: PaletteEntry[] = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_PALETTE)
    .map((bucket) => ({
      hex: toHex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count),
      share: bucket.count / opaque,
    }))

  const average = { r: sumR / opaque, g: sumG / opaque, b: sumB / opaque }

  return {
    palette,
    average,
    brightness: luminance(average.r, average.g, average.b),
    contrast: Math.min(1, Math.max(0, at(0.95) - at(0.05))),
    saturation: Math.min(1, Math.max(0, sumSat / opaque)),
    temperature: clampUnit((average.r - average.b) / Math.max(1, average.r + average.b)),
    opaqueRatio: opaque / total,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    fill: opaque / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1)),
    // 밝은 쪽에 빛이 있다고 본다. 왼쪽이 밝으면 `x`가 음수 — 빛이 왼쪽에서 온다.
    light: {
      x: horizontalBase > 0 ? clampUnit((right - left) / horizontalBase) : 0,
      y: verticalBase > 0 ? clampUnit((bottom - top) / verticalBase) : 0,
      confidence: 'low',
    },
  }
}

/**
 * 여러 이미지를 한 페이지의 종합값으로 (§7).
 *
 * 픽셀 수로 더하지 않는다. 그러면 화면을 크게 차지한 제품 하나나 넓은 피부색이
 * 팔레트를 통째로 가져가고, 작은 제품의 색은 배경 주문에서 사라진다. 이미지마다
 * 같은 무게를 준 뒤 그 안에서만 비율을 따진다.
 *
 * 개별 분석값은 그대로 남는다 — 여기서 만드는 것은 그것을 대신하는 값이 아니라
 * 페이지 전체를 말하는 별도의 값이다.
 */
export function mergePageAnalysis(list: readonly ImageAnalysis[]): ImageAnalysis | null {
  const items = list.filter((a): a is ImageAnalysis => a !== null)
  if (items.length === 0) return null

  const weight = 1 / items.length
  const shares = new Map<string, number>()
  for (const item of items) {
    for (const entry of item.palette) shares.set(entry.hex, (shares.get(entry.hex) ?? 0) + entry.share * weight)
  }
  const palette = [...shares.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PALETTE)
    .map(([hex, share]) => ({ hex, share }))

  const mean = (pick: (a: ImageAnalysis) => number) => items.reduce((sum, a) => sum + pick(a), 0) * weight
  const average = {
    r: mean((a) => a.average.r),
    g: mean((a) => a.average.g),
    b: mean((a) => a.average.b),
  }

  return {
    palette,
    average,
    brightness: mean((a) => a.brightness),
    contrast: mean((a) => a.contrast),
    saturation: mean((a) => a.saturation),
    temperature: mean((a) => a.temperature),
    opaqueRatio: mean((a) => a.opaqueRatio),
    bounds: null,
    // 경계가 없으므로 실루엣도 없다. 여러 장을 섞은 값에 "얼마나 찼는가"를
    // 말할 자리는 없다 — 그림자를 켤지는 언제나 한 장을 보고 정한다.
    fill: 0,
    light: { x: mean((a) => a.light.x), y: mean((a) => a.light.y), confidence: 'low' },
  }
}
