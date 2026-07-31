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
/**
 * A text block's box *is* its wording area (단계 1-A §3.1): the kind and the ⋯
 * menu float outside it, so only this small breathing space comes off each
 * edge. Nothing here accounts for a card head or a label line — those no longer
 * live inside the box.
 */
export const TEXT_PADDING_PX = 4

/**
 * Chrome a still-carded block spends before any wording is drawn, measured
 * against the rendered card: side padding plus its accent border horizontally,
 * and padding plus the kind badge row and the label line vertically. Image
 * slots and legacy 요청 메모 keep their card, so they keep these numbers.
 */
export const CARD_PADDING_X = 30
export const CARD_CHROME_Y = 65

export interface FitArea {
  /** Total horizontal space that is not wording. Defaults to the 4px padding. */
  padX?: number
  /** Total vertical space that is not wording. Defaults to the 4px padding. */
  padY?: number
}

function area(options: FitArea): { padX: number; padY: number } {
  return {
    padX: options.padX ?? TEXT_PADDING_PX * 2,
    padY: options.padY ?? TEXT_PADDING_PX * 2,
  }
}

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
  if (text.length === 0) return 0.62
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
  return 0.58 + wideRatio * 0.42
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
export function fitTextSize(text: string, width: number, height: number, options: FitArea = {}): TextFit {
  const { padX, padY } = area(options)
  const innerWidth = Math.max(1, width - padX)
  const innerHeight = Math.max(1, height - padY)
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
 * Height the wording actually occupies at a given size, padding included.
 *
 * This is what lets a block shed the empty space left under a short line once
 * the wording is entered, so the block's box keeps meaning "the wording sits
 * here" rather than "somewhere in this area".
 */
export function fitTextHeight(text: string, width: number, fontSize: number, options: FitArea = {}): number {
  const { padX, padY } = area(options)
  const trimmed = text.trim()
  if (trimmed.length === 0) return Math.ceil(fontSize * LINE_HEIGHT + padY)
  const innerWidth = Math.max(1, width - padX)
  return Math.ceil(lineCount(trimmed, fontSize, innerWidth) * fontSize * LINE_HEIGHT + padY)
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
export function emphasisForBlockSize(
  text: string,
  width: number,
  height: number,
  options: FitArea = {},
): 'low' | 'normal' | 'high' {
  return emphasisForFontSize(fitTextSize(text, width, height, options).fontSize)
}
