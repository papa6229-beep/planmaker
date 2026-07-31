import { describe, it, expect } from 'vitest'
import {
  MAX_FONT_PX,
  MIN_FONT_PX,
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

  it('leaves room for the card chrome so the wording is not clipped', () => {
    // A default block is 320×96 and its text area measures 291×37 in the browser
    // once padding, the kind badge row, and the label line are taken out. The
    // chosen size must draw inside that, line box included.
    const fit = fitTextSize('일부 상품 제외', 320, 96)
    expect(fit.fontSize * 1.35).toBeLessThanOrEqual(37)
    expect(fit.overflow).toBe(false)
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

describe('emphasis derived from the visible size', () => {
  it('maps drawn size onto the three emphasis levels', () => {
    expect(emphasisForFontSize(48)).toBe('high')
    expect(emphasisForFontSize(20)).toBe('normal')
    expect(emphasisForFontSize(13)).toBe('low')
  })

  it('reports high emphasis for a big block and low for a cramped one', () => {
    expect(emphasisForBlockSize('50% 할인', 600, 220)).toBe('high')
    expect(emphasisForBlockSize('작은 안내 문구입니다 일부 상품 제외 조건이 있습니다', 200, 44)).toBe('low')
  })
})
