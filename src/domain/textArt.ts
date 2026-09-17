/**
 * 문자 도구의 규칙 — 글자 하나하나의 모양과 자리 (문자 도구 Patch, 2026-09-17).
 *
 * 사용자: "문구를 입력하고 한 글자씩 드래그로 선택해서 각각의 색상과 크기를
 * 지정 … 세로로도 쓸 수 있었으면." 포토샵의 문자 도구가 하는 일을 코드로 한다.
 *
 * 여기는 **순수**하다. 캔버스도 글꼴 파일도 모른다 — 글자의 너비는 `measure`로
 * 받는다. 그래야 규칙을 브라우저 없이 검사할 수 있고, 캔버스 미리보기와 완성본이
 * 같은 자리를 쓴다 (`services/textArt.ts`가 이 결과를 그린다).
 *
 * 글자 하나의 모양(`CharStyle`)은 **문구의 글자 차례**에 붙는다. 문구가 바뀌면
 * 앞뒤로 같은 부분을 찾아 모양을 옮긴다 (`realignCharStyles`).
 */

import { hexOr, outlineReach, shadowOffset, type TextLook } from './textLook'

export interface CharStyle {
  color?: string
  /** 기준 글자 크기의 배수 (0.2 … 4). */
  scale?: number
  family?: string
  weight?: number
}

export type CharStyles = readonly (CharStyle | null)[]

export const CHAR_SCALE_RANGE = [0.2, 4] as const

/** 글자 차례 — 한글 한 음절, 이모지 한 개가 한 칸이다. */
export function charsOf(text: string): string[] {
  return Array.from(text)
}

function cleanStyle(raw: unknown): CharStyle | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const out: CharStyle = {}
  if (typeof v.color === 'string') {
    const hex = hexOr(v.color, '')
    if (hex !== '') out.color = hex
  }
  if (typeof v.scale === 'number' && Number.isFinite(v.scale) && v.scale !== 1) {
    out.scale = Math.min(CHAR_SCALE_RANGE[1], Math.max(CHAR_SCALE_RANGE[0], v.scale))
  }
  if (typeof v.family === 'string' && v.family.length > 0) out.family = v.family
  if (typeof v.weight === 'number' && v.weight >= 100 && v.weight <= 950) out.weight = v.weight
  return Object.keys(out).length === 0 ? null : out
}

/** 저장된 값을 좁힌다. 비어 있으면 `undefined` — 글자별 모양이 없는 것이다. */
export function normalizeCharStyles(raw: unknown): (CharStyle | null)[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.map(cleanStyle)
  while (out.length > 0 && out.at(-1) === null) out.pop()
  return out.some((s) => s !== null) ? out : undefined
}

/**
 * 고른 글자들(`start` 이상 `end` 미만)에 모양을 더한다. `null`인 칸은 그 모양을
 * 걷는다 (예: `{ color: null }`은 그 글자의 색을 문구 기본색으로 되돌린다).
 */
export function applyCharStyle(
  styles: CharStyles | undefined,
  length: number,
  start: number,
  end: number,
  patch: { [K in keyof CharStyle]?: CharStyle[K] | null },
): (CharStyle | null)[] | undefined {
  const out: (CharStyle | null)[] = Array.from({ length }, (_, i) => styles?.[i] ?? null)
  const from = Math.max(0, Math.min(start, end))
  const to = Math.min(length, Math.max(start, end))
  for (let i = from; i < to; i += 1) {
    const next: Record<string, unknown> = { ...out[i] }
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete next[k]
      else next[k] = v
    }
    out[i] = cleanStyle(next)
  }
  return normalizeCharStyles(out)
}

/**
 * 문구가 `prev`에서 `next`로 바뀔 때 글자 모양을 옮긴다.
 *
 * 앞에서 같은 만큼, 뒤에서 같은 만큼은 제 모양을 지킨다. 가운데 새로 들어온
 * 글자는 **바로 앞 글자의 모양**을 이어받는다 — 빨간 글자 뒤에 적으면 빨갛게
 * 나오는 것이 문자 도구의 버릇이다.
 */
export function realignCharStyles(prev: string, next: string, styles: CharStyles | undefined): (CharStyle | null)[] | undefined {
  if (styles === undefined || prev === next) return styles === undefined ? undefined : normalizeCharStyles(styles)
  const a = charsOf(prev)
  const b = charsOf(next)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
  const out: (CharStyle | null)[] = []
  for (let i = 0; i < head; i += 1) out.push(styles[i] ?? null)
  const inherit = head > 0 ? (styles[head - 1] ?? null) : (styles[head] ?? null)
  for (let i = head; i < b.length - tail; i += 1) out.push(inherit)
  for (let i = a.length - tail; i < a.length; i += 1) out.push(styles[i] ?? null)
  return normalizeCharStyles(out)
}

/**
 * 줄마다 글자가 문구의 몇 번째 글자인가.
 *
 * 줄은 화면이 끊은 그대로다(`planLines`). 끊는 자리의 빈칸·줄바꿈은 줄에서
 * 빠지므로, 문구를 앞에서부터 따라가며 짝을 맞춘다. 못 맞춘 글자는 `-1`이다.
 */
export function mapLinesToContent(content: string, lines: readonly string[]): { ch: string; index: number }[][] {
  const text = charsOf(content)
  let p = 0
  return lines.map((line) =>
    charsOf(line).map((ch) => {
      let q = p
      while (q < text.length && text[q] !== ch) {
        if (!/\s/.test(text[q]!)) {
          q = -1
          break
        }
        q += 1
      }
      if (q < 0 || q >= text.length) return { ch, index: -1 }
      p = q + 1
      return { ch, index: q }
    }),
  )
}

// ── 자리 잡기 ────────────────────────────────────────────────────────────────

export interface GlyphFont {
  family: string
  weight: number
  size: number
}

export interface GlyphBox {
  width: number
  /** 기준선 위로 얼마나. */
  ascent: number
  /** 기준선 아래로 얼마나. */
  descent: number
}

export type MeasureGlyph = (ch: string, font: GlyphFont) => GlyphBox

export interface PlacedGlyph {
  ch: string
  /** 문구의 몇 번째 글자인가 (-1이면 모름). */
  index: number
  font: GlyphFont
  color: string | null
  /** 그리는 점. `anchor`가 `baseline`이면 왼쪽 기준선, `center`면 글자 한가운데. */
  x: number
  y: number
  anchor: 'baseline' | 'center'
  /** 이 점을 축으로 돌리는 각도(라디안). */
  rotate: number
  width: number
  ascent: number
  descent: number
}

export interface TextArtLayout {
  glyphs: PlacedGlyph[]
  /** 글자가 차지하는 상자 (테두리·그림자 제외). */
  bounds: { x0: number; y0: number; x1: number; y1: number }
  /** 테두리·그림자까지 담는 여백 (px). */
  pad: { left: number; top: number; right: number; bottom: number }
}

export type TextArtAlign = 'left' | 'center' | 'right'

export interface TextArtInput {
  rows: readonly (readonly { ch: string; index: number }[])[]
  base: { family: string; weight: number }
  chars?: CharStyles | undefined
  look: TextLook
  align: TextArtAlign
  /** 기준 글자 크기(px). */
  size: number
  measure: MeasureGlyph
}

/** 세로쓰기에서 **눕혀** 쓰는 글자 — 장음·물결·괄호·줄임표. */
const ROTATE_IN_VERTICAL = new Set('ー－—―-~〜～…‥()（）[]［］{}｛｝<>〈〉《》「」『』【】')
/** 세로쓰기에서 오른쪽 위로 비켜 앉는 문장부호. */
const PUNCT_IN_VERTICAL = new Set('、。，．,.')

function isLatinish(ch: string): boolean {
  return /[\u0021-\u007e\u00a0-\u024f]/.test(ch)
}

function fontOf(input: TextArtInput, index: number): GlyphFont {
  const style = index >= 0 ? input.chars?.[index] : undefined
  return {
    family: style?.family ?? input.base.family,
    weight: style?.weight ?? input.base.weight,
    size: input.size * (style?.scale ?? 1),
  }
}

function colorOf(input: TextArtInput, index: number): string | null {
  return (index >= 0 ? input.chars?.[index]?.color : undefined) ?? null
}

export function layoutTextArt(input: TextArtInput): TextArtLayout {
  const { look, size, measure } = input
  const glyphs: PlacedGlyph[] = []
  const gap = look.letterSpacing * size

  if (look.vertical) {
    // ── 세로쓰기: 열은 오른쪽에서 왼쪽으로, 글자는 위에서 아래로 ────────────
    const columns = input.rows.map((row) =>
      row.map((c) => {
        const font = fontOf(input, c.index)
        const box = measure(c.ch, font)
        const rotated = ROTATE_IN_VERTICAL.has(c.ch) || (!input.look.latinUpright && isLatinish(c.ch) && c.ch !== ' ')
        const advance = (rotated ? box.width : font.size) + gap
        return { c, font, box, rotated, advance }
      }),
    )
    const heights = columns.map((col) => col.reduce((s, g) => s + g.advance, 0) - (col.length > 0 ? gap : 0))
    const tallest = Math.max(0, ...heights)
    let cx = 0
    columns.forEach((col, k) => {
      const widest = Math.max(size, ...col.map((g) => g.font.size))
      if (k > 0) cx -= widest * look.lineHeight
      const start = input.align === 'center' ? (tallest - heights[k]!) / 2 : input.align === 'right' ? tallest - heights[k]! : 0
      let y = start
      for (const g of col) {
        const cy = y + (g.rotated ? g.box.width : g.font.size) / 2
        const punct = PUNCT_IN_VERTICAL.has(g.c.ch)
        glyphs.push({
          ch: g.c.ch,
          index: g.c.index,
          font: g.font,
          color: colorOf(input, g.c.index),
          x: cx + (punct ? g.font.size * 0.3 : 0),
          y: cy - (punct ? g.font.size * 0.3 : 0),
          anchor: 'center',
          rotate: g.rotated ? Math.PI / 2 : 0,
          width: g.box.width,
          ascent: g.box.ascent,
          descent: g.box.descent,
        })
        y += g.advance
      }
    })
  } else {
    // ── 가로쓰기 ─────────────────────────────────────────────────────────────
    const rows = input.rows.map((row) => {
      const items = row.map((c) => {
        const font = fontOf(input, c.index)
        return { c, font, box: measure(c.ch, font) }
      })
      const width = items.reduce((s, g) => s + g.box.width, 0) + gap * Math.max(0, items.length - 1)
      const ascent = Math.max(size * 0.8, ...items.map((g) => g.box.ascent))
      const descent = Math.max(size * 0.2, ...items.map((g) => g.box.descent))
      const biggest = Math.max(size, ...items.map((g) => g.font.size))
      return { items, width, ascent, descent, biggest }
    })
    const widest = Math.max(0, ...rows.map((r) => r.width))
    // 원호 반지름은 가장 긴 줄로 정한다 — 줄마다 다르면 여러 줄이 따로 휜다.
    const radius = look.arc === 0 || widest === 0 ? 0 : widest / (Math.abs(look.arc) * Math.PI)
    let baseline = 0
    rows.forEach((row, k) => {
      baseline = k === 0 ? row.ascent : baseline + row.biggest * look.lineHeight
      const left = input.align === 'center' ? -row.width / 2 : input.align === 'right' ? -row.width : 0
      const mid = left + row.width / 2
      let x = left
      for (const g of row.items) {
        const center = x + g.box.width / 2
        if (radius === 0) {
          glyphs.push({
            ch: g.c.ch,
            index: g.c.index,
            font: g.font,
            color: colorOf(input, g.c.index),
            x,
            y: baseline,
            anchor: 'baseline',
            rotate: 0,
            width: g.box.width,
            ascent: g.box.ascent,
            descent: g.box.descent,
          })
        } else {
          const theta = (center - mid) / radius
          const up = look.arc > 0
          // 글자의 한가운데 높이에 원을 맞춘다.
          const middle = baseline - (g.box.ascent - g.box.descent) / 2
          const cy = up ? middle + radius : middle - radius
          glyphs.push({
            ch: g.c.ch,
            index: g.c.index,
            font: g.font,
            color: colorOf(input, g.c.index),
            x: mid + radius * Math.sin(theta),
            y: up ? cy - radius * Math.cos(theta) : cy + radius * Math.cos(theta),
            anchor: 'center',
            rotate: up ? theta : -theta,
            width: g.box.width,
            ascent: g.box.ascent,
            descent: g.box.descent,
          })
        }
        x += g.box.width + gap
      }
    })
  }

  // 글자 상자 — 돌아간 글자는 대각선 반지름으로 넉넉히 잡는다.
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const g of glyphs) {
    if (g.anchor === 'baseline' && g.rotate === 0) {
      x0 = Math.min(x0, g.x)
      x1 = Math.max(x1, g.x + g.width)
      y0 = Math.min(y0, g.y - g.ascent)
      y1 = Math.max(y1, g.y + g.descent)
    } else {
      const r = Math.hypot(g.width, g.ascent + g.descent) / 2
      x0 = Math.min(x0, g.x - r)
      x1 = Math.max(x1, g.x + r)
      y0 = Math.min(y0, g.y - r)
      y1 = Math.max(y1, g.y + r)
    }
  }
  if (!Number.isFinite(x0)) {
    x0 = 0
    y0 = 0
    x1 = 0
    y1 = 0
  }

  const reach = outlineReach(look) * size
  const { dx, dy } = shadowOffset(look)
  const blur = look.shadow ? look.shadowBlur * size * 2 : 0
  const edge = reach + 2
  const pad = {
    left: edge + Math.max(0, -dx * size) + blur,
    right: edge + Math.max(0, dx * size) + blur,
    top: edge + Math.max(0, -dy * size) + blur,
    bottom: edge + Math.max(0, dy * size) + blur,
  }
  return { glyphs, bounds: { x0, y0, x1, y1 }, pad }
}

/** 판에 앉힐 기준 크기 — 테두리·그림자까지 담아 `target` 안에 들어가는 가장 큰 크기. */
export function fitTextArtSize(
  input: Omit<TextArtInput, 'size'>,
  target: { width: number; height: number },
  probe = 100,
): number {
  const at = layoutTextArt({ ...input, size: probe })
  const w = at.bounds.x1 - at.bounds.x0 + at.pad.left + at.pad.right
  const h = at.bounds.y1 - at.bounds.y0 + at.pad.top + at.pad.bottom
  if (!(w > 0) || !(h > 0)) return probe
  // 여백 중 2px은 크기에 비례하지 않으므로 넉넉히 뺀다.
  return Math.max(4, Math.floor(probe * Math.min((target.width - 8) / w, (target.height - 8) / h)))
}
