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
 * The hairline the block draws around itself. It is invisible until the block
 * is hovered or selected, but it takes width from the wording all the same —
 * forgetting it is enough to push a line that measured exactly to the edge onto
 * a second line, which is what left a band of empty space beside short wording.
 */
const TEXT_BORDER_PX = 1

/**
 * Size the "무엇을 적을까요" hint is drawn at while the block is still empty.
 *
 * Fixed on purpose: the hint is not the user's wording, so sizing it from the
 * block would blow it up to whatever the empty box allows, clip it, and put a
 * scrollbar in a field nobody has typed in yet (손검수 1 §2).
 */
export const PLACEHOLDER_FONT_PX = 24

/**
 * Chrome a still-carded block spends before any wording is drawn, measured
 * against the rendered card: side padding plus its accent border horizontally,
 * and padding plus the kind badge row and the label line vertically. Image
 * slots and legacy 요청 메모 keep their card, so they keep these numbers.
 */
export const CARD_PADDING_X = 30
export const CARD_CHROME_Y = 65

/**
 * Width of one line as the browser would draw it. Supplied by the canvas, which
 * can ask the real font; without one the estimate below is used, which is
 * deliberately generous so nothing is ever clipped.
 */
export type MeasureLine = (text: string, fontSize: number) => number

export interface FitArea {
  /** Total horizontal space that is not wording. Defaults to the 4px padding. */
  padX?: number
  /** Total vertical space that is not wording. Defaults to the 4px padding. */
  padY?: number
  /** Real text measurement, when the caller has a browser to ask. */
  measure?: MeasureLine
}

/** Space a bare text block spends on padding and border, both edges together. */
export const TEXT_CHROME_PX = (TEXT_PADDING_PX + TEXT_BORDER_PX) * 2

function area(options: FitArea): { padX: number; padY: number } {
  return {
    padX: options.padX ?? TEXT_CHROME_PX,
    padY: options.padY ?? TEXT_CHROME_PX,
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

/** Estimated width of a line, used when no real measurement is available. */
function estimateWidth(text: string, fontSize: number): number {
  return [...text].length * fontSize * averageCharRatio(text)
}

/**
 * The lines the wording actually breaks into, honouring explicit line breaks
 * and wrapping the rest to the available width.
 *
 * Wrapping follows the browser: a line breaks at a space where it can, and only
 * inside a run of characters when that run is itself too long — which is also
 * how Korean without spaces breaks. Modelling this is what lets a block be
 * settled around the wording instead of around a guess.
 */
function wrapLines(text: string, fontSize: number, innerWidth: number, measure?: MeasureLine): string[] {
  const width = (line: string): number => (measure ? measure(line, fontSize) : estimateWidth(line, fontSize))
  const lines: string[] = []

  /** Longest prefix of `chars` that still fits, at least one character. */
  const prefixThatFits = (chars: string[]): number => {
    let low = 1
    let high = chars.length
    let take = 1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (width(chars.slice(0, mid).join('')) <= innerWidth) {
        take = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return take
  }

  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0 || width(paragraph) <= innerWidth) {
      lines.push(paragraph)
      continue
    }
    // Words keep their trailing space, so a break lands after it exactly as the
    // browser would put it.
    const words = paragraph.match(/\S+\s*/g) ?? [paragraph]
    let line = ''
    for (const word of words) {
      const candidate = line + word
      if (line.length > 0 && width(candidate.trimEnd()) > innerWidth) {
        lines.push(line.trimEnd())
        line = word
      } else {
        line = candidate
      }
      // A single word longer than the line breaks inside itself.
      while (width(line.trimEnd()) > innerWidth && [...line].length > 1) {
        const chars = [...line]
        const take = prefixThatFits(chars)
        if (take >= chars.length) break
        lines.push(chars.slice(0, take).join(''))
        line = chars.slice(take).join('')
      }
    }
    lines.push(line.trimEnd())
  }
  return lines.length > 0 ? lines : ['']
}

/** Lines the text needs at a given font size, honouring explicit line breaks. */
function lineCount(text: string, fontSize: number, innerWidth: number, measure?: MeasureLine): number {
  if (innerWidth <= 0 || fontSize <= 0) return 1
  return Math.max(1, wrapLines(text, fontSize, innerWidth, measure).length)
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
    const needed = lineCount(trimmed, size, innerWidth, options.measure) * size * LINE_HEIGHT
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
  return Math.ceil(lineCount(trimmed, fontSize, innerWidth, options.measure) * fontSize * LINE_HEIGHT + padY)
}

/**
 * Width the wording actually occupies at a given size, padding included —
 * the longest line it breaks into, never wider than the canvas.
 */
export function fitTextWidth(
  text: string,
  fontSize: number,
  options: FitArea & { innerWidth?: number } = {},
): number {
  const { padX } = area(options)
  const trimmed = text.trim()
  if (trimmed.length === 0) return Math.ceil(fontSize + padX)
  const measure = options.measure
  const bound = options.innerWidth ?? Number.POSITIVE_INFINITY
  const lines = wrapLines(trimmed, fontSize, bound, measure)
  const widest = lines.reduce(
    (max, line) => Math.max(max, measure ? measure(line, fontSize) : estimateWidth(line, fontSize)),
    0,
  )
  return Math.ceil(widest + padX)
}

/** A block's box in canvas units. */
export interface BlockBox {
  width: number
  height: number
}

export interface FittedBlock extends BlockBox {
  /** Size the wording is drawn at inside the settled box. */
  fontSize: number
}

/**
 * Settles a block's box around the wording it holds (손검수 1 §3).
 *
 * The size the user gave the block decides how big the type is; the wording
 * then decides how much room the block actually keeps, so no empty band is left
 * to the right of a short line or under a single line. It only ever shrinks —
 * growing is what dragging a corner is for — and it settles in one pass: the
 * box handed back produces the same type size it was measured at, so nothing
 * oscillates between renders.
 */
export function fitBlockToText(text: string, box: BlockBox, options: FitArea = {}): FittedBlock {
  const trimmed = text.trim()
  const fit = fitTextSize(text, box.width, box.height, options)
  if (trimmed.length === 0 || fit.overflow) return { ...box, fontSize: fit.fontSize }

  const { padX } = area(options)
  // Narrowing the box can make the wording re-wrap, which changes what the
  // longest line is, so the width is settled by repeating until it stops
  // moving. A pixel of slack keeps a line that measured exactly to the edge
  // from tipping over into a new line when it is drawn.
  let width = box.width
  for (let pass = 0; pass < 4; pass += 1) {
    const candidate = Math.min(
      box.width,
      fitTextWidth(trimmed, fit.fontSize, { ...options, innerWidth: Math.max(1, width - padX) }) + 1,
    )
    if (candidate >= width) break
    width = candidate
  }

  const height = fitTextHeight(trimmed, width, fit.fontSize, options)
  // If the settled width needs more lines than the block can hold, the user's
  // width stays — a tighter box must never clip the wording.
  if (height > box.height) {
    return { width: box.width, height: Math.min(box.height, fitTextHeight(trimmed, box.width, fit.fontSize, options)), fontSize: fit.fontSize }
  }
  return { width, height, fontSize: fit.fontSize }
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
