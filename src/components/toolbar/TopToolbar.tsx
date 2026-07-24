/**
 * Editor top bar (WORK_PLAN Phase 7 §7.1). In 기획서 생성 mode it carries the
 * primary 전달하기 CTA; in 이미지 생성 mode (a request work page, §13.2) the mode
 * label changes and the CTA is replaced by the request's status panel.
 *
 * Step 7 wires 전달하기: it validates the title, snapshots the current
 * multi-page document, and creates a submitted WorkRequest that shows up in the
 * image-generation queue. The `.eventbrief` file actions stay in the overflow
 * (보조) menu.
 */

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useEventBriefIo } from '../../features/export/useEventBriefIo'
import { useRequests } from '../../features/requests/useRequests'

const TITLE_COALESCE_KEY = 'project-title'

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function TopToolbar({ mode = 'brief', onShowSummary }: { mode?: 'brief' | 'image'; onShowSummary: () => void }) {
  const { state, setProjectTitle, newBrief, undo, redo, canUndo, canRedo, endInteraction } = useBriefEditor()
  const { getDocument } = useBriefDocument()
  const { startExport, startImport, busy } = useEventBriefIo()
  const { submit } = useRequests()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDetailsElement | null>(null)
  const [notice, setNotice] = useState('')
  const [delivered, setDelivered] = useState(false)
  const [submitting, setSubmitting] = useState(false)
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

  const handleSubmit = async () => {
    const doc = getDocument()
    if (!doc.project.title.trim()) {
      setDelivered(false)
      setNotice('기획서 제목을 입력해야 전달할 수 있습니다.')
      titleRef.current?.focus()
      return
    }
    if (!doc.pages.some((p) => p.blocks.length > 0)) {
      setDelivered(false)
      setNotice('내용이 있는 블록을 추가한 뒤 전달하세요.')
      return
    }
    setSubmitting(true)
    try {
      await submit(doc, new Date().toISOString())
      setDelivered(true)
      setNotice('요청이 이미지 생성 목록에 전달되었습니다.')
    } catch {
      setDelivered(false)
      setNotice('전달에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <header className="editor-topbar">
      <div className="editor-topbar__left">
        <Link className="editor-topbar__back" to={mode === 'image' ? '/image-requests' : '/'} aria-label={mode === 'image' ? '요청 목록으로 돌아가기' : '게이트로 돌아가기'}>
          <BackIcon />
          <span>{mode === 'image' ? '요청 목록' : '게이트'}</span>
        </Link>
        <span className={`editor-topbar__mode${mode === 'image' ? ' editor-topbar__mode--image' : ''}`} aria-label="현재 모드">{mode === 'image' ? '이미지 생성' : '기획서 생성'}</span>
        <input
          ref={titleRef}
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

        {mode === 'brief' && (
          <div className="editor-topbar__submit">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleSubmit()}
              disabled={submitting || busy}
              aria-describedby="editor-topbar-submit-hint"
            >
              전달하기
            </button>
            <p id="editor-topbar-submit-hint" className="editor-topbar__submit-hint" role="status">
              {notice || '이미지 생성 요청으로 전달합니다.'}
              {delivered && (
                <>
                  {' '}
                  <Link to="/image-requests">목록 보기</Link>
                </>
              )}
            </p>
          </div>
        )}

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
