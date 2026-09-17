/**
 * 작업판 확대·축소 — 위 막대 오른쪽 끝의 돋보기 (돋보기 Patch, 2026-09-17).
 *
 * 사용자: "±로 하는데 25%씩이라 수치가 너무 크고 버튼 위치도 애매. 상단 패널에 상시 켜져
 * 있는 돋보기 버튼으로 미세하게 … 좌클릭하면 확대, Alt+좌클릭은 축소."
 *
 * 한 번에 5%. Alt를 누르고 있는 동안은 돋보기가 `−`로 바뀌어 무엇이 일어날지 보여 준다.
 * 보고 있는 화면의 배율을 움직인다 — 완성본이면 완성본, 아니면 기획서 캔버스.
 */

import { useEffect, useState } from 'react'
import { useCanvasView } from '../../features/editor/useCanvasView'
import { useResultView } from '../../features/studio/useResultView'

function useAltHeld(): boolean {
  const [alt, setAlt] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => setAlt(e.altKey)
    const off = () => setAlt(false)
    window.addEventListener('keydown', on)
    window.addEventListener('keyup', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', on)
      window.removeEventListener('keyup', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  return alt
}

export function StudioZoom({ result }: { result: boolean }) {
  const canvas = useCanvasView()
  const view = useResultView()
  const alt = useAltHeld()
  const onResult = result && view !== null
  const zoom = onResult ? view.zoom : canvas.zoom
  const percent = Math.round(zoom * 100)
  const nudge = onResult ? view.nudge : canvas.nudge

  return (
    <div className="studio-zoom" role="group" aria-label={onResult ? '완성본 배율' : '캔버스 배율'}>
      <button
        type="button"
        className={`studio-zoom__loupe${alt ? ' is-out' : ''}`}
        aria-label="돋보기"
        title="클릭: 5% 확대 · Alt+클릭: 5% 축소"
        onClick={(e) => nudge(e.altKey ? -1 : 1)}
        // Alt+클릭이 브라우저 메뉴로 새지 않게.
        onMouseDown={(e) => {
          if (e.altKey) e.preventDefault()
        }}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <line x1="12.6" y1="12.6" x2="17" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="8.5" x2="11" y2="8.5" stroke="currentColor" strokeWidth="1.6" />
          {!alt && <line x1="8.5" y1="6" x2="8.5" y2="11" stroke="currentColor" strokeWidth="1.6" />}
        </svg>
      </button>
      <span className="studio-zoom__value" aria-live="polite" aria-label={`현재 배율 ${String(percent)}%`}>
        {percent}%
      </span>
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
          <button type="button" className="btn studio-zoom__btn" title="실제 크기 (100%)" onClick={view.resetTo100}>
            100%
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
          <button type="button" className="btn studio-zoom__btn" title="실제 크기 (100%)" onClick={canvas.resetTo100}>
            100%
          </button>
        </>
      )}
    </div>
  )
}
