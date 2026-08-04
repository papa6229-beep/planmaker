/**
 * Editor top bar (WORK_PLAN Phase 7 §7.1). In 기획서 생성 mode it carries the
 * primary 전달하기 CTA; in 이미지 생성 mode (a request work page, §13.2) the mode
 * label changes and the CTA is replaced by the request's status panel.
 *
 * Step 7 wires 전달하기: it names the brief, snapshots the current multi-page
 * document, and creates a submitted WorkRequest that shows up in the
 * image-generation queue.
 *
 * Saving to and loading from a `.eventbrief` file are ordinary, frequent
 * actions, so they sit in the bar itself. Saving asks what to call the file
 * first — a folder full of "새 기획서.eventbrief" helps nobody — and the name
 * chosen there never touches the brief's own title (v1 마감 §4).
 *
 * There is no 보조 메뉴: what was left in it (새로 만들기) is the 새 기획서 button
 * in 내 기획서, and one way in is enough (v1 마감 §5).
 */

import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useEventBriefIo } from '../../features/export/useEventBriefIo'
import { DeliverAction } from './DeliverAction'
import { isRequestTeam, REQUEST_TEAMS, teamLabel, type RequestTeam } from '../../domain/requestTeam'
import { EVENTBRIEF_EXTENSION, eventBriefFileName, FALLBACK_FILE_NAME } from '../../features/export/exportFileName'
import { useAppSurface } from '../../app/AppSurfaceContext'
import { clearSelectedTeam, selectedTeam } from '../../features/team/teamSession'

const TITLE_COALESCE_KEY = 'project-title'

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function TopToolbar({ mode = 'brief', onShowSummary }: { mode?: 'brief' | 'image'; onShowSummary: () => void }) {
  const surface = useAppSurface()
  const { state, setProjectTitle, undo, redo, canUndo, canRedo, endInteraction } = useBriefEditor()
  const { undoPageDelete, requestTeam, setRequestTeam, saveNow } = useBriefDocument()
  const { state: ioState, startExport, startImport, busy } = useEventBriefIo()
  const navigate = useNavigate()
  // 게이트에서 고른 팀. 편집 화면에서는 보여만 주고 바꾸지 않는다 — 여기서 팀을
  // 갈아 끼우면 남의 팀 목록으로 기획서가 넘어가는 우회로가 된다 (§4).
  const gateTeam = surface === 'brief-writer' ? selectedTeam() : null

  /** 팀 변경: 지금 작업을 저장한 뒤 게이트로 돌아간다. */
  const changeTeam = async () => {
    try {
      await saveNow()
    } catch {
      // 저장하지 못했더라도 게이트로는 갈 수 있어야 한다; 자동저장이 마지막
      // 상태를 이미 갖고 있고, 여기서 막으면 팀을 영영 못 바꾼다.
    }
    clearSelectedTeam()
    navigate('/', { replace: true })
  }
  /**
   * Page structure is not part of the editor's history, so a just-deleted page
   * is restored from the document's own snapshot; everything else undoes
   * through the editor as before (손검수 2 §4.2).
   */
  const undoLast = () => {
    if (undoPageDelete !== null) undoPageDelete()
    else undo()
  }
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  // 파일로 저장 asks for a name first; `naming` is that small dialog.
  const [naming, setNaming] = useState(false)
  const [fileName, setFileName] = useState('')
  const title = state.brief.project.title

  const saveFile = () => {
    setNaming(false)
    void startExport(eventBriefFileName(fileName))
  }

  return (
    <header className="editor-topbar">
      <div className="editor-topbar__left">
        {/* A planner writing a brief has nowhere else to be, so there is no way
            back to the feature gate here. The image-generation screen is a
            queue item and still returns to its list (v1 마감 §10). */}
        {mode === 'image' && (
          <Link className="editor-topbar__back" to="/image-requests" aria-label="요청 목록으로 돌아가기">
            <BackIcon />
            <span>요청 목록</span>
          </Link>
        )}
        <span className={`editor-topbar__mode${mode === 'image' ? ' editor-topbar__mode--image' : ''}`} aria-label="현재 모드">{mode === 'image' ? '이미지 생성' : '기획서 생성'}</span>
        {gateTeam === null ? (
          <select
            className="field__input editor-topbar__team"
            aria-label="작성팀"
            value={isRequestTeam(requestTeam) ? requestTeam : ''}
            disabled={busy}
            onChange={(e) => setRequestTeam(e.target.value === '' ? undefined : (e.target.value as RequestTeam))}
          >
            <option value="">{teamLabel(isRequestTeam(requestTeam) ? undefined : requestTeam)}</option>
            {REQUEST_TEAMS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        ) : (
          <>
            <span className="editor-topbar__team-label" aria-label="작성팀">{teamLabel(requestTeam)}</span>
            <button
              type="button"
              className="btn editor-topbar__team-change"
              disabled={busy}
              onClick={() => void changeTeam()}
              title="지금 작업을 저장하고 팀 선택 화면으로 돌아갑니다"
            >
              팀 변경
            </button>
          </>
        )}
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
          <button
            type="button"
            className="btn"
            onClick={undoLast}
            disabled={(!canUndo && undoPageDelete === null) || busy}
            title="실행 취소 (Ctrl+Z)"
          >
            실행 취소
          </button>
          <button type="button" className="btn" onClick={redo} disabled={!canRedo || busy} title="다시 실행 (Ctrl+Shift+Z)">다시 실행</button>
          <button type="button" className="btn" onClick={onShowSummary} disabled={busy} title="이미지 생성 AI가 읽는 정보 미리보기">AI 요약</button>

          <button
            type="button"
            className="btn"
            onClick={() => importInputRef.current?.click()}
            disabled={busy}
            title=".eventbrief 파일에서 기획서를 불러옵니다"
          >
            파일 불러오기
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFileName(title.trim() || FALLBACK_FILE_NAME)
              setNaming(true)
            }}
            disabled={busy}
            title="이름을 정해 .eventbrief 파일로 저장합니다"
          >
            파일로 저장
          </button>
          <span className="editor-topbar__io-note" aria-live="polite">
            {ioState.kind === 'exported' ? '기획서 파일을 저장했습니다' : ''}
          </span>
          {/* Said once, where the file is made — not repeated in a popup or a
              toast elsewhere (타 팀 배포 §4.5). */}
          {surface === 'brief-writer' && mode === 'brief' && (
            <span className="editor-topbar__handoff">
              작성이 끝나면 파일로 저장해 사내 메신저로 디자인팀에 보내 주세요.
            </span>
          )}

        </nav>

        {/* Handing work to the internal queue exists only on the studio
            surface; the brief writer other teams use sends files by hand. */}
        {mode === 'brief' && surface === 'studio' && (
          <DeliverAction disabled={busy} onNeedTitle={() => titleRef.current?.focus()} />
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

      {naming && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setNaming(false)}>
          <div
            className="confirm save-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="기획서 파일로 저장"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="save-dialog__title">기획서 파일로 저장</h2>
            <label className="save-dialog__field">
              <span className="save-dialog__label">파일명</span>
              <span className="save-dialog__row">
                <input
                  className="field__input save-dialog__input"
                  type="text"
                  autoFocus
                  aria-label="파일명"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveFile()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setNaming(false)
                    }
                  }}
                />
                {/* The extension is fixed, so it is shown rather than typed. */}
                <span className="save-dialog__ext">{EVENTBRIEF_EXTENSION}</span>
              </span>
            </label>
            <div className="confirm__actions">
              <button type="button" className="btn" onClick={() => setNaming(false)}>취소</button>
              <button type="button" className="btn btn--primary" onClick={saveFile}>저장</button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
