/**
 * Real text measurement for the canvas (손검수 1 §3).
 *
 * The sizing rule in `textFit` estimates character widths so it can stay pure,
 * and it estimates generously — which is why a block ended up wider and taller
 * than the wording it held. Here the browser is asked instead.
 *
 * The measuring is done with a hidden span rather than a canvas: a 2D context
 * resolves the font stack on its own and came out ~24% wider than the same
 * string rendered in the page, which would leave exactly the empty band this is
 * meant to remove. A span placed in the document inherits the card's font by
 * construction, so what it reports is what will be drawn.
 *
 * Outside a browser (tests, jsdom) nothing has a layout to measure; the caller
 * gets `undefined` and `textFit` falls back to its estimate.
 */

import type { MeasureLine } from '../../domain/textFit'

let probe: HTMLSpanElement | null | undefined

function element(): HTMLSpanElement | null {
  if (probe !== undefined) return probe
  probe = null
  try {
    const span = document.createElement('span')
    span.setAttribute('aria-hidden', 'true')
    span.style.cssText =
      'position:absolute;left:-10000px;top:-10000px;visibility:hidden;white-space:pre;pointer-events:none;'
    document.body.appendChild(span)

    // A layout-less environment reports 0 for everything; there is nothing to
    // measure there, and pretending otherwise would size every block to nothing.
    span.style.fontSize = '100px'
    span.textContent = '가나다'
    if (span.getBoundingClientRect().width > 0) probe = span
    else span.remove()
  } catch {
    probe = null
  }
  return probe
}

/**
 * A measurer that reports what the card will actually draw, or `undefined`
 * where the browser cannot measure. One hidden span is reused.
 */
export function createLineMeasurer(
  /** 고른 글꼴로 잴 때 (글꼴 미리보기 Patch). 없으면 카드의 기본 글꼴. */
  face?: { fontFamily: string; fontWeight: number },
): MeasureLine | undefined {
  const span = element()
  if (!span) return undefined
  return (text, fontSize) => {
    // 한 span을 함께 쓰므로 매번 적는다 — 앞서 다른 글꼴로 잰 값이 남지 않게.
    span.style.fontFamily = face?.fontFamily ?? ''
    span.style.fontWeight = face === undefined ? '' : String(face.fontWeight)
    span.style.fontSize = `${fontSize}px`
    span.textContent = text
    return span.getBoundingClientRect().width
  }
}
