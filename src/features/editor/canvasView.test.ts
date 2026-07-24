import { describe, it, expect } from 'vitest'
import {
  clampZoom,
  createCanvasView,
  DEFAULT_ZOOM,
  fitToViewZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  zoomIn,
  zoomOut,
} from './canvasView'

describe('canvas view (zoom) — view state only', () => {
  it('defaults to 100% (1:1)', () => {
    expect(DEFAULT_ZOOM).toBe(1)
    expect(createCanvasView()).toEqual({ zoom: 1 })
  })

  it('steps up through user zoom levels (125/150/200%) and clamps at max', () => {
    expect(zoomIn(1)).toBe(1.25)
    expect(zoomIn(1.25)).toBe(1.5)
    expect(zoomIn(1.5)).toBe(2)
    expect(zoomIn(2)).toBe(MAX_ZOOM)
    expect(MAX_ZOOM).toBe(2)
  })

  it('steps down and clamps at min', () => {
    expect(zoomOut(1)).toBe(0.75)
    expect(zoomOut(0.25)).toBe(MIN_ZOOM)
  })

  it('clampZoom bounds values', () => {
    expect(clampZoom(9)).toBe(MAX_ZOOM)
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
  })

  it('fit-to-view only shrinks, never enlarges past 1:1', () => {
    // Narrow viewport → shrink below 1.
    expect(fitToViewZoom(840, 420)).toBeCloseTo(0.5, 5)
    // Wide viewport → capped at 1 (never auto-enlarges the fixed 840 canvas).
    expect(fitToViewZoom(840, 2000)).toBe(1)
  })
})
