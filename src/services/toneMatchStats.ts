/**
 * "배경에 맞추기"가 재는 두 곳 (후보정 창 Patch). 캔버스를 쓰는 부분만 여기 있고,
 * 세는 규칙과 레벨 계산은 `domain/toneMatch.ts`다.
 *
 *  - 제품: 그 조각의 그림 전체 (투명한 곳은 세지 않는다)
 *  - 주변: 완성본에서 조각 상자를 짧은 변의 35%만큼 넓힌 띠 — 상자 안쪽은 뺀다
 *
 * 읽지 못하면 `null`. 버튼은 아무것도 바꾸지 않는다.
 */

import { toneStatsOf, type ToneStats } from '../domain/toneMatch'
import type { LayoutRect } from '../domain/imageLayout'

const MAX_SIDE = 256
export const RING = 0.35

async function pixels(blob: Blob, crop?: { x: number; y: number; width: number; height: number }) {
  const bitmap = await createImageBitmap(blob)
  const src = crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
  const k = Math.min(1, MAX_SIDE / Math.max(src.width, src.height))
  const w = Math.max(1, Math.round(src.width * k))
  const h = Math.max(1, Math.round(src.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, src.x, src.y, src.width, src.height, 0, 0, w, h)
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h }
}

export async function objectToneStats(blob: Blob): Promise<ToneStats | null> {
  try {
    if (typeof createImageBitmap !== 'function') return null
    const px = await pixels(blob)
    if (px === null) return null
    const stats = toneStatsOf(px.data, px.width)
    return stats.count === 0 ? null : stats
  } catch {
    return null
  }
}

/** 완성본(페이지 좌표와 같은 크기로 본다)에서 상자 둘레의 띠를 잰다. */
export async function aroundToneStats(
  page: Blob,
  pageSize: { width: number; height: number },
  rect: LayoutRect,
): Promise<ToneStats | null> {
  try {
    if (typeof createImageBitmap !== 'function') return null
    const probe = await createImageBitmap(page)
    const sx = probe.width / pageSize.width
    const sy = probe.height / pageSize.height
    const pad = Math.min(rect.width, rect.height) * RING
    const x0 = Math.max(0, rect.x - pad)
    const y0 = Math.max(0, rect.y - pad)
    const x1 = Math.min(pageSize.width, rect.x + rect.width + pad)
    const y1 = Math.min(pageSize.height, rect.y + rect.height + pad)
    if (x1 <= x0 || y1 <= y0) return null
    const crop = { x: x0 * sx, y: y0 * sy, width: (x1 - x0) * sx, height: (y1 - y0) * sy }
    const px = await pixels(page, crop)
    if (px === null) return null
    // 띠 안쪽(조각 자리)은 뺀다. 조각이 이미 그려져 있어 그대로 세면 제품이 제 자신을 닮는다.
    const per = px.width / (x1 - x0)
    const ix0 = (rect.x - x0) * per
    const iy0 = (rect.y - y0) * per
    const ix1 = ix0 + rect.width * per
    const iy1 = iy0 + rect.height * per
    const stats = toneStatsOf(px.data, px.width, (x, y) => x >= ix0 && x < ix1 && y >= iy0 && y < iy1)
    return stats.count === 0 ? null : stats
  } catch {
    return null
  }
}
