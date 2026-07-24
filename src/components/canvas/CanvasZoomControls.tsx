/**
 * Canvas zoom controls (WORK_PLAN §14.7 — the canvas must not read as "too
 * small and far"). A compact strip above the canvas: 축소 / 현재 배율 / 확대,
 * plus 화면 맞춤 (fit width) and 100% (actual size). Zoom is view-only and never
 * saved — this bar only changes how the fixed 840px canvas is displayed.
 */

import { useCanvasView } from '../../features/editor/useCanvasView'

export function CanvasZoomControls() {
  const { zoom, fitMode, stepIn, stepOut, resetTo100, enableFit, canZoomIn, canZoomOut } = useCanvasView()
  const percent = Math.round(zoom * 100)

  return (
    <div className="canvas-toolbar" role="group" aria-label="캔버스 확대·축소">
      <button
        type="button"
        className="btn canvas-toolbar__btn"
        aria-label="축소"
        title={canZoomOut ? '축소 (Ctrl/⌘ − )' : '최소 배율입니다'}
        disabled={!canZoomOut}
        onClick={stepOut}
      >
        −
      </button>
      <span className="canvas-toolbar__value" aria-live="polite" aria-label={`현재 배율 ${percent}%`}>
        {percent}%
      </span>
      <button
        type="button"
        className="btn canvas-toolbar__btn"
        aria-label="확대"
        title={canZoomIn ? '확대 (Ctrl/⌘ + )' : '최대 배율입니다'}
        disabled={!canZoomIn}
        onClick={stepIn}
      >
        ＋
      </button>
      <button
        type="button"
        className={`btn canvas-toolbar__fit${fitMode ? ' is-active' : ''}`}
        aria-pressed={fitMode}
        title="화면 너비에 맞춤"
        onClick={enableFit}
      >
        화면 맞춤
      </button>
      <button
        type="button"
        className="btn"
        title="실제 크기 (100%)"
        onClick={resetTo100}
      >
        100%
      </button>
    </div>
  )
}
