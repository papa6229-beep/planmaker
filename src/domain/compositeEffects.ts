/**
 * 합성 효과의 설정값 (배경 합성 1차 §9, §11, §12).
 *
 * 여기 있는 것은 **설정**뿐이다 — 0..1 사이의 세기 몇 개와, 그것을 안전하게
 * 읽어 들이는 규칙. 그림자를 어디에 어떤 모양으로 그릴지는 이 값과 분석값을
 * 함께 보는 다른 자리에서 정한다.
 *
 * 설정을 자산과 따로 두는 이유는 §9의 첫 줄 그대로다: **원본 자산은 수정하거나
 * 덮어쓰지 않는다.** 효과는 그릴 때마다 이 숫자로 다시 계산되는 것이지, 그림에
 * 구워 넣는 것이 아니다. 그래서 세기를 0으로 내리면 원본이 그대로 돌아온다.
 */

import { DEFAULT_PAPER_WEIGHT, paperWeightOf, type PaperWeight } from './paperCutout'

export interface CompositeEffects {
  /** 가장자리 정리 — 반투명 경계의 배경색 번짐 완화 (§9.1). */
  edge: number
  /** 접지 그림자 — 제품 하단 폭에 맞춘 짧고 진한 타원 (§9.2). */
  contactShadow: number
  /** 벽 그림자 — 광원 반대편으로 밀린 낮은 불투명도의 그림자 (§9.2). */
  wallShadow: number
  /** 색상 통일 — 배경 평균색 기반의 약한 그레이딩 (§9.3). */
  grading: number
  /** 림라이트 — 외곽에만 얹는 약한 빛 (§9.4). */
  rimLight: number
  /**
   * 종이 컷아웃 — 알파 외곽을 따라 흰 종이 테두리와 얕은 그림자 (Studio Patch).
   *
   * 다른 다섯과 달리 세기가 아니라 켜고 끄기 하나다. 두께·색을 고르는 화면은
   * 이번 범위 밖이고, 있지도 않은 조절값을 숫자로 흉내 내면 다음 사람이 그것을
   * 조절할 수 있는 값으로 읽는다.
   *
   * **디자인 효과일 뿐이다.** AI 전송에서 빼거나 안전 모드를 뜻하지 않는다.
   */
  paperCutout: boolean
  /** 종이 테두리의 두께 — 얇게·보통·두껍게 (한방 생성 Patch §3). */
  paperWeight: PaperWeight
}

/** 세기로 조절하는 항목만 — 종이 컷아웃은 체크 하나라 여기 끼지 않는다. */
export type CompositeStrengthKey = Exclude<keyof CompositeEffects, 'paperCutout' | 'paperWeight'>

/**
 * 아무것도 만지지 않았을 때의 값.
 *
 * §11의 "기본값만으로도 결과가 나와야 한다"를 지키되, §9.3의 "원본 색상을
 * 훼손하지 않는 낮은 값"도 함께 지킨다 — 그래서 그림자는 눈에 보이게, 색을
 * 건드리는 것들은 조심스럽게 시작한다.
 */
export const DEFAULT_COMPOSITE_EFFECTS: CompositeEffects = {
  edge: 0.5,
  contactShadow: 0.7,
  wallShadow: 0.35,
  grading: 0.25,
  rimLight: 0.2,
  paperCutout: false,
  paperWeight: DEFAULT_PAPER_WEIGHT,
}

/** 화면에 그대로 쓰는 이름 — 순서까지 여기서 정한다 (§11). */
export const COMPOSITE_EFFECT_FIELDS: readonly { key: CompositeStrengthKey; label: string }[] = [
  { key: 'edge', label: '가장자리 보정' },
  { key: 'contactShadow', label: '접지 그림자' },
  { key: 'wallShadow', label: '벽 그림자' },
  { key: 'grading', label: '색상 통일' },
  { key: 'rimLight', label: '림라이트' },
]

/** 완성 결과 전체에 얹는 아주 약한 그레인의 기본값 (§9.5). */
export const DEFAULT_GRAIN = 0.08

export function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

/**
 * 저장된(그래서 믿을 수 없는) 값을 이 판이 아는 모양으로 좁힌다.
 *
 * 빠진 항목은 기본값으로 채우고 범위를 벗어난 값은 잘라낸다. 통째로 버리지
 * 않는 이유는, 항목 하나가 이상하다고 작업자가 맞춰 둔 나머지 넷을 잃게 할
 * 이유가 없기 때문이다.
 */
export function normalizeEffects(raw: unknown): CompositeEffects {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    edge: clamp01(value.edge, DEFAULT_COMPOSITE_EFFECTS.edge),
    contactShadow: clamp01(value.contactShadow, DEFAULT_COMPOSITE_EFFECTS.contactShadow),
    wallShadow: clamp01(value.wallShadow, DEFAULT_COMPOSITE_EFFECTS.wallShadow),
    grading: clamp01(value.grading, DEFAULT_COMPOSITE_EFFECTS.grading),
    rimLight: clamp01(value.rimLight, DEFAULT_COMPOSITE_EFFECTS.rimLight),
    // 모르는 값은 꺼짐이다. 예전 작업에 없던 항목을 켜진 것으로 읽으면, 열어
    // 보기만 해도 결과가 달라진다.
    paperCutout: value.paperCutout === true,
    paperWeight: paperWeightOf(value.paperWeight),
  }
}

// ── 그림자 (§9.2) ──────────────────────────────────────────────────────────

/**
 * 접지 그림자 — 제품이 바닥에 **닿아 있다**고 말하는 그림자.
 *
 * 사방으로 같은 거리를 번지는 드롭섀도우 하나로는 이것을 만들 수 없다. 그것은
 * 제품을 바닥에 놓는 대신 공중에 띄우고, 오려 붙인 티만 더 낸다. 접지 그림자는
 * 하단 폭에 맞춘 **짧고 진한 타원**이고, 광원 반대편으로 조금 밀려 있다.
 */
export interface ContactShadow {
  cx: number
  cy: number
  rx: number
  ry: number
  blur: number
  opacity: number
}

/**
 * 벽 그림자 — 인물이나 세로형 제품 뒤에 지는 넓고 옅은 그림자.
 *
 * 접지 그림자보다 언제나 옅다. 둘의 세기가 비슷해지면 제품이 두 번 놓인 것처럼
 * 보인다.
 */
export interface WallShadow {
  dx: number
  dy: number
  blur: number
  opacity: number
}

export interface ShadowSubject {
  x: number
  y: number
  width: number
  height: number
}

/** 광원 방향만 쓰는 최소 계약 — 분석값 전체를 요구하지 않는다. */
export interface LightDirection {
  light: { x: number; y: number }
}

export function contactShadow(rect: ShadowSubject, source: LightDirection, strength: number): ContactShadow {
  const s = clamp01(strength, 0)
  return {
    // 광원 반대편으로 조금. 정면광이면 그대로 발밑이다.
    cx: rect.x + rect.width / 2 - source.light.x * rect.width * 0.06,
    // 제품의 발밑. 상자 아래쪽에 붙어 있어야 닿아 보인다.
    cy: rect.y + rect.height * 0.985,
    rx: rect.width * 0.42,
    // 납작해야 바닥에 눕는다. 세로 반지름이 가로의 절반을 넘으면 공처럼 보인다.
    ry: rect.width * 0.42 * 0.18,
    blur: rect.width * 0.06,
    // 0은 진짜 0이다. 최소 세기에서도 흐릿하게 남는 값을 두면 "껐다"가 거짓이 된다.
    opacity: s === 0 ? 0 : 0.1 + 0.35 * s,
  }
}

export function wallShadow(rect: ShadowSubject, source: LightDirection, strength: number): WallShadow {
  const s = clamp01(strength, 0)
  return {
    dx: -source.light.x * rect.width * 0.1 * (0.4 + 0.6 * s),
    dy: -source.light.y * rect.height * 0.06 * (0.4 + 0.6 * s) + rect.height * 0.02,
    blur: rect.width * 0.12,
    // 접지 그림자보다 반드시 옅다 (위 상한 0.45 대 여기 0.2).
    opacity: s === 0 ? 0 : 0.06 + 0.14 * s,
  }
}
