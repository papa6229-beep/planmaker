/**
 * 끄는 동안 보이는 완성본 (후보정 창 Patch, 2026-09-17).
 *
 * 사용자: 슬라이더를 끄는 동안에는 화면이 바뀌지 않고, 손을 떼야 다시 합쳐졌다.
 * 레벨·커브를 맞출 때 "끌고 → 놓고 → 보고"를 되풀이해야 했다.
 *
 * 그래서 끄는 동안에는 **저장하지 않는 그림**을 한 장씩 그려 완성본 자리에 건다.
 * 이 그림은 자산 저장소에도 결과 줄에도 들어가지 않는다 — 주소 하나뿐이다. 손을
 * 떼면 지금까지처럼 한 번 합쳐 저장하고, 그 그림이 화면에 걸리면 이 주소를 거둔다.
 *
 * 늦게 끝난 미리보기가 최종 그림을 덮지 않도록 **차례표**(epoch)를 둔다. 최종
 * 합치기가 시작되면 차례가 넘어가고, 그 전에 시작한 미리보기는 버려진다.
 */

import { useSyncExternalStore } from 'react'

const urls = new Map<string, string>()
const epochs = new Map<string, number>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function previewEpoch(pageId: string): number {
  return epochs.get(pageId) ?? 0
}

/** 최종 합치기가 시작된다 — 이 앞에서 시작한 미리보기는 더 걸지 않는다. */
export function bumpPreviewEpoch(pageId: string): void {
  epochs.set(pageId, previewEpoch(pageId) + 1)
}

/** 미리보기 한 장을 건다. 그리는 사이 차례가 넘어갔으면 버린다. */
export function setLivePreview(pageId: string, url: string, epoch: number): boolean {
  if (epoch !== previewEpoch(pageId)) {
    URL.revokeObjectURL(url)
    return false
  }
  const old = urls.get(pageId)
  urls.set(pageId, url)
  if (old !== undefined) URL.revokeObjectURL(old)
  emit()
  return true
}

export function clearLivePreview(pageId: string): void {
  const old = urls.get(pageId)
  if (old === undefined) return
  urls.delete(pageId)
  // 화면이 새 주소로 바뀐 뒤에 놓는다 — 곧바로 놓으면 한 번 깨진 그림이 비친다.
  setTimeout(() => URL.revokeObjectURL(old), 1000)
  emit()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useLivePreview(pageId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => urls.get(pageId) ?? null,
    () => null,
  )
}
