/**
 * 사람에게 부탁하는 말과 AI에게 부탁하는 말 (첫 사용 흐름 §6).
 *
 * 컨셉 입력란 바로 아래에 붙는다. 셋은 서로 다른 값이다.
 *
 *  - 원하는 분위기·컨셉 — 이 기획서가 어떤 느낌이어야 하는가
 *  - 디자인팀에게 전달할 말 — 기획서를 쓴 사람이 작업자에게 하는 부탁
 *  - AI에게 추가로 전달할 말 — 작업판에서 작업자가 AI에게 더 붙이는 지시
 *
 * 작성기에는 앞의 둘만, 작업판에는 셋 다 보이되 작성자의 부탁은 읽기 전용으로
 * 보여 준다 — 작업자가 그 말을 고쳐 쓰면 작성자가 한 말이 사라지기 때문이다.
 * 어느 것도 이미지에 인쇄되지 않는다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'

/** 작성자가 남기는 부탁. 기획서의 일부라 파일을 따라 작업판까지 간다. */
export function DesignerNoteField() {
  const { designerNote, setDesignerNote } = useBriefDocument()

  return (
    <section className="concept">
      <label className="concept__title" htmlFor="designer-note-input">디자인팀에게 전달할 말</label>
      <p className="concept__hint">작업하는 사람이 알아야 할 부탁을 적어주세요.</p>
      <textarea
        id="designer-note-input"
        className="concept__input"
        rows={3}
        placeholder="예: 이 문구는 반드시 강조해 주세요 / 제품이 너무 작아 보이지 않게 해 주세요"
        value={designerNote}
        onChange={(e) => setDesignerNote(e.target.value)}
      />
      <p className="concept__note">이미지에 인쇄되지 않습니다. 디자인팀에게 그대로 전달됩니다.</p>
    </section>
  )
}

/** 작업판에서만: 작성자의 부탁을 읽고, AI에게 줄 지시를 따로 적는다. */
export function AiNoteField() {
  const { designerNote, aiNote, setAiNote } = useBriefDocument()

  return (
    <>
      <section className="concept concept--readonly" aria-label="작성자가 전달한 말">
        <h2 className="concept__title">작성자가 전달한 말</h2>
        {designerNote.trim().length === 0 ? (
          <p className="concept__note">작성자가 남긴 말이 없습니다.</p>
        ) : (
          <p className="concept__quote">{designerNote}</p>
        )}
      </section>

      <section className="concept">
        <label className="concept__title" htmlFor="ai-note-input">AI에게 추가로 전달할 말</label>
        <p className="concept__hint">작업하면서 AI에게 더 붙일 지시를 적어주세요.</p>
        <textarea
          id="ai-note-input"
          className="concept__input"
          rows={3}
          placeholder="예: 하단에는 그라데이션을 꼭 넣어 주세요 / 메인 문구의 대비를 강하게 해 주세요"
          value={aiNote}
          onChange={(e) => setAiNote(e.target.value)}
        />
        <p className="concept__note">이미지에 인쇄되지 않습니다. 작성자의 전달 메모와 별도로 전달됩니다.</p>
      </section>
    </>
  )
}
