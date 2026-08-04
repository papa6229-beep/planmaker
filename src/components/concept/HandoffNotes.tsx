/**
 * 사람에게 부탁하는 말과 AI에게 부탁하는 말 (첫 사용 흐름 §6).
 *
 * 컨셉 입력란 바로 아래에 붙는다. 셋은 서로 다른 값이다.
 *
 *  - 원하는 분위기·컨셉 — 이 기획서가 어떤 느낌이어야 하는가
 *  - 디자인팀에게 전달할 말 — 기획서를 쓴 사람이 작업자에게 하는 부탁
 *  - AI에게 추가로 전달할 말 — 작업판에서 작업자가 AI에게 더 붙이는 지시
 *
 * 이 빌드는 타 팀 작성기다. 그래서 여기에는 앞의 둘만 있고, `AI에게 추가로
 * 전달할 말`을 적는 자리는 없다 — 그 말은 디자인팀 작업자가 자기 화면에서 적는
 * 것이다. 값(`Project.aiNote`)은 기획서 스키마에 그대로 남아 있어, 작업자가
 * 저장한 파일이 이쪽을 오가도 잘리지 않는다.
 *
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
