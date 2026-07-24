/**
 * Top toolbar (WORK_PLAN §6). "새로 만들기" is fully functional (resets the
 * brief). Actions that belong to later phases are rendered as clearly disabled
 * "준비 중" controls — never fake buttons that pretend to work (Phase 2 §3).
 */

import { useBriefEditor } from '../../features/editor/useBriefEditor'

export function TopToolbar({ onShowSummary }: { onShowSummary: () => void }) {
  const { state, newBrief, undo, redo, canUndo, canRedo } = useBriefEditor()
  const title = state.brief.project.title.trim() || 'Event Brief Builder'

  const handleNew = () => {
    const empty = state.brief.blocks.length === 0
    if (empty || window.confirm('현재 작업을 지우고 새 기획서를 시작할까요?')) {
      newBrief()
    }
  }

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__logo">Event Brief Builder</span>
        <span className="toolbar__project" title={title}>{title}</span>
      </div>

      <nav className="toolbar__actions" aria-label="주요 작업">
        <button type="button" className="btn" onClick={handleNew}>새로 만들기</button>
        <button type="button" className="btn" onClick={undo} disabled={!canUndo} title="실행 취소 (Ctrl+Z)">실행 취소</button>
        <button type="button" className="btn" onClick={redo} disabled={!canRedo} title="다시 실행 (Ctrl+Shift+Z)">다시 실행</button>
        <span className="toolbar__divider" aria-hidden="true" />
        <button type="button" className="btn" onClick={onShowSummary} title="이미지 생성 AI가 읽는 정보 미리보기">AI 요약</button>
        <button type="button" className="btn" disabled title="Phase 6에서 지원">미리보기</button>
        <button type="button" className="btn" disabled title="Phase 6에서 지원">기획서 내보내기</button>
      </nav>

      <span className="toolbar__status" title="로컬 자동저장은 Phase 6에서 지원됩니다">
        저장: 미저장 (준비 중)
      </span>
    </header>
  )
}
