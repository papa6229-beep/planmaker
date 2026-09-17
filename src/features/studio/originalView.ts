/**
 * 원본 기획서를 어떻게 볼 것인가 (원본 기획서 보기 Patch, 2026-09-17).
 *
 * 사용자: "이미지 생성하기 전에… 작업하면서 보면서 하는거지… 위치며 배치 끝난 다음
 * 이미지를 생성하는거야." 불러온 기획서는 곧바로 작업 캔버스가 되므로, 외부 팀이
 * 그린 **원래 모습**은 옆에 세우거나(나란히) 캔버스에 겹쳐(투명도) 보아야 한다.
 *
 * 보기 상태다 — 작업 파일에도, 결과 이미지에도, AI 요청에도 들어가지 않는다.
 * 보는 사람마다의 편의라 이 브라우저에만 기억한다.
 */

import { useSyncExternalStore } from 'react'

export interface OriginalView {
  /** 원본을 작업 캔버스 옆에 세운다. */
  side: boolean
  /** 원본을 작업 캔버스에 겹친다. */
  overlay: boolean
  /** 겹칠 때의 불투명도 (0.05~1). */
  opacity: number
  /** 겹칠 때 블록보다 앞에 둔다 — 카드에 가려진 자리를 볼 때. 기본은 뒤. */
  front: boolean
}

const KEY = 'planmaker.studio.originalView'
const DEFAULT: OriginalView = { side: false, overlay: false, opacity: 0.4, front: false }

function read(): OriginalView {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return DEFAULT
    const v = JSON.parse(raw) as Partial<OriginalView>
    return {
      side: v.side === true,
      overlay: v.overlay === true,
      opacity: clampOpacity(typeof v.opacity === 'number' ? v.opacity : DEFAULT.opacity),
      front: v.front === true,
    }
  } catch {
    return DEFAULT
  }
}

export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT.opacity
  return Math.min(1, Math.max(0.05, value))
}

let state: OriginalView | null = null
const listeners = new Set<() => void>()

function current(): OriginalView {
  if (state === null) state = read()
  return state
}

export function setOriginalView(patch: Partial<OriginalView>): void {
  const next = { ...current(), ...patch }
  if (patch.opacity !== undefined) next.opacity = clampOpacity(patch.opacity)
  state = next
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 기억하지 못해도 지금 화면은 바뀐다.
  }
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useOriginalView(): OriginalView {
  return useSyncExternalStore(subscribe, current, current)
}

/** 검사마다 처음 상태로. */
export function resetOriginalViewForTests(): void {
  state = null
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // 없음
  }
  for (const l of listeners) l()
}
