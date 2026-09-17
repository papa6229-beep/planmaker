/**
 * 문구를 어떻게 꾸밀 것인가 (문구 꾸미기 Patch, 2026-09-17).
 *
 * ## 누가 무엇을 하는가
 *
 * 로컬 엔진(Klein)은 한글을 쓰지 못한다. 그래서 글자는 글꼴로 그린다
 * (`textPlate.ts`). 2026-09-17에 실물 작업 파일로 잰 결과, **색·테두리·그림자도
 * 코드가 칠해야 한다**:
 *
 *  - Klein에게 색을 말로 시키면(`Recolor … tones`, `matte pastel`) 글자 뒤의
 *    마젠타 바탕까지 물들어 글자를 따낼 수 없었다
 *  - 글자마다 다른 색은 Klein이 하지 못했다 (바탕이 분홍으로 칠해졌다)
 *  - 코드가 칠한 판에 **재질 문장 하나**(광택·입체·금속·반짝이·네온)만 주면 색·테두리·
 *    바탕이 모두 지켜졌다
 *
 * 그래서 이 모듈은 작업자의 한국어 주문을 **정해진 칸**으로 읽는다. 자유 문장으로
 * 옮기지 않는 이유: 같은 날 번역기가 "흰 테두리"를 `silver gradient`로, "배경과
 * 어울리게"를 모델이 볼 수 없는 배경을 가리키는 문장으로 바꿨다. 표에 없는 말은
 * 버리고 기본값으로 간다 — 틀리게 옮기는 것보다 낫다.
 *
 * 순수 모듈이다. 캔버스도 네트워크도 모른다.
 */

/** 글자 몸통을 어떻게 칠하는가. */
export type TextFill = 'colorful' | 'gradient' | 'solid'

/**
 * Klein에게 맡기는 유일한 일 — 표면의 재질.
 *
 * 이름만 보낸다. 문장은 어댑터가 고정 문구로 갖고 있다 (`klein-reference-modes.txt`의
 * `finish_*`). `none`이면 AI를 부르지 않고 코드가 칠한 판을 그대로 얹는다.
 */
export const TEXT_FINISHES = ['glossy', 'plastic', 'metal', 'glitter', 'neon', 'none'] as const
export type TextFinish = (typeof TEXT_FINISHES)[number]

export function readTextFinish(value: unknown): TextFinish | undefined {
  return typeof value === 'string' && (TEXT_FINISHES as readonly string[]).includes(value)
    ? (value as TextFinish)
    : undefined
}

export interface TextStyleSpec {
  fill: TextFill
  /** 작업자가 이름을 댄 색. 비어 있으면 참고 그림이나 배경에서 가져온다. */
  colors: string[]
  outline: boolean
  /** 테두리 색. 작업자가 말하지 않았으면 흰색. */
  outlineColor: string
  shadow: boolean
  finish: TextFinish
  /** 파스텔을 말했는가 — 색을 옅게 옮긴다. */
  pastel: boolean
}

export type TextEmphasis = 'very_high' | 'high' | 'normal' | 'low'

// ── 낱말 표 ────────────────────────────────────────────────────────────────

/** 색 이름 → 글자에 쓸 색. 마젠타(#ff00ff)와는 멀어야 한다 — 바탕과 함께 지워진다. */
const COLOR_WORDS: readonly { pattern: RegExp; hex: string }[] = [
  { pattern: /빨강|빨간|레드|red/i, hex: '#e8413c' },
  { pattern: /주황|오렌지|orange/i, hex: '#f58a1f' },
  { pattern: /노랑|노란|옐로|yellow/i, hex: '#f5c518' },
  { pattern: /연두|라임|lime/i, hex: '#8ccf2e' },
  { pattern: /초록|녹색|그린|green/i, hex: '#2fae5b' },
  { pattern: /민트|청록|mint|teal/i, hex: '#22b8a6' },
  { pattern: /하늘|스카이|sky/i, hex: '#3aa7e8' },
  { pattern: /파랑|파란|블루|blue/i, hex: '#2f6fe0' },
  { pattern: /남색|네이비|navy/i, hex: '#243b80' },
  { pattern: /보라|퍼플|바이올렛|purple|violet/i, hex: '#7b52e0' },
  // 분홍은 마젠타 쪽으로 기울면 바탕과 함께 지워진다. 붉은 쪽 분홍을 쓴다.
  { pattern: /분홍|핑크|자홍|마젠타|pink|magenta/i, hex: '#f2668b' },
  { pattern: /갈색|브라운|brown/i, hex: '#8a5a33' },
  { pattern: /베이지|beige/i, hex: '#d9b98c' },
  { pattern: /흰|하얀|화이트|white/i, hex: '#ffffff' },
  { pattern: /검정|검은|까만|블랙|black/i, hex: '#1b1b1f' },
]
const GOLD = ['#f8dc7a', '#c8932b']
const SILVER = ['#f4f5f7', '#9aa1a8']

const FINISH_WORDS: readonly { pattern: RegExp; finish: TextFinish }[] = [
  { pattern: /네온|발광|빛나/, finish: 'neon' },
  { pattern: /글리터|반짝이(?!게)|펄|glitter/i, finish: 'glitter' },
  { pattern: /메탈|금속|크롬|metal|chrome/i, finish: 'metal' },
  { pattern: /입체|3d|볼륨|플라스틱|젤리|풍선|도톰|통통/i, finish: 'plastic' },
  { pattern: /광택|윤기|글로시|반짝|gloss/i, finish: 'glossy' },
  { pattern: /무광|매트|플랫|평면|matte|flat/i, finish: 'none' },
]

const NEGATIVE = /(없이|빼|말고|지워|제거|안\s*(넣|보이))/

/** 이 낱말 바로 앞(같은 어절이나 앞 어절)의 색 이름. */
function colorBefore(text: string, word: RegExp): string | undefined {
  const m = new RegExp(`(\\S+)\\s*(?:색)?\\s*(?:${word.source})`).exec(text)
  if (m === null) return undefined
  return COLOR_WORDS.find((c) => c.pattern.test(m[1]!))?.hex
}

/** 이 낱말이 부정과 함께 나왔는가 ("테두리 없이", "그림자는 빼줘"). */
function negated(text: string, word: RegExp): boolean {
  const m = new RegExp(`(?:${word.source})\\S*\\s*\\S*`).exec(text)
  return m !== null && NEGATIVE.test(m[0])
}

const OUTLINE_WORD = /테두리|외곽선|아웃라인|스트로크|outline|stroke/
const SHADOW_WORD = /그림자|쉐도우|섀도|shadow/

/**
 * 한국어 주문을 칸으로 읽는다.
 *
 * `emphasis`는 주문이 아무것도 말하지 않았을 때의 기본을 정한다 — 큰 제목은
 * 글자마다 다른 색, 본문은 두 색 그라데이션. 테두리·그림자는 언제나 켠다
 * (밝은 배경에서도 어두운 배경에서도 읽히게 하는 가장 싼 방법이다).
 */
export function readTextOrder(note: string | undefined, emphasis: TextEmphasis = 'normal'): TextStyleSpec {
  const text = (note ?? '').trim()
  const big = emphasis === 'very_high' || emphasis === 'high'
  const spec: TextStyleSpec = {
    fill: big ? 'colorful' : 'gradient',
    colors: [],
    outline: true,
    outlineColor: '#ffffff',
    shadow: true,
    // 작은 글자는 재질이 보이지 않는다. 부를 이유가 없다.
    finish: emphasis === 'low' ? 'none' : 'glossy',
    pastel: false,
  }
  if (text.length === 0) return spec

  if (/알록달록|무지개|컬러풀|다채|여러\s*색|colorful|rainbow/i.test(text)) spec.fill = 'colorful'
  else if (/그라데이션|그라디언트|gradient/i.test(text)) spec.fill = 'gradient'
  else if (/단색|한\s*가지\s*색/.test(text)) spec.fill = 'solid'

  if (/파스텔|pastel/i.test(text)) spec.pastel = true

  // 테두리의 색은 몸통 색이 아니다 — 먼저 떼어 낸다.
  const outlineColor = colorBefore(text, OUTLINE_WORD)
  if (OUTLINE_WORD.test(text)) {
    spec.outline = !negated(text, OUTLINE_WORD)
    if (outlineColor !== undefined) spec.outlineColor = outlineColor
  }
  if (SHADOW_WORD.test(text)) spec.shadow = !negated(text, SHADOW_WORD)

  const body = OUTLINE_WORD.test(text)
    ? text.replace(new RegExp(`\\S*\\s*(?:색)?\\s*(?:${OUTLINE_WORD.source})`, 'g'), ' ')
    : text
  const metallic = /금색|골드|황금|gold|은색|실버|silver/i.test(body)
  if (/금색|골드|황금|gold/i.test(body)) {
    spec.colors = [...GOLD]
    spec.fill = 'gradient'
    spec.finish = 'metal'
  } else if (/은색|실버|silver/i.test(body)) {
    spec.colors = [...SILVER]
    spec.fill = 'gradient'
    spec.finish = 'metal'
  } else {
    // 말한 차례대로. 같은 색을 두 번 넣지 않는다.
    const found: { at: number; hex: string }[] = []
    for (const c of COLOR_WORDS) {
      const m = c.pattern.exec(body)
      if (m !== null && !found.some((f) => f.hex === c.hex)) found.push({ at: m.index, hex: c.hex })
    }
    spec.colors = found.sort((a, b) => a.at - b.at).map((f) => f.hex)
    if (spec.colors.length === 1 && !/알록달록|무지개|그라데이션|그라디언트/.test(text)) spec.fill = 'solid'
  }
  // 흰 글자에 흰 테두리면 글자가 사라진다.
  if (spec.colors.length === 1 && spec.colors[0] === '#ffffff' && spec.outlineColor === '#ffffff') {
    spec.outlineColor = '#1b1b1f'
  }

  for (const f of FINISH_WORDS) {
    if (f.pattern.test(text)) {
      spec.finish = f.finish
      break
    }
  }
  // "금색으로 반짝이게" — 금·은의 반짝임은 금속이다.
  if (metallic && spec.finish === 'glossy') spec.finish = 'metal'
  return spec
}

/**
 * 뒤에 오는 주문이 이긴다 — 고치기의 "수정 지시"가 블록에 붙어 있던 주문보다 앞선다.
 * 수정 지시가 말하지 않은 칸은 원래 주문의 것을 쓴다.
 */
export function mergeTextOrders(base: string | undefined, override: string | undefined, emphasis: TextEmphasis): TextStyleSpec {
  const a = readTextOrder(base, emphasis)
  const text = (override ?? '').trim()
  if (text.length === 0) return a
  const b = readTextOrder(text, emphasis)
  const d = readTextOrder('', emphasis)
  const said = (key: keyof TextStyleSpec) => JSON.stringify(b[key]) !== JSON.stringify(d[key])
  return {
    fill: said('fill') ? b.fill : a.fill,
    colors: b.colors.length > 0 ? b.colors : a.colors,
    outline: said('outline') ? b.outline : a.outline,
    outlineColor: said('outlineColor') ? b.outlineColor : a.outlineColor,
    shadow: said('shadow') ? b.shadow : a.shadow,
    finish: said('finish') ? b.finish : a.finish,
    pastel: b.pastel || a.pastel,
  }
}

// ── 색 ─────────────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (m === null) return null
  const n = parseInt(m[1]!, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h * 60, s, l }
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}

/** 마젠타 근처의 색상. 이 색으로 칠한 글자는 바탕과 함께 지워진다 (2026-09-17 실측 기준). */
export const KEY_HUE_MIN = 285
export const KEY_HUE_MAX = 335

/**
 * 그림(배경·참고 그림)의 대표색에서 **글자에 쓸 색**을 뽑는다.
 *
 * 색상(hue)만 가져오고 밝기·채도는 글자용으로 정한다. 파스텔 배경의 색을 그대로
 * 쓰면 글자가 배경에 묻힌다 — 9/17 시안에서 본문 두 줄이 그랬다. 그래서 큰 제목은
 * 또렷한 중간 밝기, 본문은 더 진하게.
 *
 * `bright`는 글자가 놓일 자리의 밝기 0..1. 어두운 자리면 글자를 밝게 뒤집는다.
 */
export function letteringColors(
  palette: readonly { hex: string; share: number }[],
  options: { emphasis: TextEmphasis; bright?: number; pastel?: boolean; max?: number },
): string[] {
  const hues: number[] = []
  for (const entry of [...palette].sort((a, b) => b.share - a.share)) {
    const rgb = hexToRgb(entry.hex)
    if (rgb === null) continue
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)
    if (s < 0.15 || l > 0.95 || l < 0.08) continue // 무채색은 포인트가 못 된다
    if (h >= KEY_HUE_MIN && h <= KEY_HUE_MAX) continue
    if (hues.some((q) => Math.min(Math.abs(q - h), 360 - Math.abs(q - h)) < 28)) continue
    hues.push(h)
  }
  // 무채색 그림이면 믿을 만한 기본 한 벌.
  const base = hues.length > 0 ? hues : [8, 38, 200, 95, 260]
  const big = options.emphasis === 'very_high' || options.emphasis === 'high'
  const dark = options.bright !== undefined && options.bright < 0.42
  const l = options.pastel ? 0.74 : dark ? 0.7 : big ? 0.6 : 0.42
  const s = options.pastel ? 0.7 : 0.82
  return base.slice(0, options.max ?? 5).map((h) => hslToHex(h, s, l))
}

/** 작업자가 이름을 댄 색도 같은 규칙으로 옮긴다 — 흰색·검정·금·은은 그대로. */
export function spokenColors(colors: readonly string[], pastel: boolean): string[] {
  if (!pastel) return [...colors]
  return colors.map((hex) => {
    const rgb = hexToRgb(hex)
    if (rgb === null) return hex
    const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b)
    return s < 0.15 ? hex : hslToHex(h, 0.7, 0.74)
  })
}

/** 같은 색상으로 한 단계 진하게 — 한 가지 색만 있을 때 그라데이션의 아래쪽. */
export function shadeOf(hex: string): string {
  const rgb = hexToRgb(hex)
  if (rgb === null) return hex
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)
  return hslToHex(h, s, Math.max(0.08, l - 0.18))
}

/** 그림자 색 — 글자 색과 같은 색상으로 아주 진하게. 검정보다 덜 튄다. */
export function shadowColorOf(colors: readonly string[]): string {
  const rgb = hexToRgb(colors[colors.length - 1] ?? '#333333')
  if (rgb === null) return '#2a2a33'
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b)
  return hslToHex(h, Math.min(0.5, s), 0.22)
}

// ── 판의 크기 ──────────────────────────────────────────────────────────────

/**
 * Klein에게 보낼 판의 크기.
 *
 * 2026-09-17 실측: 같은 긴 한 줄을 1664x208로 보내면 한글이 깨지고 뒤가 잘렸고,
 * 2816x352·1216x304로 보내면 정확했다. 넓이가 아니라 **높이**가 갈랐다. 그래서
 * 높이는 352px 이상, 넓이는 약 100만 화소. 어댑터 상한(약 176만)을 넘는 아주
 * 가늘고 긴 문구는 `null` — AI 없이 코드가 칠한 판을 그대로 쓴다.
 */
export const PLATE_MIN_HEIGHT = 352
export const PLATE_AREA = 1_000_000
export const PLATE_MAX_AREA = 1_760_000

export function plateSizeFor(rect: { width: number; height: number }): { width: number; height: number } | null {
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  const aspect = w / h
  let height = Math.max(PLATE_MIN_HEIGHT, Math.sqrt(PLATE_AREA / aspect))
  let width = height * aspect
  // 세로로 긴 문구는 넓이로 막히지 않도록 가로를 기준으로 다시 잰다.
  if (width < PLATE_MIN_HEIGHT) {
    width = PLATE_MIN_HEIGHT
    height = width / aspect
  }
  const W = Math.floor(width / 16) * 16
  const H = Math.floor(height / 16) * 16
  if (W * H > PLATE_MAX_AREA) return null
  return { width: W, height: H }
}

/**
 * 페이지에서 이만큼 낮은 문구는 AI를 부르지 않는다. 재질이 눈에 보이지 않을 만큼
 * 작고, 부르면 시간만 든다.
 */
export const TEXT_FINISH_MIN_HEIGHT = 40
