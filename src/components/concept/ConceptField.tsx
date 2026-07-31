/**
 * 전체 컨셉 (§5).
 *
 * How the whole page should feel — "여름 바다처럼 시원하고 밝게", "할인율이 강하게
 * 보이게". It belongs to the document, not to a spot on the canvas, so it is a
 * single collapsed line under the title rather than a draggable block. It
 * reaches the AI as a non-printing instruction, never as copy to render.
 */

import { useEffect, useRef, useState } from 'react'
import { useBriefDocument } from '../../features/document/useBriefDocument'

export function ConceptField() {
  const { concept, setConcept } = useBriefDocument()
  const [open, setOpen] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (open) areaRef.current?.focus()
  }, [open])

  const summary = concept.trim()

  return (
    <section className="concept" aria-label="전체 컨셉">
      {open ? (
        <>
          <label className="concept__label" htmlFor="concept-input">
            전체 컨셉 — 이 페이지 전체를 어떤 느낌으로 만들까요?
          </label>
          <textarea
            id="concept-input"
            ref={areaRef}
            className="concept__input"
            rows={2}
            placeholder="예: 여름 바다처럼 시원하고 밝게, 할인율이 강하게 보이도록"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          <p className="concept__note">이미지에 인쇄되지 않습니다. AI와 디자인팀에게 전달되는 방향입니다.</p>
        </>
      ) : (
        <button type="button" className="concept__toggle" onClick={() => setOpen(true)}>
          <span className="concept__toggle-label">전체 컨셉</span>
          <span className={`concept__toggle-value${summary ? '' : ' is-empty'}`}>
            {summary || '이 페이지 전체를 어떤 느낌으로 만들까요? (선택)'}
          </span>
        </button>
      )}
    </section>
  )
}
