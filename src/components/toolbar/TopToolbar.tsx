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

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useEventBriefIo } from '../../features/export/useEventBriefIo'
import { DeliverAction } from './DeliverAction'
import { isRequestTeam, REQUEST_TEAMS, teamLabel, type RequestTeam } from '../../domain/requestTeam'
import { EVENTBRIEF_EXTENSION, eventBriefFileName, FALLBACK_FILE_NAME } from '../../features/export/exportFileName'
import { useAppSurface } from '../../app/AppSurfaceContext'
import { clearSelectedTeam, selectedTeam } from '../../features/team/teamSession'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { countStudioStorage, resetStudioStorage, type StorageCount } from '../../services/storageReset'
import { useImageSave } from '../../features/studio/useImageSave'
import { saveHealth, subscribeSaveHealth } from '../../services/saveHealthStore'
import { saveStatus } from '../../domain/saveHealth'

const TITLE_COALESCE_KEY = 'project-title'

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function TopToolbar({
  mode = 'brief',
  onShowSummary,
  onShowGenerationRequest,
}: {
  mode?: 'brief' | 'image' | 'studio'
  onShowSummary: () => void
  /** 이미지 생성기 작업판에서만 — GPT 제작 요청을 사람이 먼저 읽는다. */
  onShowGenerationRequest?: () => void
}) {
  const surface = useAppSurface()
  const { state, setProjectTitle, undo, redo, canUndo, canRedo, endInteraction } = useBriefEditor()
  const studio = useStudioJob()
  /**
   * 편집기의 마지막 변경 시각. 작업판에서는 문서 편집과 제품 이미지 연결이 서로
   * 다른 히스토리에 쌓이므로, 실행 취소는 둘 중 **나중에 일어난 쪽**을 되돌린다.
   */
  const editorChangedAt = useRef(0)
  const lastBrief = useRef(state.brief)
  if (lastBrief.current !== state.brief) {
    lastBrief.current = state.brief
    editorChangedAt.current = Date.now()
  }
  const studioIsNewer = studio !== null && studio.lastChangeAt > editorChangedAt.current
  const { undoPageDelete, requestTeam, setRequestTeam, activePageId } = useBriefDocument()
  const { state: ioState, startExport, startImport, busy } = useEventBriefIo()
  const { saveNow } = useBriefDocument()
  const navigate = useNavigate()
  // 게이트에서 고른 팀. 편집 화면에서는 보여만 주고 바꾸지 않는다 — 여기서 팀을
  // 갈아 끼우면 남의 팀 목록으로 기획서가 넘어가는 우회로가 된다 (§4).
  const gateTeam = surface === 'brief-writer' ? selectedTeam() : null
  const [studioWipe, setStudioWipe] = useState<StorageCount | null>(null)
  // 실제 생성은 작업판에만 있다. 작성기 표면에는 provider 자체가 없으므로 `null`.
  const generation = useImageGeneration()
  const [keyPanel, setKeyPanel] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  // 만든 이미지를 내놓는 일. 작업판 밖에서는 `null`이다.
  const imageSave = useImageSave()
  const studioMode = mode === 'studio'
  // 저장이 실제로 되고 있는가. provider 밖의 모듈이므로 화면 구조와 무관하다.
  const status = saveStatus(useSyncExternalStore(subscribeSaveHealth, saveHealth, saveHealth))
  const [workMenu, setWorkMenu] = useState(false)
  const workMenuRef = useRef<HTMLDivElement | null>(null)

  // 메뉴 밖을 누르면 닫힌다. 열어 둔 메뉴가 화면을 가린 채 남지 않도록.
  useEffect(() => {
    if (!workMenu) return
    const onDown = (e: MouseEvent) => {
      if (!workMenuRef.current?.contains(e.target as Node)) setWorkMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [workMenu])

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
  /**
   * 되돌린 뒤 결과를 다시 합친다 (결과 되돌리기 Patch).
   *
   * 결과는 그려 둔 PNG 한 장이다. 오브젝트의 자리를 되돌려도 그 장은 되돌아온
   * 자리를 모르므로, 되돌린 값으로 한 번 더 그려야 화면이 사실이 된다. 외부
   * 호출은 없다.
   */
  const settleStudio = () => {
    if (activePageId.length > 0) void generation?.recomposePage(activePageId)
  }
  const undoLast = () => {
    if (studio !== null && studio.canUndo && studioIsNewer) {
      studio.undo()
      settleStudio()
    } else if (undoPageDelete !== null) undoPageDelete()
    else undo()
  }
  const redoLast = () => {
    if (studio !== null && studio.canRedo && !canRedo) {
      studio.redo()
      settleStudio()
    } else redo()
  }
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  // 파일로 저장 asks for a name first; `naming` is that small dialog.
  /** 이 작업에 만들어 둔 완성본이 몇 장인가. 없으면 알릴 것이 없다. */
  const madeCount = Object.keys(studio?.job.results ?? {}).length
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
        <span
          className={`editor-topbar__mode${mode === 'brief' ? '' : ' editor-topbar__mode--image'}`}
          aria-label="현재 모드"
        >
          {mode === 'image' ? '이미지 생성' : mode === 'studio' ? '이미지 생성기' : '기획서 생성'}
        </span>
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
        {/* 이 자리는 오래도록 **문구**였다 — 저장이 실패해도 "로컬 자동저장"이
            그대로 있었다. 이제 상태를 읽는다 (저장 실패 알리기 Patch). */}
        <span
          className={`editor-topbar__status${status.failed ? ' editor-topbar__status--failed' : ''}`}
          title={status.detail}
          role={status.failed ? 'alert' : undefined}
        >
          {status.text}
        </span>
        <span className="editor-topbar__divider" aria-hidden="true" />

        <nav className="editor-topbar__actions" aria-label="주요 작업">
          <button
            type="button"
            className="btn"
            onClick={undoLast}
            disabled={(!canUndo && undoPageDelete === null && !(studio?.canUndo ?? false)) || busy}
            title="실행 취소 (Ctrl+Z)"
          >
            실행 취소
          </button>
          <button
            type="button"
            className="btn"
            onClick={redoLast}
            disabled={(!canRedo && !(studio?.canRedo ?? false)) || busy}
            title="다시 실행 (Ctrl+Shift+Z)"
          >
            다시 실행
          </button>
          {/* 요약과 제작 요청 미리보기는 내부 확인용이다. 코드도 화면도 그대로
              남아 있지만, 작업판의 기본 흐름(불러오기 → 생성 → 수정 → 저장)을
              가리지 않도록 여기서는 내놓지 않는다 (실작업 UI 마감 §4.2). */}
          {!studioMode && (
            <button type="button" className="btn" onClick={onShowSummary} disabled={busy} title="이미지 생성 AI가 읽는 정보 미리보기">AI 요약</button>
          )}
          {!studioMode && onShowGenerationRequest !== undefined && (
            <button
              type="button"
              className="btn"
              onClick={onShowGenerationRequest}
              disabled={busy}
              title="GPT에게 나갈 제작 요청을 사람이 먼저 읽습니다"
            >
              AI 제작 요청 미리보기
            </button>
          )}
          {/* 실제 생성. 돈이 드는 유일한 버튼이라 상태를 감추지 않는다 — 나가
              있는 동안은 잠기고, 결과가 있으면 "다시"라고 말한다. */}
          {generation !== null && (
            <>
              <button
                type="button"
                className="btn btn--primary"
                onClick={generation.begin}
                disabled={busy || generation.state.kind === 'running'}
                title="현재 페이지를 이미지 1장으로 생성합니다"
              >
                {generation.state.kind === 'running'
                  ? '이미지 생성 중…'
                  : generation.hasResult
                    ? '다시 생성하기'
                    : '이미지 생성하기'}
              </button>
              {/* 저장 여부를 문구와 생김새로 함께 말한다. 키 자체는 한 글자도
                  다시 보이지 않는다 (마감 교정 §2). */}
              <button
                type="button"
                className={`btn${generation.hasKey ? ' btn--key-saved is-saved' : ''}`}
                onClick={() => setKeyPanel(true)}
                disabled={busy}
                title={
                  generation.hasKey
                    ? '이 탭에 테스트용 키가 저장되어 있습니다. 눌러서 바꾸거나 지울 수 있습니다.'
                    : '테스트용 OpenAI API 키를 입력합니다'
                }
              >
                {generation.hasKey ? '✓ API 키 저장됨' : 'API 키'}
              </button>
            </>
          )}

          <button
            type="button"
            className="btn"
            onClick={() => importInputRef.current?.click()}
            disabled={busy}
            title=".eventbrief 파일에서 기획서를 불러옵니다"
          >
            {studioMode ? '기획서 불러오기' : '파일 불러오기'}
          </button>
          {/* 두 저장이 나란히 선다 (작업 잃지 않기 Patch).
              앞선 판은 `이미지 저장`만 바에 두고 작업 파일 저장을 작업 메뉴 안으로
              보냈다 — "작업판에서 기획서를 다시 만들 일은 없다"고 보았기 때문이다.
              그 전제가 틀렸다. 만든 이벤트 페이지를 나중에 다시 고치는 일이 있고,
              그때 필요한 것은 **돌아올 수 있는 유일한 저장**인 작업 파일 쪽이다.
              돌아올 수 없는 내보내기가 앞에 있고 돌아올 수 있는 저장이 메뉴 안에
              숨어 있으면, 사람은 이미지만 저장하고 작업을 잃는다. */}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFileName(title.trim() || FALLBACK_FILE_NAME)
              setNaming(true)
            }}
            disabled={busy}
            title={
              studioMode
                ? '제품 이미지 연결과 작업 상태까지 한 파일로 저장합니다 — 다시 열어 이어서 작업할 수 있습니다'
                : '이름을 정해 .eventbrief 파일로 저장합니다'
            }
          >
            {studioMode ? '작업 파일 저장' : '파일로 저장'}
          </button>
          {studioMode && imageSave !== null && (
            <button
              type="button"
              className="btn"
              onClick={imageSave.save}
              disabled={busy || imageSave.state.kind === 'saving'}
              title="생성한 결과 이미지를 PNG로 저장합니다 — 이 파일로는 작업을 이어갈 수 없습니다"
            >
              {imageSave.state.kind === 'saving' ? '이미지 저장 중…' : '이미지 저장'}
            </button>
          )}
          {studioMode && (
            <div className="work-menu" ref={workMenuRef}>
              <button
                type="button"
                className="btn work-menu__trigger"
                aria-haspopup="true"
                aria-expanded={workMenu}
                onClick={() => setWorkMenu((open) => !open)}
              >
                작업 메뉴
              </button>
              {/* 닫혀 있을 때는 아예 없다. 감춰 두기만 하면 화면에서 사라진
                  버튼이 손가락과 검사에는 여전히 잡힌다. */}
              {workMenu && (
                <div className="work-menu__panel" aria-label="작업 메뉴 항목">
                  {/* 기획서로 가는 문 (기획서 탭 감추기 Patch).
                      완성본을 보는 동안 `기획서`탭이 늘 서 있는 것이 불편하다는
                      말을 들었다 — 이미지를 만든 뒤에 오갈 곳은 완성본과 배너
                      둘뿐이다. 다만 기획서를 고쳐 다시 뽑는 길까지 없앨 수는
                      없으므로, 늘 보이던 자리에서 가끔 찾는 자리로 옮겼다. */}
                  {generation !== null && generation.hasResult && generation.view === 'compare' && (
                    <button
                      type="button"
                      className="work-menu__item"
                      onClick={() => {
                        setWorkMenu(false)
                        generation.setView('brief')
                      }}
                      title="기획서를 고쳐 다시 만들 때 씁니다"
                    >
                      기획서 보기
                    </button>
                  )}
                  {/* 작업 파일 저장은 바로 나갔다. 한 가지 일에 들어가는 문은
                      하나면 충분하고, 이 메뉴에 남은 것은 되돌릴 수 없는 일뿐이다. */}
                  <button
                    type="button"
                    className="work-menu__item"
                    disabled={busy}
                    onClick={() => {
                      setWorkMenu(false)
                      void countStudioStorage().then(setStudioWipe)
                    }}
                    title="이 브라우저의 Studio 작업을 지웁니다"
                  >
                    Studio 작업 초기화
                  </button>
                </div>
              )}
            </div>
          )}
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

      {/* 이미지 저장이 사람에게 물어야 하는 두 자리. 저장 자체는 이미 손에 있는
          자산을 내놓는 일이라 외부 호출이 없다 (실작업 UI 마감 §5). */}
      {imageSave !== null && imageSave.state.kind === 'nothing' && (
        <div className="confirm-backdrop" role="presentation" onClick={imageSave.dismiss}>
          <div
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="저장할 이미지 없음"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="confirm__title">아직 저장할 이미지가 없습니다</h2>
            <p className="confirm__body">
              먼저 <b>이미지 생성하기</b>로 결과를 만들어 주세요. 기획서 캔버스는 이미지로 저장하지 않습니다.
            </p>
            <div className="confirm__actions">
              <button type="button" className="btn btn--primary" onClick={imageSave.dismiss}>확인</button>
            </div>
          </div>
        </div>
      )}
      {imageSave !== null && imageSave.state.kind === 'partial' && (
        <div className="confirm-backdrop" role="presentation" onClick={imageSave.dismiss}>
          <div
            className="confirm"
            role="dialog"
            aria-modal="true"
            aria-label="일부 페이지만 저장"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="confirm__title">
              {imageSave.state.plan.totalPages}페이지 중 생성 결과가 있는 {imageSave.state.plan.files.length}페이지만
              저장합니다
            </h2>
            <p className="confirm__body">
              아직 만들지 않은 페이지는 빈 이미지로도, 기획서 캔버스로도 저장하지 않습니다.
            </p>
            <div className="confirm__actions">
              <button type="button" className="btn" onClick={imageSave.dismiss}>취소</button>
              <button type="button" className="btn btn--primary" onClick={imageSave.confirmPartial}>
                생성된 {imageSave.state.plan.files.length}장 저장
              </button>
            </div>
          </div>
        </div>
      )}
      {imageSave !== null && imageSave.state.kind === 'failed' && (
        <div className="confirm-backdrop" role="presentation" onClick={imageSave.dismiss}>
          <div
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="이미지 저장 실패"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="confirm__title">이미지를 저장하지 못했습니다</h2>
            <p className="confirm__body">{imageSave.state.message}</p>
            <div className="confirm__actions">
              <button type="button" className="btn btn--primary" onClick={imageSave.dismiss}>확인</button>
            </div>
          </div>
        </div>
      )}

      {studioWipe !== null && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setStudioWipe(null)}>
          <div
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="Studio 작업 초기화 확인"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="confirm__title">이 브라우저의 Studio 작업을 지울까요?</h2>
            <p className="confirm__body">
              작업 {studioWipe.briefs}건과 여기에만 연결된 제품 이미지 {studioWipe.images}장이 지워집니다. 되돌릴 수
              없습니다. 기획서 작성기의 자료는 지워지지 않습니다.
            </p>
            {/* 지워지는 것 중에 만들어 둔 완성본이 있으면 그것부터 말한다. */}
            {madeCount > 0 && (
              <p className="confirm__body confirm__body--loss">
                지금 작업의 <b>완성본 {madeCount}장</b>도 함께 사라집니다. 남기려면 먼저 <b>작업 파일 저장</b>을
                눌러 주세요.
              </p>
            )}
            <div className="confirm__actions">
              <button type="button" className="btn" onClick={() => setStudioWipe(null)}>취소</button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  setStudioWipe(null)
                  void resetStudioStorage().then(() => window.location.reload())
                }}
              >
                모두 지우기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 키를 다시 넣거나 지우는 자리. 작업판에만 있고, 값은 이 탭을 벗어나지
          않는다 — 여기서도 화면에 되비추지 않는다. */}
      {keyPanel && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setKeyPanel(false)}>
          <div
            className="confirm"
            role="dialog"
            aria-modal="true"
            aria-label="테스트용 OpenAI API 키"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="confirm__title">테스트용 OpenAI API 키</h2>
            <p className="confirm__body">
              {generation?.hasKey === true ? '이 탭에 키가 저장되어 있습니다.' : '아직 키가 없습니다.'} 키는 이 탭에만
              보관되며 탭을 닫으면 지워집니다. 파일·저장소·기획서에는 남지 않습니다.
            </p>
            <label className="save-dialog__field">
              <span className="save-dialog__label">새 키 입력</span>
              <input
                className="field__input"
                type="password"
                autoFocus
                aria-label="새 API 키"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
            </label>
            <div className="confirm__actions">
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  generation?.clearKey()
                  setKeyDraft('')
                  setKeyPanel(false)
                }}
              >
                키 지우기
              </button>
              <button type="button" className="btn" onClick={() => setKeyPanel(false)}>취소</button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={keyDraft.trim().length === 0}
                onClick={() => {
                  generation?.saveKey(keyDraft)
                  setKeyDraft('')
                  setKeyPanel(false)
                }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

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
            {/* 파일이 무엇을 담고 무엇을 안 담는지 **저장하기 전에** 말한다
                (파일 왕복 Patch). 배경과 문구 조각은 담기므로 열어서 이어 작업할
                수 있지만, 합쳐진 완성본과 결과 줄은 담기지 않는다 — 그 둘까지
                넣으면 파일이 감당할 크기가 아니다. */}
            {madeCount > 0 && (
              <p className="save-dialog__note">
                이 파일에는 <b>합쳐진 완성 이미지가 담기지 않습니다.</b> 대신 배경·문구 조각과 설정이 모두
                담기므로, 열어서 <b>완성본 다시 합치기</b>를 누르면 AI를 다시 부르지 않고 그대로 돌아옵니다.
                (지나온 수정 이력은 돌아오지 않습니다.)
              </p>
            )}
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
