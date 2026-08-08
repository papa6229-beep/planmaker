/**
 * 원하는 분위기·컨셉 (§5, 자유 저장 §4).
 *
 * How the whole page should feel — "여름 바다처럼 시원하고 밝게", "할인율이 강하게
 * 보이게". It belongs to the document, not to a spot on the canvas, so it is a
 * field in the left column beneath the three tools rather than a draggable
 * block. It reaches the AI as a non-printing instruction, never as copy to
 * render, and it is optional: an empty one is an ordinary brief.
 *
 * What it writes is the same `project.concept` it has always written. Only the
 * place a planner types it has changed — from a collapsed line above the canvas
 * that was easy to miss, to a field that is always on screen.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import { PanelFold } from '../studio/PanelFold'

export function ConceptField() {
  const { concept, setConcept } = useBriefDocument()

  return (
    <PanelFold
      id="concept"
      title="원하는 분위기·컨셉"
      note="기획서 전체에 적용할 느낌"
      marked={concept.trim().length > 0}
    >
      <label className="concept__hint" htmlFor="concept-input">
        기획서 전체에 적용할 느낌을 자유롭게 적어주세요.
      </label>
      <textarea
        id="concept-input"
        aria-label="원하는 분위기·컨셉"
        className="concept__input"
        rows={4}
        placeholder="예: 밝고 경쾌한 여름 할인 분위기, 민트와 흰색 중심"
        value={concept}
        onChange={(e) => setConcept(e.target.value)}
      />
      <p className="concept__note">이미지에 인쇄되지 않습니다. AI와 디자인팀에게 전달되는 방향입니다.</p>
    </PanelFold>
  )
}
