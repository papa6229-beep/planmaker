/**
 * Editor top bar (WORK_PLAN Phase 7 §7.1 — 기획서 화면 상단 재구성).
 *
 * Left:  게이트로 돌아가기 · `기획서 생성` 모드 표시 · 기획서 제목 입력란
 * Right: 자동 저장 상태 · 실행 취소 · 다시 실행 · AI 요약 · 보조 메뉴 · 전달하기
 *
 * The title input is the single source of truth for the project name (shown in
 * the briefs list and gate later). `전달하기` is the Primary CTA but is NOT wired
 * in this step — WorkRequest/RequestRepository and the actual submission flow
 * are Step 7. Clicking it only surfaces an honest "다음 단계에서 연결" notice;
 * no request is created and nothing is faked. The existing `.eventbrief` file
 * actions move into the overflow (보조) menu and stay fully functional.
 */

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useEventBriefIo } from '../../features/export/useEventBriefIo'

const TITLE_COALESCE_KEY = 'project-title'
const SUBMIT_NOTICE = '요청 전달 기능은 다음 단계에서 연결됩니다.'

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function TopToolbar({ onShowSummary }: { onShowSummary: () => void }) {
  const { state, setProjectTitle, newBrief, undo, redo, canUndo, canRedo, endInteraction } = useBriefEditor()
  const { startExport, startImport, busy } = useEventBriefIo()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDetailsElement | null>(null)
  const [submitNotice, setSubmitNotice] = useState(false)
  const title = state.brief.project.title

  const closeMenu = () => {
    if (menuRef.current) menuRef.current.open = false
  }

  const handleNew = () => {
    closeMenu()
    const empty = state.brief.blocks.length === 0
    if (empty || window.confirm('현재 작업을 지우고 새 기획서를 시작할까요?')) {
      newBrief()
    }
  }

  return (
    <header className="editor-topbar">
      <div className="editor-topbar__left">
        <Link className="editor-topbar__back" to="/" aria-label="게이트로 돌아가기">
          <BackIcon />
          <span>게이트</span>
        </Link>
        <span className="editor-topbar__mode" aria-label="현재 모드">기획서 생성</span>
        <input
          className="editor-topbar__title"
          type="text"
          value={title}
          aria-label="기획서 제목"
          placeholder="기획서 제목을 입력하세요"
          disabled={busy}
          onChange={(e) => setProjectTitle(e.target.value, TITLE_COALESCE_KEY)}
          onBlur={endInteraction}
        />
      </div>

      <div className="editor-topbar__right">
        <span className="editor-topbar__status" title="편집 상태는 IndexedDB에 자동저장됩니다">
          저장: 로컬 자동저장
        </span>
        <span className="editor-topbar__divider" aria-hidden="true" />

        <nav className="editor-topbar__actions" aria-label="주요 작업">
          <button type="button" className="btn" onClick={undo} disabled={!canUndo || busy} title="실행 취소 (Ctrl+Z)">실행 취소</button>
          <button type="button" className="btn" onClick={redo} disabled={!canRedo || busy} title="다시 실행 (Ctrl+Shift+Z)">다시 실행</button>
          <button type="button" className="btn" onClick={onShowSummary} disabled={busy} title="이미지 생성 AI가 읽는 정보 미리보기">AI 요약</button>

          <details className="editor-topbar__menu" ref={menuRef}>
            <summary className="btn editor-topbar__menu-trigger">보조 메뉴</summary>
            <div className="editor-topbar__menu-panel" aria-label="파일 보조 메뉴">
              <button
                type="button"
                className="editor-topbar__menu-item"
                onClick={() => { closeMenu(); void startExport() }}
                disabled={busy}
              >
                파일로 저장 (.eventbrief)
              </button>
              <button
                type="button"
                className="editor-topbar__menu-item"
                onClick={() => { closeMenu(); importInputRef.current?.click() }}
                disabled={busy}
              >
                파일 불러오기
              </button>
              <button
                type="button"
                className="editor-topbar__menu-item"
                onClick={handleNew}
                disabled={busy}
              >
                새로 만들기
              </button>
            </div>
          </details>
        </nav>

        <div className="editor-topbar__submit">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setSubmitNotice(true)}
            aria-describedby="editor-topbar-submit-hint"
          >
            전달하기
          </button>
          <p id="editor-topbar-submit-hint" className="editor-topbar__submit-hint" role="status">
            {submitNotice ? SUBMIT_NOTICE : '다음 단계 연결 예정'}
          </p>
        </div>

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
      </div>
    </header>
  )
}
