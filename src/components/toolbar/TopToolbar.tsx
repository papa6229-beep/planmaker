/**
 * Top toolbar (WORK_PLAN §6). "새로 만들기", undo/redo, AI 요약, and — from
 * Phase 6 — 기획서 내보내기 / 불러오기 are functional. Actions that belong to
 * later phases stay clearly disabled. Buttons are locked while an import/export
 * is in progress to prevent duplicate runs (§6, §8).
 */

import { useRef } from 'react'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useEventBriefIo } from '../../features/export/useEventBriefIo'

export function TopToolbar({ onShowSummary }: { onShowSummary: () => void }) {
  const { state, newBrief, undo, redo, canUndo, canRedo } = useBriefEditor()
  const { startExport, startImport, busy } = useEventBriefIo()
  const importInputRef = useRef<HTMLInputElement | null>(null)
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
        <button type="button" className="btn" onClick={handleNew} disabled={busy}>새로 만들기</button>
        <button type="button" className="btn" onClick={undo} disabled={!canUndo || busy} title="실행 취소 (Ctrl+Z)">실행 취소</button>
        <button type="button" className="btn" onClick={redo} disabled={!canRedo || busy} title="다시 실행 (Ctrl+Shift+Z)">다시 실행</button>
        <span className="toolbar__divider" aria-hidden="true" />
        <button type="button" className="btn" onClick={onShowSummary} disabled={busy} title="이미지 생성 AI가 읽는 정보 미리보기">AI 요약</button>
        <button
          type="button"
          className="btn"
          onClick={() => importInputRef.current?.click()}
          disabled={busy}
        >
          기획서 불러오기
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void startExport()} disabled={busy}>
          기획서 내보내기
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".eventbrief,application/zip"
          className="toolbar__file-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void startImport(file)
            e.target.value = ''
          }}
        />
      </nav>

      <span className="toolbar__status" title="편집 상태는 IndexedDB에 자동저장됩니다">
        저장: 로컬 자동저장
      </span>
    </header>
  )
}
