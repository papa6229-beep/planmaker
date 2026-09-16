/**
 * 제품의 색을 한 줄로 (제품 색맞춤 Patch).
 *
 * 요청에 실리는 것은 이 문자열이 전부다 — 사진도 파일명도 바이트도 아니다.
 *
 * 2026-09-16에 셋을 같은 조건으로 비교해서 이 길을 골랐다: 제품 **사진**을 함께
 * 보낸 판은 배경 한가운데 제품을 크게 그렸고, 형태를 지운 **색면**을 보낸 판은
 * 그리지는 않았지만 색도 옮겨오지 않았고, 같은 색을 **말로** 옮긴 판에서만 장면의
 * 색이 실제로 움직였다. 그래서 그림으로 보내는 길은 남기지 않았다.
 */

import { describe, it, expect } from 'vitest'
import { toneOf } from '../domain/imageAnalysis'

// ── 색을 한 줄로 (제품 색맞춤 Patch) ────────────────────────────────────────
//
// 요청에 실리는 것은 이 문자열이 전부다. 사진도 파일명도 바이트도 아니다.
describe('toneOf', () => {
  const entry = (hex: string, share: number) => ({ hex, share })
  const analysis = (palette: { hex: string; share: number }[]) =>
    ({ palette } as unknown as Parameters<typeof toneOf>[0])

  it('많이 쓰인 순서대로 16진수만 잇는다', () => {
    expect(toneOf(analysis([entry('#e060a0', 0.4), entry('#e080c0', 0.2)]))).toBe('#e060a0,#e080c0')
  })

  it('세 개까지만', () => {
    expect(
      toneOf(analysis([entry('#111111', 0.3), entry('#222222', 0.2), entry('#333333', 0.15), entry('#444444', 0.1)])),
    ).toBe('#111111,#222222,#333333')
  })

  it('작은 점 하나가 배경 색을 정하지 않는다', () => {
    expect(toneOf(analysis([entry('#e060a0', 0.9), entry('#00ff00', 0.01)]))).toBe('#e060a0')
  })

  it('어느 색도 기준을 넘지 못하면 가장 많이 쓰인 하나는 쓴다', () => {
    expect(toneOf(analysis([entry('#e060a0', 0.05), entry('#00ff00', 0.04)]))).toBe('#e060a0')
  })

  it('색을 읽지 못했으면 아무것도 보내지 않는다', () => {
    expect(toneOf(null)).toBeUndefined()
    expect(toneOf(analysis([]))).toBeUndefined()
  })
})
