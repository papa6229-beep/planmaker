/**
 * 문구의 겉모양 — 색 · 테두리 · 그림자 (살아 있는 문구 Patch, 2026-09-17).
 *
 * 사용자: "텍스트의 기본값은 없어야지 … 테두리, 그림자까지 폰트블록에 폰트를
 * 입력하면서 우리가 직접 볼 수 있게끔 하고, 완성된 이미지에도 AI에게 보정을
 * 요청하기 전까지는 텍스트로 남아 있게 하자."
 *
 * 그래서 문구의 모양은 **작업자가 고른 숫자**다. 주문 글을 읽어 짐작하지 않고,
 * 아무것도 고르지 않았으면 꾸밈도 없다(검정 글자). 같은 값이 두 곳에 쓰인다:
 *
 *  - 캔버스의 문구 블록 — CSS로 흉내 내어 생성 전에 본다 (`cssLookOf`)
 *  - 완성본의 문구 조각 — 캔버스에 그린 판 (`plateStyleOf`)
 *
 * 두께·거리는 **글자 크기에 대한 비율**이다. 그래야 블록이 커져도 같은 모양이다.
 */

export type TextFill = 'solid' | 'gradient'

export interface TextLook {
  fill: TextFill
  /** 글자색. 그라데이션이면 위쪽 색. */
  color: string
  /** 그라데이션의 아래쪽 색. */
  color2: string
  outline: boolean
  outlineColor: string
  /** 테두리 두께 — 글자 크기에 대한 비율 (0.02–0.2). */
  outlineWidth: number
  shadow: boolean
  shadowColor: string
  /** 그림자 거리 — 글자 크기에 대한 비율 (0.01–0.2). 오른쪽 아래로 민다. */
  shadowDistance: number
}

export const DEFAULT_TEXT_LOOK: TextLook = {
  fill: 'solid',
  color: '#111111',
  color2: '#555555',
  outline: false,
  outlineColor: '#ffffff',
  outlineWidth: 0.06,
  shadow: false,
  shadowColor: '#000000',
  shadowDistance: 0.05,
}

export const OUTLINE_WIDTH_RANGE = [0.02, 0.2] as const
export const SHADOW_DISTANCE_RANGE = [0.01, 0.2] as const

const HEX = /^#[0-9a-f]{6}$/i

function hexOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback
}

function rangeOr(value: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(hi, Math.max(lo, value))
}

/** 저장된(믿을 수 없는) 값을 좁힌다. 빠진 것은 "꾸밈 없음" 쪽으로 채운다. */
export function normalizeTextLook(raw: unknown): TextLook {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_TEXT_LOOK
  return {
    fill: v.fill === 'gradient' ? 'gradient' : 'solid',
    color: hexOr(v.color, d.color),
    color2: hexOr(v.color2, d.color2),
    outline: v.outline === true,
    outlineColor: hexOr(v.outlineColor, d.outlineColor),
    outlineWidth: rangeOr(v.outlineWidth, OUTLINE_WIDTH_RANGE, d.outlineWidth),
    shadow: v.shadow === true,
    shadowColor: hexOr(v.shadowColor, d.shadowColor),
    shadowDistance: rangeOr(v.shadowDistance, SHADOW_DISTANCE_RANGE, d.shadowDistance),
  }
}

/** 꾸밈이 하나라도 켜져 있는가 — 막대 버튼 표시에 쓴다. */
export function lookIsPlain(look: TextLook): boolean {
  return look.fill === 'solid' && !look.outline && !look.shadow
}

/** 완성본 판을 그리는 붓에 넘길 값 (`services/textPlateRenderer`). */
export function plateStyleOf(look: TextLook): {
  fill: TextFill
  fills: string[]
  strokeRatio: number
  strokeColor: string
  shadowRatio: number
  shadowColor: string
  hardShadow: true
} {
  return {
    fill: look.fill,
    fills: look.fill === 'gradient' ? [look.color, look.color2] : [look.color],
    strokeRatio: look.outline ? look.outlineWidth : 0,
    strokeColor: look.outlineColor,
    shadowRatio: look.shadow ? look.shadowDistance : 0,
    shadowColor: look.shadowColor,
    hardShadow: true,
  }
}

/** 둘레 몇 방향으로 찍어 두께를 흉내 낼 것인가. 많을수록 둥글다. */
const RING = 16

function ring(radius: number, dx: number, dy: number, color: string): string[] {
  if (radius <= 0) return []
  const out: string[] = []
  for (let i = 0; i < RING; i += 1) {
    const a = (i / RING) * Math.PI * 2
    out.push(`${(dx + Math.cos(a) * radius).toFixed(2)}px ${(dy + Math.sin(a) * radius).toFixed(2)}px 0 ${color}`)
  }
  return out
}

/**
 * 캔버스 블록에 거는 CSS. 판을 그리는 붓과 같은 차례로 흉내 낸다:
 * 그림자(테두리째 밀림) → 테두리 → 몸통.
 *
 * 테두리 두께는 둘레 여러 방향의 `text-shadow`로 흉내 낸다. 그라데이션 몸통은
 * `background-clip: text`로 칠하는데, 그러면 `text-shadow`가 몸통 **위에** 칠해진다.
 * 그래서 그때는 같은 글자를 한 겹 더 깔아(`under`) 거기에 테두리·그림자를 그린다.
 */
export function cssLookOf(
  look: TextLook,
  fontPx: number,
): { text: Record<string, string>; under: Record<string, string> | null } {
  const stroke = look.outline ? look.outlineWidth * fontPx : 0
  const d = look.shadow ? look.shadowDistance * fontPx : 0
  const shadows = [
    ...ring(stroke, 0, 0, look.outlineColor),
    ...(d > 0
      ? stroke > 0
        ? ring(stroke, d, d, look.shadowColor)
        : [`${d.toFixed(2)}px ${d.toFixed(2)}px 0 ${look.shadowColor}`]
      : []),
  ]
  const textShadow = shadows.length > 0 ? shadows.join(', ') : undefined
  if (look.fill === 'gradient') {
    return {
      text: {
        backgroundImage: `linear-gradient(180deg, ${look.color}, ${look.color2})`,
        // 줄마다 위→아래 — 판의 붓과 같다.
        backgroundSize: `100% ${String(Math.max(1, Math.round(fontPx * 1.22)))}px`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
      },
      under: textShadow === undefined ? null : { color: look.outline ? look.outlineColor : look.color, textShadow },
    }
  }
  return { text: { color: look.color, ...(textShadow === undefined ? {} : { textShadow }) }, under: null }
}
