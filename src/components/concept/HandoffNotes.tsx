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
import { useInstructionRefine } from '../../features/studio/useInstructionRefine'
import { REFINE_COST_NOTE } from '../../domain/instructionRefine'

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

/**
 * 작업판에서만: 기획서가 지니고 온 부탁을 읽고, AI에게 줄 지시를 따로 적는다.
 *
 * 작성자가 남긴 말은 기획서 원문이므로 지우지도 고치지도 않는다. 다만 남긴 말이
 * 없을 때는 자리 자체를 비운다 — "없습니다"라는 한 줄도 왼쪽에서는 자리를
 * 차지하고, 작업자가 읽어야 할 것은 있을 때만 있으면 된다 (실작업 UI 마감 §2.2).
 *
 * 작업판에서 작업자가 편집하는 지시 입력창은 아래 하나뿐이다 (§2.3).
 */
export function AiNoteField() {
  const { designerNote, aiNote, setAiNote } = useBriefDocument()
  const handoff = designerNote.trim()

  return (
    <>
      {handoff.length > 0 && (
        <section className="concept concept--readonly" aria-label="기획서 전달사항">
          <h2 className="concept__title">기획서 전달사항</h2>
          <p className="concept__quote">{handoff}</p>
        </section>
      )}

      <section className="concept">
        <label className="concept__title" htmlFor="ai-note-input">AI에게 추가로 전달할 말</label>
        <p className="concept__hint">현재 작업에서 AI가 추가로 지켜야 할 내용을 적어 주세요.</p>
        <textarea
          id="ai-note-input"
          className="concept__input"
          rows={3}
          placeholder="예: 하단에는 그라데이션을 꼭 넣어 주세요 / 메인 문구의 대비를 강하게 해 주세요"
          value={aiNote}
          onChange={(e) => setAiNote(e.target.value)}
        />
        <p className="concept__note">이미지에 인쇄되지 않습니다. 기획서 전달사항과 별도로 전달됩니다.</p>
        <RefineNoteAction />
      </section>
    </>
  )
}

/**
 * 거친 말을 실행 가능한 지시로 (실작업 UI 마감 §9).
 *
 * 결과가 사람의 글을 대신 덮어쓰지 않는다. 원문과 제안을 나란히 두고, 적용은
 * 사람이 누른다 — 그래야 "AI가 내 말을 바꿔 놨다"가 일어나지 않는다.
 */
function RefineNoteAction() {
  const refine = useInstructionRefine()
  if (refine === null) return null

  return (
    <div className="refine">
      <div className="refine__actions">
        <button
          type="button"
          className="btn"
          disabled={!refine.canRefineNote}
          onClick={refine.refineNote}
          title="지금 적은 말을 실행 가능한 지시로 다듬습니다"
        >
          {refine.noteBusy ? '다듬는 중…' : 'AI로 지시 다듬기'}
        </button>
      </div>
      <p className="refine__cost">{REFINE_COST_NOTE}</p>

      {refine.noteError !== null && (
        <p className="refine__error" role="status">{refine.noteError}</p>
      )}

      {refine.noteProposal !== null && (
        <section className="refine__proposal" aria-label="다듬은 지시 제안">
          <p className="refine__label">기존 지시</p>
          <p className="refine__text refine__text--old">{refine.noteProposal.original}</p>
          <p className="refine__label">AI가 다듬은 지시</p>
          <p className="refine__text">{refine.noteProposal.revised}</p>
          {refine.noteProposal.warnings.length > 0 && (
            <ul className="refine__warnings">
              {refine.noteProposal.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="refine__actions">
            <button type="button" className="btn" onClick={refine.dismissNote}>취소</button>
            <button type="button" className="btn btn--primary" onClick={refine.applyNote}>이 지시 적용</button>
          </div>
        </section>
      )}
    </div>
  )
}
