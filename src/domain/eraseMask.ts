/**
 * 지우개 (지우개 Patch, 2026-09-17).
 *
 * 사용자: "포토샵 지우개처럼 … 도형을 매끄럽게건 뿌옇게건 지우는 … 마우스로 비벼가면서".
 * 정한 것: 고른 조각만, 완성본에서만, E로 켜고 `[` `]`로 붓 크기.
 *
 * 조각의 그림은 건드리지 않는다. 조각마다 **지운 자리 그림**(마스크) 한 장을 따로 두고,
 * 합칠 때 그 자리만큼 조각을 비운다 — 알파가 곧 지운 정도다. 마스크는 조각 상자
 * (돌리기 전의 틀) 전체에 펴서 쓰므로, 조각을 옮기고 늘려도 지운 자리가 따라간다.
 * 한 번 칠할 때마다 새 자산이 생기므로(고쳐 쓰지 않음) 실행 취소가 그대로 된다.
 *
 * 여기는 순수 규칙만 둔다. 칠하기는 `features/studio/useEraser.ts`, 합치기는
 * `services/compositeRenderer.ts`.
 */

import type { LayoutRect } from './imageLayout'

/** 마스크의 긴 변 (px). 조각 상자의 비율을 따른다. */
export const MASK_LONG_SIDE = 1024

export function maskSizeFor(rect: { width: number; height: number }): { width: number; height: number } {
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  const k = MASK_LONG_SIDE / Math.max(w, h)
  return { width: Math.max(8, Math.round(w * k)), height: Math.max(8, Math.round(h * k)) }
}

/**
 * 지면의 한 점 → 조각 상자 안의 자리 (0…1). 돌린 조각은 상자 한가운데를 축으로 되돌려
 * 잰다 — 합칠 때 `spun`이 같은 축으로 돌린다. 상자 밖이면 0…1을 벗어난 값이 나온다.
 */
export function localPoint(rect: LayoutRect, angle: number | undefined, point: { x: number; y: number }): { u: number; v: number } {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const a = (-(angle ?? 0) * Math.PI) / 180
  const dx = point.x - cx
  const dy = point.y - cy
  const lx = dx * Math.cos(a) - dy * Math.sin(a)
  const ly = dx * Math.sin(a) + dy * Math.cos(a)
  return {
    u: (lx + rect.width / 2) / Math.max(1e-6, rect.width),
    v: (ly + rect.height / 2) / Math.max(1e-6, rect.height),
  }
}

export interface EraserSettings {
  /** 붓 지름 (지면 px, 2 … 400). */
  size: number
  /** 경도 (0 … 1). 1이면 가장자리가 딱 끊기고, 0이면 뿌옇게 번진다. */
  hardness: number
  /** 한 번 지나갈 때 지우는 세기 (0.05 … 1). */
  strength: number
  /** 참이면 지운 자리를 되살린다. */
  restore: boolean
}

export const DEFAULT_ERASER: EraserSettings = { size: 40, hardness: 0.6, strength: 1, restore: false }

export const ERASER_SIZE_RANGE: readonly [number, number] = [2, 400]

export function clampEraser(value: Partial<EraserSettings>, base: EraserSettings = DEFAULT_ERASER): EraserSettings {
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d
  return {
    size: Math.round(num(value.size, ERASER_SIZE_RANGE[0], ERASER_SIZE_RANGE[1], base.size)),
    hardness: num(value.hardness, 0, 1, base.hardness),
    strength: num(value.strength, 0.05, 1, base.strength),
    restore: typeof value.restore === 'boolean' ? value.restore : base.restore,
  }
}

/**
 * `[` `]` 한 번에 바뀌는 붓 크기 — 작을 때는 촘촘히, 클 때는 성큼.
 */
export function stepEraserSize(size: number, direction: 1 | -1): number {
  const step = size < 10 ? 1 : size < 50 ? 5 : size < 100 ? 10 : 25
  const [lo, hi] = ERASER_SIZE_RANGE
  return Math.min(hi, Math.max(lo, size + direction * step))
}

/**
 * 붓 한 점의 세기 — 한가운데 1, 가장자리 0 (지우개 부드러운 가장자리 Patch, 2026-09-17).
 *
 * 사용자: "포토샵은 브러시를 키우면 저 멀리 외곽부터 은은하게, 중심으로 갈수록 진하게."
 * 앞선 판은 경도 이후를 **직선**으로 줄였다 — 그러면 바깥이 금방 진해진다. 이제 경도
 * 안쪽은 1, 그 바깥은 가우스 꼴로 길게 사그라든다. 경도 0이면 한가운데부터 곧바로 줄기
 * 시작해 가장자리에서 0이 된다 (포토샵의 부드러운 원과 같은 꼴).
 *
 * `t`는 한가운데로부터의 거리 / 반지름 (0 … 1).
 */
export function brushProfile(t: number, hardness: number): number {
  const h = Math.min(0.99, Math.max(0, hardness))
  if (t <= h) return 1
  if (t >= 1) return 0
  const u = (t - h) / (1 - h)
  // 3이면 반지름 절반에서 약 0.44, 바깥 1/4에서 약 0.14 — 끝까지 은은하게 남는다.
  const k = 3
  const edge = Math.exp(-k)
  return Math.max(0, (Math.exp(-k * u * u) - edge) / (1 - edge))
}

/** 방사형 그라데이션에 찍을 멈춤점 — 곡선을 이만큼 잘게 따라간다. */
export function brushStops(hardness: number, count = 16): { at: number; value: number }[] {
  const h = Math.min(0.99, Math.max(0, hardness))
  const out = [{ at: 0, value: 1 }]
  if (h > 0) out.push({ at: h, value: 1 })
  for (let i = 1; i <= count; i += 1) {
    const at = h + ((1 - h) * i) / count
    out.push({ at: Math.min(1, at), value: brushProfile(at, h) })
  }
  return out
}

/** 두 점 사이에 붓 자국을 얼마나 촘촘히 찍을까 — 지름의 1/4 간격. */
export function dabsBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
  diameter: number,
): { x: number; y: number }[] {
  const gap = Math.max(0.5, diameter / 4)
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  const n = Math.max(1, Math.ceil(dist / gap))
  const out: { x: number; y: number }[] = []
  for (let i = 1; i <= n; i += 1) out.push({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n })
  return out
}

/** 파일에서 읽은 블록 → 마스크 자산 표. 문자열이 아닌 값은 버린다. */
export function readEraseMasks(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
    ),
  )
}

/** 칠하는 동안의 마스크를 가리키는 가짜 자산 번호 — 합치기가 저장소 대신 칠하는 판에서 읽는다. */
export const LIVE_MASK_PREFIX = 'live-mask:'
export const liveMaskId = (blockId: string): string => `${LIVE_MASK_PREFIX}${blockId}`
