/**
 * 문구 판은 글자로 꽉 찬다 (문구 판 Patch).
 *
 * 2026-09-16 실측이 이 검사의 근거다. 같은 글자를 판의 78%만 채워 보냈더니
 * 모델이 **없던 줄 하나를 더 그렸고**, 94%를 채운 판에서는 그러지 않았다.
 * 빈 자리를 채우려 드는 것이다. 그래서 "판을 꽉 채우는가"가 이 모듈의 계약이다.
 *
 * 글자 너비는 폰트가 정하므로 `measure`로 받는다. 검사에서는 한 글자를 `fontSize`
 * 너비로 세는 가짜 자를 쓴다 — 규칙을 보는 데는 그것으로 충분하고, 그래야
 * 브라우저 없이 돌아간다.
 */

import { describe, it, expect } from 'vitest'
import { fitPlate, LINE_GAP, PLATE_FILL } from '../domain/textPlate'

/** 한 글자 = 글자 크기만큼의 너비. 공백도 한 글자로 센다. */
const measure = (text: string, size: number) => text.length * size

describe('fitPlate', () => {
  it('판을 꽉 채운다 — 빈 자리를 남기지 않는다', () => {
    const laid = fitPlate(['여름 시즌오프'], { width: 800, height: 400 }, measure)
    expect(laid).not.toBeNull()
    // 94%를 목표로 하되 정수로 내리므로 그보다 살짝 작다. 78% 같은 값이 나오면 안 된다.
    expect(laid!.fill).toBeGreaterThan(0.9)
    expect(laid!.fill).toBeLessThanOrEqual(PLATE_FILL)
  })

  it('가로로도 세로로도 넘치지 않는다', () => {
    const plate = { width: 600, height: 300 }
    const laid = fitPlate(['가나다라마바사', '아자차카타'], plate, measure)!
    const widest = Math.max(...laid.lines.map((l) => measure(l.text, laid.fontSize)))
    expect(widest).toBeLessThanOrEqual(plate.width * PLATE_FILL)
    expect(laid.lines.length * laid.lineHeight).toBeLessThanOrEqual(plate.height * PLATE_FILL)
  })

  it('줄은 이미 정해진 그대로다 — 여기서 다시 나누지 않는다', () => {
    // 화면에서 끊긴 줄과 결과의 줄이 어긋나면, 지키라고 말한 것과 화면이 달라진다.
    const laid = fitPlate(['첫 줄', '둘째 줄', '셋째 줄'], { width: 900, height: 600 }, measure)!
    expect(laid.lines.map((l) => l.text)).toEqual(['첫 줄', '둘째 줄', '셋째 줄'])
  })

  it('세로 가운데에 앉고 줄 간격이 고르다', () => {
    const plate = { width: 900, height: 600 }
    const laid = fitPlate(['한 줄', '두 줄'], plate, measure)!
    const block = laid.lines.length * laid.lineHeight
    expect(laid.lines[0]!.top).toBeCloseTo((plate.height - block) / 2, 5)
    expect(laid.lines[1]!.top - laid.lines[0]!.top).toBeCloseTo(laid.lineHeight, 5)
    expect(laid.lineHeight).toBeCloseTo(laid.fontSize * LINE_GAP, 5)
  })

  it('모든 줄이 같은 중심에 선다 — 가운데 맞춤', () => {
    const plate = { width: 800, height: 500 }
    const laid = fitPlate(['짧은 줄', '아주 긴 줄입니다'], plate, measure)!
    expect(new Set(laid.lines.map((l) => l.cx))).toEqual(new Set([plate.width / 2]))
  })

  it('가로로 긴 판에서는 글자가 커지고, 좁은 판에서는 작아진다', () => {
    const wide = fitPlate(['지금 구매하기'], { width: 1600, height: 400 }, measure)!
    const narrow = fitPlate(['지금 구매하기'], { width: 400, height: 400 }, measure)!
    expect(wide.fontSize).toBeGreaterThan(narrow.fontSize)
  })

  it('줄이 늘면 글자는 작아진다', () => {
    const plate = { width: 800, height: 400 }
    const one = fitPlate(['한 줄'], plate, measure)!
    const three = fitPlate(['한 줄', '두 줄', '세 줄'], plate, measure)!
    expect(three.fontSize).toBeLessThan(one.fontSize)
  })

  it('빈 줄은 세지 않는다', () => {
    const laid = fitPlate(['', '  ', '남는 줄'], { width: 800, height: 400 }, measure)!
    expect(laid.lines.map((l) => l.text)).toEqual(['남는 줄'])
  })

  it('그릴 것이 없거나 판이 없으면 아무것도 돌려주지 않는다', () => {
    expect(fitPlate([], { width: 800, height: 400 }, measure)).toBeNull()
    expect(fitPlate(['  '], { width: 800, height: 400 }, measure)).toBeNull()
    expect(fitPlate(['글자'], { width: 0, height: 400 }, measure)).toBeNull()
    expect(fitPlate(['글자'], { width: 800, height: -1 }, measure)).toBeNull()
  })

  it('판에 도저히 들어가지 않으면 그리지 않는다 — 읽히지 않는 글자를 앉히지 않는다', () => {
    // 한 글자가 최소 크기로도 판보다 넓은 경우.
    const laid = fitPlate(['아주아주 긴 문장입니다 정말로'], { width: 10, height: 10 }, measure)
    expect(laid).toBeNull()
  })
})

// ── 언제 코드가 그리는가 ────────────────────────────────────────────────────
//
// 글꼴을 고른 블록에서만 브라우저가 그린다. 고르지 않았으면 지금까지처럼 모델이
// 그린다 — 쓰고 있는 페이지의 결과가 말없이 달라지지 않게 하려는 것이다. 어느
// 쪽이 나은지는 작업자가 눈으로 보고 정한다.
//
// 그 갈림은 `useImageGeneration`의 `drawLocalTextPlate`가 맡고, 여기서는 그
// 약속이 문서로 남아 있는지만 본다 — 조건이 사라지면 이 검사가 먼저 깨진다.
describe('코드가 그리는 조건', () => {
  it('글꼴을 고르지 않으면 기본 글꼴로 그린다 (2026-09-17 — 생성한 뒤에 골라도 된다)', async () => {
    const { fontOrDefault, FALLBACK_FAMILY } = await import('../domain/fontCatalog')
    expect(fontOrDefault(undefined)).toBe(FALLBACK_FAMILY)
    expect(fontOrDefault('')).toBe(FALLBACK_FAMILY)
    expect(fontOrDefault('둥근모꼴')).toBe('둥근모꼴')
  })
})
