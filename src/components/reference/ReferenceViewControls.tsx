/**
 * Reference view-mode controls above the canvas (WORK_PLAN §8.3). Switches
 * between 캔버스만 / 오버레이, and — in overlay mode — toggles visibility, sets
 * opacity (0–100%, default 35%), and the fit method. View mode / opacity / fit
 * are per-page reference state (§9.3); they persist.
 *
 * 나란히 보기는 없앴다 (1단계 §4). 중앙에 새로 생긴 `AI 결과 비교`와 이름도
 * 역할도 겹쳐, 나란히 놓인 두 장이 무엇인지 화면에서 구별되지 않았기 때문이다.
 * 참고 이미지를 겹쳐 보는 일은 오버레이가 그대로 한다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import type { ReferenceLayer } from '../../domain/pageSchema'

const MODES: { value: ReferenceLayer['viewMode']; label: string }[] = [
  { value: 'canvas', label: '캔버스만' },
  { value: 'overlay', label: '오버레이' },
]

const FITS: { value: ReferenceLayer['fit']; label: string }[] = [
  { value: 'width', label: '폭 맞춤' },
  { value: 'original', label: '원본 크기' },
  { value: 'center', label: '중앙 맞춤' },
]

export function ReferenceViewControls() {
  const {
    activeReference,
    setReferenceViewMode,
    setReferenceOpacity,
    setReferenceFit,
    setReferenceVisible,
  } = useBriefDocument()

  const hasImage = activeReference.assetId !== undefined
  const { viewMode, opacity, fit, visible } = activeReference

  return (
    <div className="ref-view" role="group" aria-label="참고 이미지 보기">
      <div className="ref-view__modes" role="radiogroup" aria-label="보기 모드">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={viewMode === m.value}
            className={`ref-view__mode${viewMode === m.value ? ' is-active' : ''}`}
            disabled={!hasImage && m.value !== 'canvas'}
            onClick={() => setReferenceViewMode(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {!hasImage && <span className="ref-view__hint">참고 이미지를 추가하면 오버레이를 사용할 수 있습니다.</span>}

      {hasImage && viewMode === 'overlay' && (
        <div className="ref-view__overlay-ctl">
          <label className="ref-view__toggle">
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => setReferenceVisible(e.target.checked)}
            />
            표시
          </label>

          <label className="ref-view__opacity">
            투명도
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opacity * 100)}
              aria-label="오버레이 투명도"
              onChange={(e) => setReferenceOpacity(Number(e.target.value) / 100)}
            />
            <span className="ref-view__opacity-value">{Math.round(opacity * 100)}%</span>
          </label>

          <label className="ref-view__fit">
            위치 맞춤
            <select value={fit} aria-label="위치 맞춤" onChange={(e) => setReferenceFit(e.target.value as ReferenceLayer['fit'])}>
              {FITS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
