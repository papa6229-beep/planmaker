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

import { DEFAULT_PAPER_OPACITY, DEFAULT_PAPER_WEIGHT, paperOpacityOf, paperWeightOf } from './paperCutout'

export interface CompositeEffects {
  /** 가장자리 정리 — 반투명 경계의 배경색 번짐 완화 (§9.1). */
  edge: number
  /** 접지 그림자 — 제품 하단 폭에 맞춘 짧고 진한 타원 (§9.2). */
  contactShadow: number
  /** 벽 그림자 — 광원 반대편으로 밀린 낮은 불투명도의 그림자 (§9.2). */
  wallShadow: number
  /**
   * `contactShadow`가 기본값 0 이후에 적힌 값인가 (2026-09-17).
   *
   * 예전에는 기본이 0.7이었고, 후보정을 한 번이라도 만지면 그 0.7까지 통째로
   * 저장됐다. 그래서 이 표시가 없는 0.7은 작업자가 고른 값이 아니라 옛 기본값으로
   * 보고 0으로 읽는다. 읽고 나면 언제나 표시가 붙으므로, 그 뒤에 고른 70은 남는다.
   */
  floorDefaultZero?: true
  /**
   * 그림자를 깔 것인가 (그림자 Patch).
   *
   * 세기 둘(접지·벽) 위에 있는 스위치 하나다. 세기를 0으로 내리는 것과 결과는
   * 같지만, 껐다 켰을 때 **맞춰 둔 세기가 그대로 돌아온다** — 0으로 내리면
   * 그 값은 사라진다.
   *
   * 투명한 구멍이 많은 그림(로고·글자)에는 처음부터 꺼진 채로 온다. 그 판단은
   * `shadowFit.ts`가 하고, 여기 적히는 것은 그 결과뿐이다.
   */
  shadow: boolean
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
  /** 종이 테두리의 두께 배율. `1`이 지금까지의 `보통`이다. */
  paperWeight: number
  /** 종이 테두리의 진하기 0..1. `0`이면 보이지 않지만 오브젝트는 남는다. */
  paperOpacity: number
  /**
   * 테두리 — 완성 뒤에 거는 외곽선 (후보정 테두리 Patch, 2026-09-17).
   *
   * 종이 컷아웃과 **다른 것**이다. 종이 컷아웃은 켜는 순간 생성 방식(`preserve`)까지
   * 바꾸므로, 완성된 뒤에 켜고 끄면 다음 생성이 말없이 달라진다. 이것은 합칠 때
   * 그리기만 하는 효과라 AI 호출도, 생성 방식도 건드리지 않는다.
   */
  outline: boolean
  /** 테두리 두께 0..1 — 오브젝트 짧은 변에 대한 비율로 옮겨진다 (`outlineWidthPx`). */
  outlineWidth: number
  /** 테두리 진하기 0..1. */
  outlineOpacity: number
  /** 테두리 색 `#rrggbb`. */
  outlineColor: string
  /**
   * 드롭 그림자의 자리 (드롭 그림자 Patch, 2026-09-17).
   *
   * 오브젝트 짧은 변에 대한 비율이고, **페이지 기준** 방향이다 — 제품을 돌려도 그림자는
   * 같은 쪽에 진다. 포토샵 드롭 섀도처럼 캔버스에서 끌어 옮기거나 숫자로 맞춘다.
   * 사용자: "항상 하단 그림자만 쓰는 게 아니라 우측면, 좌측면 다양하게 쓴다."
   */
  shadowX: number
  shadowY: number
  /** 드롭 그림자의 흐림 0..1. */
  shadowBlur: number
}

/**
 * 아무것도 만지지 않았을 때의 값.
 *
 * §11의 "기본값만으로도 결과가 나와야 한다"를 지키되, §9.3의 "원본 색상을
 * 훼손하지 않는 낮은 값"도 함께 지킨다 — 그래서 그림자는 눈에 보이게, 색을
 * 건드리는 것들은 조심스럽게 시작한다.
 */
export const DEFAULT_COMPOSITE_EFFECTS: CompositeEffects = {
  edge: 0.5,
  contactShadow: 0,
  wallShadow: 0.35,
  shadow: true,
  grading: 0.25,
  rimLight: 0.2,
  paperCutout: false,
  paperWeight: DEFAULT_PAPER_WEIGHT,
  paperOpacity: DEFAULT_PAPER_OPACITY,
  outline: false,
  outlineWidth: 0.35,
  outlineOpacity: 1,
  outlineColor: '#ffffff',
  shadowX: 0.04,
  shadowY: 0.06,
  shadowBlur: 0.4,
}

/** 2026-09-17까지의 바닥 그림자 기본값. */
const LEGACY_CONTACT_SHADOW = 0.7


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
    contactShadow:
      value.floorDefaultZero !== true && value.contactShadow === LEGACY_CONTACT_SHADOW
        ? DEFAULT_COMPOSITE_EFFECTS.contactShadow
        : clamp01(value.contactShadow, DEFAULT_COMPOSITE_EFFECTS.contactShadow),
    floorDefaultZero: true,
    wallShadow: clamp01(value.wallShadow, DEFAULT_COMPOSITE_EFFECTS.wallShadow),
    // 여기만 `paperCutout`과 반대다. 모르는 값은 **켜짐**이어야 한다 — 지금까지
    // 만든 작업 파일에는 이 항목이 없고, 꺼진 것으로 읽으면 예전 파일을 여는
    // 순간 그림자가 통째로 사라진다.
    shadow: value.shadow !== false,
    grading: clamp01(value.grading, DEFAULT_COMPOSITE_EFFECTS.grading),
    rimLight: clamp01(value.rimLight, DEFAULT_COMPOSITE_EFFECTS.rimLight),
    // 모르는 값은 꺼짐이다. 예전 작업에 없던 항목을 켜진 것으로 읽으면, 열어
    // 보기만 해도 결과가 달라진다.
    paperCutout: value.paperCutout === true,
    paperWeight: paperWeightOf(value.paperWeight),
    paperOpacity: paperOpacityOf(value.paperOpacity),
    // 예전 작업 파일에는 없는 항목이다. 모르면 꺼짐 — 열어 보기만 해도 결과가 바뀌면 안 된다.
    outline: value.outline === true,
    outlineWidth: clamp01(value.outlineWidth, DEFAULT_COMPOSITE_EFFECTS.outlineWidth),
    outlineOpacity: clamp01(value.outlineOpacity, DEFAULT_COMPOSITE_EFFECTS.outlineOpacity),
    outlineColor:
      typeof value.outlineColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.outlineColor)
        ? value.outlineColor.toLowerCase()
        : DEFAULT_COMPOSITE_EFFECTS.outlineColor,
    shadowX: offsetOf(value.shadowX, DEFAULT_COMPOSITE_EFFECTS.shadowX),
    shadowY: offsetOf(value.shadowY, DEFAULT_COMPOSITE_EFFECTS.shadowY),
    shadowBlur: clamp01(value.shadowBlur, DEFAULT_COMPOSITE_EFFECTS.shadowBlur),
  }
}

/** 드롭 그림자를 짧은 변의 몇 배까지 밀 수 있는가. */
export const SHADOW_OFFSET_MAX = 1.5

function offsetOf(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(SHADOW_OFFSET_MAX, Math.max(-SHADOW_OFFSET_MAX, value))
}

/**
 * 테두리 두께를 픽셀로 (후보정 테두리 Patch).
 *
 * 짧은 변의 최대 6%. 0이어도 1px은 남긴다 — 켜 둔 테두리가 보이지 않으면 작업자는
 * 켜졌는지 꺼졌는지 알 수 없다. 끄는 일은 스위치가 한다.
 */
export const OUTLINE_MAX_RATIO = 0.06

export function outlineWidthPx(rect: { width: number; height: number }, width: number): number {
  const short = Math.max(1, Math.min(rect.width, rect.height))
  return Math.max(1, short * OUTLINE_MAX_RATIO * clamp01(width, 0))
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
    rx: rect.width * 0.45,
    // 납작해야 바닥에 눕는다. 세로 반지름이 가로의 절반을 넘으면 공처럼 보인다.
    ry: rect.width * 0.45 * 0.2,
    blur: rect.width * 0.05,
    // 0은 진짜 0이다. 최소 세기에서도 흐릿하게 남는 값을 두면 "껐다"가 거짓이 된다.
    // 2026-09-17: 최대 0.45로는 끝까지 올려도 티가 나지 않았다 (사용자) — 0.8까지.
    opacity: s === 0 ? 0 : 0.15 + 0.65 * s,
  }
}

/**
 * 드롭 그림자 (드롭 그림자 Patch, 2026-09-17) — 포토샵의 드롭 섀도와 같다.
 *
 * 자리는 작업자가 정한다(`shadowX`·`shadowY`, 페이지 기준). 앞선 판은 사진의 빛
 * 방향으로 자동으로 밀었는데, 실무에서는 아래·오른쪽·왼쪽을 골라 쓴다.
 *
 * 합성은 오브젝트를 **돌린 좌표계** 안에서 그리므로, 페이지 기준 자리를 그 기울기만큼
 * 거꾸로 돌려 돌려준다 — 제품을 돌려도 그림자는 같은 쪽에 진다.
 */
export function wallShadow(
  rect: ShadowSubject,
  strength: number,
  place: { x: number; y: number; blur: number; angle?: number },
): WallShadow {
  const s = clamp01(strength, 0)
  const short = Math.min(rect.width, rect.height)
  const px = place.x * short
  const py = place.y * short
  const a = (-(place.angle ?? 0) * Math.PI) / 180
  return {
    dx: px * Math.cos(a) - py * Math.sin(a),
    dy: px * Math.sin(a) + py * Math.cos(a),
    blur: short * (0.005 + 0.12 * clamp01(place.blur, 0)),
    // 끝까지 올리면 뚜렷하게 (상한 0.8).
    opacity: s === 0 ? 0 : 0.12 + 0.68 * s,
  }
}
