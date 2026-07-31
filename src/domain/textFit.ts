/**
 * Text sizing driven by block size (중앙 직접 편집 §2.2).
 *
 * The user no longer picks 크게/보통/작게 — they just make the block bigger or
 * smaller and the wording follows. This module is the single pure rule behind
 * that: given the wording and the block's box in 840px canvas space, it returns
 * the font size to draw at, and whether the block is too small to hold the text
 * legibly.
 *
 * The same function feeds `layoutHint.emphasis`, so what the AI is told always
 * matches what the user actually sees on screen.
 */

/** Never shrink below this — past it the text stops being readable. */
export const MIN_FONT_PX = 12
/** Cap so a huge block does not produce absurd type. */
export const MAX_FONT_PX = 72
/** Line box as a multiple of the font size. */
const LINE_HEIGHT = 1.35
/** Card padding (top+bottom, left+right) reserved inside the block. */
const PADDING_X = 24
const PADDING_Y = 20
/** Room for the small kind badge above the text. */
const HEADER_PX = 20

export interface TextFit {
  /** Font size to render at, in canvas units. */
  fontSize: number
  /** True when the text cannot fit even at `MIN_FONT_PX` — the block is too small. */
  overflow: boolean
}

/**
 * Rough advance width of one character as a fraction of the font size. Korean
 * and other full-width characters take about a full em; latin digits and
 * letters roughly half. Estimating rather than measuring keeps this pure and
 * synchronous, which is what makes live resize feel immediate.
 */
function averageCharRatio(text: string): number {
  if (text.length === 0) return 0.6
  let wide = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    // Hangul, CJK ideographs, kana, and full-width forms.
    if (
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0x3130 && code <= 0x318f) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xff00 && code <= 0xff60)
    ) {
      wide += 1
    }
  }
  const wideRatio = wide / [...text].length
  return 0.55 + wideRatio * 0.45
}

/** Lines the text needs at a given font size, honouring explicit line breaks. */
function lineCount(text: string, fontSize: number, innerWidth: number): number {
  const charWidth = fontSize * averageCharRatio(text)
  if (charWidth <= 0 || innerWidth <= 0) return 1
  const perLine = Math.max(1, Math.floor(innerWidth / charWidth))
  let lines = 0
  for (const paragraph of text.split('\n')) {
    const chars = [...paragraph].length
    lines += Math.max(1, Math.ceil(chars / perLine))
  }
  return Math.max(1, lines)
}

/**
 * Picks the largest font size (in whole pixels) at which the wording still fits
 * the block, then reports whether even the minimum size overflows.
 *
 * An empty block is sized from its height alone so the placeholder already
 * previews how big the wording will be.
 */
export function fitTextSize(text: string, width: number, height: number): TextFit {
  const innerWidth = Math.max(1, width - PADDING_X)
  const innerHeight = Math.max(1, height - PADDING_Y - HEADER_PX)
  const trimmed = text.trim()

  if (trimmed.length === 0) {
    const size = Math.round(Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, innerHeight / LINE_HEIGHT)))
    return { fontSize: size, overflow: false }
  }

  for (let size = MAX_FONT_PX; size >= MIN_FONT_PX; size -= 1) {
    const needed = lineCount(trimmed, size, innerWidth) * size * LINE_HEIGHT
    if (needed <= innerHeight) return { fontSize: size, overflow: false }
  }
  return { fontSize: MIN_FONT_PX, overflow: true }
}

/**
 * Emphasis implied by the size the wording is actually drawn at. This is what
 * goes into `layoutHint.emphasis`, so the AI's notion of emphasis is derived
 * from the visible result rather than from a separate control the user has to
 * remember to set.
 */
export function emphasisForFontSize(fontSize: number): 'low' | 'normal' | 'high' {
  if (fontSize >= 32) return 'high'
  if (fontSize <= 15) return 'low'
  return 'normal'
}

/** Convenience: the emphasis a text block currently implies. */
export function emphasisForBlockSize(text: string, width: number, height: number): 'low' | 'normal' | 'high' {
  return emphasisForFontSize(fitTextSize(text, width, height).fontSize)
}
