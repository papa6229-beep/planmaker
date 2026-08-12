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
import { PanelFold } from '../studio/PanelFold'
import { useInstructionRefine } from '../../features/studio/useInstructionRefine'
import { REFINE_COST_NOTE } from '../../domain/instructionRefine'

/** 작성자가 남기는 부탁. 기획서의 일부라 파일을 따라 작업판까지 간다. */
export function DesignerNoteField() {
  const { designerNote, setDesignerNote } = useBriefDocument()

  return (
    <PanelFold
      id="designer-note"
      title="디자인팀에게 전달할 말"
      note="원하는 분위기·컨셉·부탁"
      marked={designerNote.trim().length > 0}
    >
      <p className="concept__hint">원하는 분위기와 컨셉, 작업하는 사람이 알아야 할 부탁을 적어주세요.</p>
      <textarea
        id="designer-note-input"
        aria-label="디자인팀에게 전달할 말"
        className="concept__input"
        rows={3}
        placeholder="예: 단정하고 신뢰감 있게 / 이 문구는 반드시 강조해 주세요 / 제품이 너무 작아 보이지 않게"
        value={designerNote}
        onChange={(e) => setDesignerNote(e.target.value)}
      />
      <p className="concept__note">이미지에 인쇄되지 않습니다. 디자인팀에게 그대로 전달됩니다.</p>
    </PanelFold>
  )
}

/**
 * 팀 안에서만 읽는 말 (팀 메모 Patch).
 *
 * 팀장이 팀원에게 남기는 수정 사항이다. 앞의 것과 **받는 사람이 다르다** —
 * 디자인팀에게 가는 부탁도, AI에게 주는 지시도 아니라 같은 팀끼리 보는 쪽지다.
 * 그래서 생성 요청에도, 이미지에도 실리지 않는다.
 *
 * 기획서의 일부이므로 자동저장되고 파일을 따라간다. 그러지 않으면 지적을 받은
 * 팀원이 파일을 열었을 때 그 지적이 없다.
 */
export function TeamNoteField() {
  const { teamNote, setTeamNote } = useBriefDocument()

  return (
    <PanelFold
      id="team-note"
      title="팀 내부 메모"
      note="우리 팀만 봅니다"
      marked={teamNote.trim().length > 0}
    >
      <p className="concept__hint">팀장이 팀원에게 남기는 수정 사항을 적어주세요.</p>
      <textarea
        id="team-note-input"
        aria-label="팀 내부 메모"
        className="concept__input"
        rows={3}
        placeholder="예: 가격 문구를 8월 기준으로 고쳐 주세요 / 상단 배너는 지난 건 그대로 씁니다"
        value={teamNote}
        onChange={(e) => setTeamNote(e.target.value)}
      />
      <p className="concept__note">
        <b>우리 팀만 봅니다.</b> 이미지에 인쇄되지 않고, 디자인팀 전달사항이나 AI 지시에도 실리지 않습니다.
      </p>
    </PanelFold>
  )
}

/**
 * 작업판에서만: AI에게 줄 지시를 적는다.
 *
 * 작업판에서 작업자가 **편집하는** 지시 입력창은 이것 하나뿐이다 (실작업 UI 마감
 * §2.3). 기획서에서 온 말(컨셉·전달사항)은 고칠 것이 아니라 읽을 것이므로 다른
 * 칸이 맡는다 — `BriefHandoff`가 팔레트 위에서 읽기 전용으로 보여 준다 (전달 누락
 * Patch). 앞선 판은 전달사항만 이 칸이 인용했고, 그래서 컨셉은 어디에도 없었고
 * 전달사항은 팔레트 아래에 파묻혀 있었다.
 */
export function AiNoteField() {
  const { aiNote, setAiNote } = useBriefDocument()

  return (
    <>
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
          {/* 제안이 길어도 두 버튼은 제자리에 남는다 — 읽는 부분만 흐른다
              (손검수 Patch 1-B §7). */}
          <div className="refine__scroll">
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
          </div>
          <div className="refine__actions">
            <button type="button" className="btn" onClick={refine.dismissNote}>취소</button>
            <button type="button" className="btn btn--primary" onClick={refine.applyNote}>이 지시 적용</button>
          </div>
        </section>
      )}
    </div>
  )
}
