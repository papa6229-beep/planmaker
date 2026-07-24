/**
 * Side-by-side reference viewer (WORK_PLAN §8.3 나란히 보기). Shows the page's
 * reference image next to the canvas with its own scroll and zoom, plus a
 * "원본 비율 맞춤" reset. Zoom here is pure view state — never saved to the
 * document (consistent with the canvas zoom principle).
 */

import { useState } from 'react'
import { useAssets } from '../../features/assets/useAssets'
import { useBriefDocument } from '../../features/document/useBriefDocument'

const MIN = 0.25
const MAX = 4
const STEP = 0.25

export function ReferenceSideView() {
  const { activeReference } = useBriefDocument()
  const { getUrl } = useAssets()
  const url = getUrl(activeReference.assetId)
  const [zoom, setZoom] = useState(1)

  const clamp = (z: number) => Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100))

  return (
    <aside className="ref-side" aria-label="참고 이미지 뷰어">
      <div className="ref-side__bar">
        <span className="ref-side__label">참고 이미지</span>
        <div className="ref-side__zoom">
          <button type="button" className="btn" aria-label="축소" onClick={() => setZoom((z) => clamp(z - STEP))}>−</button>
          <span className="ref-side__zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn" aria-label="확대" onClick={() => setZoom((z) => clamp(z + STEP))}>+</button>
          <button type="button" className="btn" onClick={() => setZoom(1)}>원본 비율 맞춤</button>
        </div>
      </div>
      <div className="ref-side__viewer">
        {url ? (
          <img className="ref-side__img" src={url} alt="참고 이미지" style={{ width: `${zoom * 100}%` }} />
        ) : (
          <p className="ref-side__empty">참고 이미지를 추가하세요.</p>
        )}
      </div>
    </aside>
  )
}
