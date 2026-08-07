/**
 * 완성본 전용 확대·축소 (완성본 모드 Patch).
 *
 * 기획서의 막대와 **같은 자리에 다른 값**이 선다. 완성본을 보는 동안 기획서 배율을
 * 움직여 봐야 아무것도 달라지지 않기 때문이다 — 지금까지 그랬고, 그래서 완성본은
 * 잘린 채로 스크롤할 수밖에 없었다.
 *
 * `전체 보기`가 기본이다. 완성본을 처음 볼 때 알고 싶은 것은 "다 됐나"이지 글자
 * 획이 아니다.
 */

import { useResultView } from '../../features/studio/useResultView'

export function ResultZoomControls() {
  const view = useResultView()
  if (view === null) return null
  const percent = Math.round(view.zoom * 100)

  return (
    <div className="canvas-toolbar" role="group" aria-label="완성본 확대·축소">
      <button
        type="button"
        className="btn canvas-toolbar__btn"
        aria-label="완성본 축소"
        title={view.canZoomOut ? '축소' : '최소 배율입니다'}
        disabled={!view.canZoomOut}
        onClick={view.stepOut}
      >
        −
      </button>
      <span className="canvas-toolbar__value" aria-live="polite" aria-label={`완성본 배율 ${percent}%`}>
        {percent}%
      </span>
      <button
        type="button"
        className="btn canvas-toolbar__btn"
        aria-label="완성본 확대"
        title={view.canZoomIn ? '확대' : '최대 배율입니다'}
        disabled={!view.canZoomIn}
        onClick={view.stepIn}
      >
        ＋
      </button>
      <button
        type="button"
        className={`btn canvas-toolbar__fit${view.fit === 'page' ? ' is-active' : ''}`}
        aria-pressed={view.fit === 'page'}
        title="한 화면에 전체가 들어오게"
        onClick={view.fitPage}
      >
        전체 보기
      </button>
      <button
        type="button"
        className={`btn canvas-toolbar__fit${view.fit === 'width' ? ' is-active' : ''}`}
        aria-pressed={view.fit === 'width'}
        title="화면 너비에 맞춤"
        onClick={view.fitWidth}
      >
        폭 맞춤
      </button>
      <button type="button" className="btn" title="실제 크기 (100%)" onClick={view.resetTo100}>
        100%
      </button>
    </div>
  )
}
