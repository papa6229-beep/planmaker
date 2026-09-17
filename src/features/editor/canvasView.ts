/**
 * Canvas view state (WORK_PLAN Phase 7 §21⑤).
 *
 * Zoom is a *display-only* concern. It is deliberately NOT part of
 * `BriefDocument` / `BriefPage` / `EventBrief` and therefore never enters a
 * saved brief, a `.eventbrief` archive, or the preview — the logical canvas is
 * always 840px wide and saved coordinates / output are always at 1:1.
 *
 * The canvas never auto-enlarges: the default is 100% (1:1), it only shrinks to
 * fit when space is insufficient, and the user may explicitly pick 125% / 150%
 * / 200% etc. Keeping zoom in this separate module is the structural guarantee
 * that it is not persisted.
 */

/** 100% — the default 1:1 display. */
export const DEFAULT_ZOOM = 1

/** Discrete zoom steps offered to the user (view-only). */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

export const MIN_ZOOM = ZOOM_STEPS[0]!
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!

/** Editor-only canvas view state (never serialized into a brief). */
export interface CanvasView {
  zoom: number
}

export function createCanvasView(): CanvasView {
  return { zoom: DEFAULT_ZOOM }
}

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)
}

/** Next larger discrete step (for the ＋ control). */
export function zoomIn(zoom: number): number {
  const next = ZOOM_STEPS.find((z) => z > zoom + 1e-6)
  return next ?? MAX_ZOOM
}

/** Next smaller discrete step (for the － control). */
export function zoomOut(zoom: number): number {
  const smaller = ZOOM_STEPS.filter((z) => z < zoom - 1e-6)
  return smaller.length > 0 ? smaller[smaller.length - 1]! : MIN_ZOOM
}

/** 돋보기 한 번에 움직이는 양 (돋보기 Patch, 2026-09-17 — 25%씩은 너무 크다). */
export const FINE_ZOOM_STEP = 0.05

/**
 * 돋보기 — 5%씩. 지금 배율이 5%의 배수가 아니면(화면 맞춤 등) 먼저 그 방향의 가장
 * 가까운 배수로 간다. 범위는 다른 배율과 같다.
 */
export function nudgeZoom(zoom: number, direction: 1 | -1): number {
  const units = zoom / FINE_ZOOM_STEP
  const next = direction > 0 ? Math.floor(units + 1e-6) + 1 : Math.ceil(units - 1e-6) - 1
  return clampZoom(Math.round(next * FINE_ZOOM_STEP * 100) / 100)
}

/**
 * Computes the fit-to-view zoom for a page in the available width. Only shrinks
 * (never enlarges past 1:1): fit is min(1, available/logicalWidth).
 */
export function fitToViewZoom(logicalWidth: number, availableWidth: number): number {
  if (availableWidth <= 0 || logicalWidth <= 0) return DEFAULT_ZOOM
  return clampZoom(Math.min(1, availableWidth / logicalWidth))
}
