/**
 * Canvas zoom (view state) provider — Phase 7 Step 8B.
 *
 * Wires the pure zoom model (`canvasView.ts`) into the editor. Zoom is a
 * *display-only* concern: it lives here in React state and NEVER enters
 * `BriefDocument`, a `.eventbrief` archive, autosave, or the preview. Saved
 * block coordinates are always at the logical 1:1 scale — changing zoom only
 * changes how the fixed 840px canvas is displayed.
 *
 * Two modes:
 *   • fit  — the canvas shrinks to fit the available width (never past 1:1) and
 *            tracks viewport resizes. This is the default so the canvas is not
 *            "too small and far" (WORK_PLAN §14.7).
 *   • manual — the user picked an explicit level (− / ＋ / 100%); resizing the
 *            viewport no longer changes the zoom until 화면 맞춤 is pressed again.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitToViewZoom,
  zoomIn,
  zoomOut,
} from './canvasView'

interface CanvasViewContextValue {
  /** Current display scale (1 = 100%). */
  zoom: number
  /** True while the canvas auto-fits the available width. */
  fitMode: boolean
  /** Step up to the next discrete level (switches to manual). */
  stepIn: () => void
  /** Step down to the previous discrete level (switches to manual). */
  stepOut: () => void
  /** Snap to 100% / 1:1 (switches to manual). */
  resetTo100: () => void
  /** Re-enable fit-to-width and recompute from the last viewport report. */
  enableFit: () => void
  /**
   * Report the available canvas width and the page's logical width. Called by
   * the canvas on mount and on resize; only moves the zoom while in fit mode.
   */
  reportViewport: (availableWidth: number, logicalWidth: number) => void
  canZoomIn: boolean
  canZoomOut: boolean
}

const CanvasViewContext = createContext<CanvasViewContextValue | null>(null)

const EPSILON = 1e-6

export function CanvasViewProvider({ children }: { children: ReactNode }) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [fitMode, setFitModeState] = useState(true)
  // Refs mirror the latest values so the resize callback never reads stale
  // state (it fires outside React's render cycle).
  const fitRef = useRef(true)
  const availRef = useRef(0)
  const logicalRef = useRef(0)

  const setFit = useCallback((on: boolean) => {
    fitRef.current = on
    setFitModeState(on)
  }, [])

  const reportViewport = useCallback((availableWidth: number, logicalWidth: number) => {
    availRef.current = availableWidth
    logicalRef.current = logicalWidth
    if (fitRef.current) setZoom(fitToViewZoom(logicalWidth, availableWidth))
  }, [])

  const setManual = useCallback(
    (next: number) => {
      setFit(false)
      setZoom(clampZoom(next))
    },
    [setFit],
  )

  const stepIn = useCallback(() => setManual(zoomIn(zoom)), [setManual, zoom])
  const stepOut = useCallback(() => setManual(zoomOut(zoom)), [setManual, zoom])
  const resetTo100 = useCallback(() => setManual(DEFAULT_ZOOM), [setManual])

  const enableFit = useCallback(() => {
    setFit(true)
    if (availRef.current > 0) setZoom(fitToViewZoom(logicalRef.current, availRef.current))
  }, [setFit])

  const value = useMemo<CanvasViewContextValue>(
    () => ({
      zoom,
      fitMode,
      stepIn,
      stepOut,
      resetTo100,
      enableFit,
      reportViewport,
      canZoomIn: zoom < MAX_ZOOM - EPSILON,
      canZoomOut: zoom > MIN_ZOOM + EPSILON,
    }),
    [zoom, fitMode, stepIn, stepOut, resetTo100, enableFit, reportViewport],
  )

  return <CanvasViewContext.Provider value={value}>{children}</CanvasViewContext.Provider>
}

export function useCanvasView(): CanvasViewContextValue {
  const ctx = useContext(CanvasViewContext)
  if (!ctx) throw new Error('useCanvasView must be used within a CanvasViewProvider')
  return ctx
}
