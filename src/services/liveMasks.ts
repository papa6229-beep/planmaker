/**
 * 칠하는 중인 지우개 마스크 (지우개 Patch, 2026-09-17).
 *
 * 문지르는 동안 한 번 움직일 때마다 저장소에 새 자산을 쓰면 느리고 쌓인다. 그래서
 * 칠하는 동안은 이 자리에만 두고, 합치기(`collectCompositeSources`)가 여기서 읽는다.
 * 손을 떼면 한 장만 저장소에 쓰고 여기서 뺀다.
 */

import { LIVE_MASK_PREFIX, liveMaskId } from '../domain/eraseMask'

const live = new Map<string, Blob>()

export function setLiveMask(blockId: string, blob: Blob | null): void {
  if (blob === null) live.delete(liveMaskId(blockId))
  else live.set(liveMaskId(blockId), blob)
}

export function hasLiveMask(blockId: string): boolean {
  return live.has(liveMaskId(blockId))
}

export function liveMaskBlob(id: string): Blob | undefined {
  return id.startsWith(LIVE_MASK_PREFIX) ? live.get(id) : undefined
}
