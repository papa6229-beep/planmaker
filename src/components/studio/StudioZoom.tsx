/**
 * 작업판 확대·축소 — 위 막대 오른쪽 끝의 돋보기 (돋보기 Patch, 2026-09-17).
 *
 * 사용자: "±로 하는데 25%씩이라 수치가 너무 크고 버튼 위치도 애매. 상단 패널에 상시 켜져
 * 있는 돋보기 버튼으로 미세하게 … 좌클릭하면 확대, Alt+좌클릭은 축소."
 *
 * 돋보기는 **도구**다 (사용자 정정: "돋보기 버튼을 누르고 캔버스에 마우스를 올려 … 거기서 좌클릭,
 * 알트 좌클릭 — 포토샵·일러스트레이터처럼"). 켜면 캔버스·완성본 위에서 누른 자리를 붙든 채
 * 5%씩 확대, Alt+누르면 축소한다. Alt를 누르는 동안 돋보기가 `−`로 바뀐다. Z로 켜고 Esc로 끈다.
 */

import { useCanvasView } from '../../features/editor/useCanvasView'
import { useResultView } from '../../features/studio/useResultView'
import { setTool, useDesignTools } from '../../features/studio/designTools'
import { useAltHeld } from '../../features/studio/useAltHeld'

export function StudioZoom({ result }: { result: boolean }) {
  const canvas = useCanvasView()
  const view = useResultView()
  const alt = useAltHeld()
  const { tool } = useDesignTools()
  const zooming = tool === 'zoom'
  const onResult = result && view !== null
  const zoom = onResult ? view.zoom : canvas.zoom
  const percent = Math.round(zoom * 100)

  return (
    <div className="studio-zoom" role="group" aria-label={onResult ? '완성본 배율' : '캔버스 배율'}>
      <button
        type="button"
        className={`studio-zoom__loupe${zooming ? ' is-on' : ''}${zooming && alt ? ' is-out' : ''}`}
        aria-label="돋보기 (Z)"
        aria-pressed={zooming}
        title="돋보기 (Z) — 켜고 캔버스를 클릭하면 확대, Alt+클릭하면 축소 · Esc로 끝"
        onClick={() => setTool(zooming ? 'select' : 'zoom')}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <line x1="12.6" y1="12.6" x2="17" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="8.5" x2="11" y2="8.5" stroke="currentColor" strokeWidth="1.6" />
          {!(zooming && alt) && <line x1="8.5" y1="6" x2="8.5" y2="11" stroke="currentColor" strokeWidth="1.6" />}
        </svg>
      </button>
      {/* 배율 숫자를 누르면 100% — 막대 한 줄에 들어가도록 `100%` 단추를 합쳤다 (다크룸, 2026-09-17). */}
      <button
        type="button"
        className="studio-zoom__value"
        aria-live="polite"
        aria-label={`현재 배율 ${String(percent)}% — 누르면 100%`}
        title="누르면 실제 크기(100%)"
        onClick={onResult ? view.resetTo100 : canvas.resetTo100}
      >
        {percent}%
      </button>
      {onResult ? (
        <>
          <button
            type="button"
            className={`btn studio-zoom__btn${view.fit === 'page' ? ' is-active' : ''}`}
            aria-pressed={view.fit === 'page'}
            title="한 화면에 전체가 들어오게"
            onClick={view.fitPage}
          >
            전체 보기
          </button>
          <button
            type="button"
            className={`btn studio-zoom__btn${view.fit === 'width' ? ' is-active' : ''}`}
            aria-pressed={view.fit === 'width'}
            title="화면 너비에 맞춤"
            onClick={view.fitWidth}
          >
            폭 맞춤
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className={`btn studio-zoom__btn${canvas.fitMode ? ' is-active' : ''}`}
            aria-pressed={canvas.fitMode}
            title="화면 너비에 맞춤"
            onClick={canvas.enableFit}
          >
            화면 맞춤
          </button>
        </>
      )}
    </div>
  )
}
