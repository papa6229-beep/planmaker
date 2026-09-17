/**
 * 문구의 겉모양 (살아 있는 문구 Patch, 2026-09-17 · 문자 도구 Patch 같은 날 저녁).
 *
 * 사용자: "텍스트의 기본값은 없어야지 … 최대한 포토샵, 적어도 일러스트레이터에
 * 가깝게." 그래서 문구의 모양은 **작업자가 고른 숫자**다. 주문 글을 읽어 짐작하지
 * 않고, 아무것도 고르지 않았으면 꾸밈도 없다(검정 가로 글자).
 *
 * 문구 전체에 걸리는 값만 여기 있다. 글자 하나하나의 색·크기·글꼴은
 * `textArt.ts`의 `CharStyle`이다.
 *
 * 두께·거리·흐림·자간은 **기준 글자 크기에 대한 비율**이다. 그래야 블록이 커져도
 * 같은 모양이다.
 */

export type TextFill = 'solid' | 'gradient'

export interface TextLook {
  fill: TextFill
  /** 글자색. 그라데이션이면 위쪽 색. */
  color: string
  /** 그라데이션의 아래쪽 색. */
  color2: string
  /** 안쪽 테두리. */
  outline: boolean
  outlineColor: string
  /** 안쪽 테두리 두께 — 글자 크기에 대한 비율. */
  outlineWidth: number
  /** 바깥 테두리 — 안쪽 테두리(없으면 글자) 바깥에 한 겹 더. */
  outline2: boolean
  outline2Color: string
  outline2Width: number
  shadow: boolean
  shadowColor: string
  /** 그림자 거리 — 글자 크기에 대한 비율. */
  shadowDistance: number
  /** 그림자 방향(도). 0 = 오른쪽, 90 = 아래. */
  shadowAngle: number
  /** 그림자 흐림 — 글자 크기에 대한 비율. 0이면 딱 떨어진 그림자. */
  shadowBlur: number
  shadowOpacity: number
  /** 자간 — 글자 크기에 대한 비율 (−0.3 … 1). */
  letterSpacing: number
  /** 행간 — 글자 크기의 배수 (0.7 … 3). 세로쓰기에서는 열 간격. */
  lineHeight: number
  /** 세로쓰기. 열은 오른쪽에서 왼쪽으로. */
  vertical: boolean
  /** 세로쓰기에서 영문·숫자를 세워 쓸 것인가. 아니면 눕힌다. */
  latinUpright: boolean
  /** 원호로 휘기 (−1 … 1). 양수는 위로 볼록, 1이면 반원. */
  arc: number
}

export const DEFAULT_TEXT_LOOK: TextLook = {
  fill: 'solid',
  color: '#111111',
  color2: '#555555',
  outline: false,
  outlineColor: '#ffffff',
  outlineWidth: 0.06,
  outline2: false,
  outline2Color: '#ff5fa2',
  outline2Width: 0.05,
  shadow: false,
  shadowColor: '#000000',
  shadowDistance: 0.05,
  shadowAngle: 45,
  shadowBlur: 0,
  shadowOpacity: 0.6,
  letterSpacing: 0,
  lineHeight: 1.2,
  vertical: false,
  latinUpright: true,
  arc: 0,
}

export const OUTLINE_WIDTH_RANGE = [0.01, 0.3] as const
export const SHADOW_DISTANCE_RANGE = [0, 0.4] as const
export const SHADOW_BLUR_RANGE = [0, 0.5] as const
export const LETTER_SPACING_RANGE = [-0.3, 1] as const
export const LINE_HEIGHT_RANGE = [0.7, 3] as const
export const ARC_RANGE = [-1, 1] as const

const HEX = /^#[0-9a-f]{6}$/i

export function hexOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback
}

export function rangeOr(value: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(hi, Math.max(lo, value))
}

/** 저장된(믿을 수 없는) 값을 좁힌다. 빠진 것은 "꾸밈 없음" 쪽으로 채운다. */
export function normalizeTextLook(raw: unknown): TextLook {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_TEXT_LOOK
  const angle = typeof v.shadowAngle === 'number' && Number.isFinite(v.shadowAngle) ? v.shadowAngle : d.shadowAngle
  return {
    fill: v.fill === 'gradient' ? 'gradient' : 'solid',
    color: hexOr(v.color, d.color),
    color2: hexOr(v.color2, d.color2),
    outline: v.outline === true,
    outlineColor: hexOr(v.outlineColor, d.outlineColor),
    outlineWidth: rangeOr(v.outlineWidth, OUTLINE_WIDTH_RANGE, d.outlineWidth),
    outline2: v.outline2 === true,
    outline2Color: hexOr(v.outline2Color, d.outline2Color),
    outline2Width: rangeOr(v.outline2Width, OUTLINE_WIDTH_RANGE, d.outline2Width),
    shadow: v.shadow === true,
    shadowColor: hexOr(v.shadowColor, d.shadowColor),
    shadowDistance: rangeOr(v.shadowDistance, SHADOW_DISTANCE_RANGE, d.shadowDistance),
    shadowAngle: ((Math.round(angle) % 360) + 360) % 360,
    shadowBlur: rangeOr(v.shadowBlur, SHADOW_BLUR_RANGE, d.shadowBlur),
    shadowOpacity: rangeOr(v.shadowOpacity, [0, 1], d.shadowOpacity),
    letterSpacing: rangeOr(v.letterSpacing, LETTER_SPACING_RANGE, d.letterSpacing),
    lineHeight: rangeOr(v.lineHeight, LINE_HEIGHT_RANGE, d.lineHeight),
    vertical: v.vertical === true,
    latinUpright: v.latinUpright !== false,
    arc: rangeOr(v.arc, ARC_RANGE, d.arc),
  }
}

/** 꾸밈이 하나라도 켜져 있는가 — 막대 표시에 쓴다. */
export function lookIsPlain(look: TextLook): boolean {
  return (
    look.fill === 'solid' &&
    !look.outline &&
    !look.outline2 &&
    !look.shadow &&
    look.letterSpacing === 0 &&
    look.lineHeight === DEFAULT_TEXT_LOOK.lineHeight &&
    !look.vertical &&
    look.arc === 0
  )
}

/** 테두리 전체 두께(비율). 그림자와 여백 계산에 쓴다. */
export function outlineReach(look: TextLook): number {
  return (look.outline ? look.outlineWidth : 0) + (look.outline2 ? look.outline2Width : 0)
}

/** 그림자가 밀리는 거리(비율, x·y). */
export function shadowOffset(look: TextLook): { dx: number; dy: number } {
  if (!look.shadow) return { dx: 0, dy: 0 }
  const a = (look.shadowAngle * Math.PI) / 180
  return { dx: Math.cos(a) * look.shadowDistance, dy: Math.sin(a) * look.shadowDistance }
}
