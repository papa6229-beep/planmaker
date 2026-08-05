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
  contactShadow: 0.7,
  wallShadow: 0.35,
  grading: 0.25,
  rimLight: 0.2,
}

/** 화면에 그대로 쓰는 이름 — 순서까지 여기서 정한다 (§11). */
export const COMPOSITE_EFFECT_FIELDS: readonly { key: keyof CompositeEffects; label: string }[] = [
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
  }
}
