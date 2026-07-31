import { describe, it, expect } from 'vitest'
import {
  CARD_CHROME_Y,
  CARD_PADDING_X,
  MAX_FONT_PX,
  MIN_FONT_PX,
  TEXT_CHROME_PX,
  fitTextHeight,
  emphasisForBlockSize,
  emphasisForFontSize,
  fitTextSize,
} from './textFit'

describe('fitTextSize — block size drives type size', () => {
  it('draws the same wording larger in a larger block', () => {
    const small = fitTextSize('여름 세일', 200, 100)
    const large = fitTextSize('여름 세일', 600, 220)
    expect(large.fontSize).toBeGreaterThan(small.fontSize)
    expect(small.overflow).toBe(false)
    expect(large.overflow).toBe(false)
  })

  it('measures the block box itself, with only the 4px breathing space removed', () => {
    // A text block carries no card: 320×96 is 312×88 of wording area, and the
    // line box has to draw inside that.
    const fit = fitTextSize('일부 상품 제외', 320, 96)
    expect(fit.fontSize * 1.35).toBeLessThanOrEqual(96 - TEXT_CHROME_PX)
    expect(fit.overflow).toBe(false)
    // Blocks that keep a card are measured with that card's chrome instead.
    const carded = fitTextSize('일부 상품 제외', 320, 96, { padX: CARD_PADDING_X, padY: CARD_CHROME_Y })
    expect(carded.fontSize).toBeLessThan(fit.fontSize)
  })

  it('never grows past the cap or shrinks past the readable minimum', () => {
    expect(fitTextSize('짧게', 800, 700).fontSize).toBeLessThanOrEqual(MAX_FONT_PX)
    const crammed = fitTextSize('가'.repeat(400), 120, 40)
    expect(crammed.fontSize).toBe(MIN_FONT_PX)
  })

  it('flags overflow instead of shrinking a long text into illegibility', () => {
    const tooLong = fitTextSize('가을 리빙 기획전 최대 50% 할인 무료배송 사은품 증정'.repeat(6), 200, 50)
    expect(tooLong.fontSize).toBe(MIN_FONT_PX)
    expect(tooLong.overflow).toBe(true)

    const roomy = fitTextSize('가을 리빙 기획전', 600, 200)
    expect(roomy.overflow).toBe(false)
  })

  it('wraps by width — a narrower block needs smaller type for the same text', () => {
    const wide = fitTextSize('여름 특가 최대 40% 할인', 700, 120)
    const narrow = fitTextSize('여름 특가 최대 40% 할인', 200, 120)
    expect(narrow.fontSize).toBeLessThan(wide.fontSize)
  })

  it('sizes an empty block from its height so the placeholder previews the scale', () => {
    const small = fitTextSize('', 300, 60)
    const large = fitTextSize('', 300, 200)
    expect(large.fontSize).toBeGreaterThan(small.fontSize)
    expect(large.overflow).toBe(false)
  })
})

describe('fitTextHeight — the room the wording actually takes', () => {
  it('returns the drawn line box plus the padding, and grows with the line count', () => {
    const one = fitTextHeight('여름 세일', 600, 40)
    expect(one).toBe(Math.ceil(40 * 1.35 + TEXT_CHROME_PX))

    const two = fitTextHeight('첫 줄\n둘째 줄', 600, 40)
    expect(two).toBe(Math.ceil(2 * 40 * 1.35 + TEXT_CHROME_PX))
  })
})

describe('emphasis derived from the visible size', () => {
  it('maps drawn size onto the emphasis levels', () => {
    // Type that fills an event page is louder than a 48px line, and says so.
    expect(emphasisForFontSize(140)).toBe('very_high')
    expect(emphasisForFontSize(48)).toBe('high')
    expect(emphasisForFontSize(20)).toBe('normal')
    expect(emphasisForFontSize(13)).toBe('low')
  })

  it('reports loud emphasis for a big block and low for a cramped one', () => {
    expect(emphasisForBlockSize('50% 할인', 600, 220)).toBe('very_high')
    expect(emphasisForBlockSize('작은 안내 문구입니다 일부 상품 제외 조건이 있습니다', 200, 44)).toBe('low')
  })
})
