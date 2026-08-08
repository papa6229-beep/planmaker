/**
 * 팀 선택 화면 (첫 사용 흐름 §4, §5).
 *
 * 작성기의 첫 화면. 공유용 주소로 새로 들어온 사람에게 남의 작업을 열어 주는
 * 대신, 어느 팀으로 일하는지부터 묻는다. 팀을 고르면 그 팀 소속의 **빈 새
 * 기획서** 한 건으로 시작하고, 그 팀의 지난 기획서는 편집 화면 오른쪽 목록에서
 * 다시 열 수 있다.
 *
 * 인증이 아니다. 한 브라우저 안에서 팀별 작업을 섞지 않기 위한 표시일 뿐이고,
 * 저장은 이 브라우저 안에만 있다 — 다른 컴퓨터와 공유되지 않는다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDocuments } from '../../features/documents/useDocuments'
import { MEMBER_NAME_MAX, selectMember, selectTeam } from '../../features/team/teamSession'
import { isRequestTeam, REQUEST_TEAMS, teamLabel, type RequestTeam } from '../../domain/requestTeam'
import { countWriterStorage, resetWriterStorage, type StorageCount } from '../../services/storageReset'
import { readEventDocument } from '../../services/eventBriefImport'
import { resolveAssetCollisions } from '../../services/importAssets'
import { putAssets } from '../../services/assetStore'
import { assignDocumentTeam, createDocument, listTeamlessDocuments, type DocumentSummary } from '../../services/documentStore'

export function TeamGatePage() {
  const { createNew, refresh } = useDocuments()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement | null>(null)
  // 한 번 누른 팀 선택이 문서를 두 건 만들지 않도록 잠근다.
  const startingRef = useRef(false)
  const [busy, setBusy] = useState(false)
  /**
   * 작업자 이름 (작업자 기록 Patch).
   *
   * 팀만으로는 나중에 "누가 했는지"를 알 수 없다. 한 팀에서 여럿이 쓰기 때문이다.
   * 비워 두면 시작하지 않는다 — 나중에 채우게 하면 대개 비어 있는 채로 남는다.
   */
  const [member, setMember] = useState('')
  const [failed, setFailed] = useState(false)
  const [counts, setCounts] = useState<StorageCount | null>(null)
  const [confirming, setConfirming] = useState(false)
  /** 팀을 정하지 않고 쓴 이전 자료. 목록을 연 동안에만 읽는다. */
  const [teamless, setTeamless] = useState<DocumentSummary[] | null>(null)
  const [picked, setPicked] = useState<Record<string, RequestTeam>>({})
  const [filed, setFiled] = useState<Record<string, RequestTeam>>({})
  const [teamlessCount, setTeamlessCount] = useState(0)
  /** 방금 불러온 팀 미지정 파일의 제목 — 어디로 갔는지 알려 주기 위해서만. */
  const [importedTeamless, setImportedTeamless] = useState<string | null>(null)

  const recount = useCallback(() => {
    void countWriterStorage()
      .then(setCounts)
      .catch(() => setCounts(null))
    void listTeamlessDocuments()
      .then((rows) => setTeamlessCount(rows.length))
      .catch(() => setTeamlessCount(0))
  }, [])

  useEffect(recount, [recount])

  const start = async (team: RequestTeam) => {
    if (startingRef.current) return
    startingRef.current = true
    setBusy(true)
    try {
      selectTeam(team)
      selectMember(member)
      const id = await createNew(team)
      navigate(`/briefs/${id}`, { replace: true })
    } catch {
      setFailed(true)
      startingRef.current = false
      setBusy(false)
    }
  }

  /**
   * 게이트에서 여는 파일은 지금 열려 있는 기획서를 교체하는 것이 아니라 새
   * 기획서 한 건이 된다. 이미지는 공용 풀에 *더하기만* 한다.
   *
   * 팀이 적힌 파일은 그 팀으로 들어가 바로 열린다. 팀이 없는 파일은 저장은 하되
   * **편집기로 들어가지 않는다** — 어느 팀 자료인지 아무도 말하지 않았는데 열어
   * 주면, 주소로 여는 것을 막아 둔 것이 파일 한 번으로 무너진다 (교정2 §3).
   * 원본은 손대지 않고 그대로 저장한 뒤, 정리 경로에서 팀을 정하게 한다.
   */
  const openFile = async (file: File) => {
    if (startingRef.current) return
    startingRef.current = true
    setBusy(true)
    try {
      const imported = await readEventDocument(file)
      const resolved = await resolveAssetCollisions(imported.doc, imported.assets)
      await putAssets(resolved.assets)
      const team = resolved.doc.project.requestTeam
      const id = await createDocument(resolved.doc, Date.now())
      await refresh()
      if (isRequestTeam(team)) {
        selectTeam(team)
        navigate(`/briefs/${id}`, { replace: true })
        return
      }
      setImportedTeamless(resolved.doc.project.title)
      recount()
      startingRef.current = false
      setBusy(false)
    } catch {
      setFailed(true)
      startingRef.current = false
      setBusy(false)
    }
  }

  const openTeamless = async () => {
    setPicked({})
    setFiled({})
    setImportedTeamless(null)
    try {
      setTeamless(await listTeamlessDocuments())
    } catch {
      setTeamless([])
    }
  }

  /**
   * 이전 자료를 한 팀 소속으로 옮긴다. 사용자가 팀을 고른 뒤에만 일어나고,
   * 바뀌는 것은 소속 하나뿐이다 — 문서도 이미지도 날짜도 그대로다.
   */
  const fileUnder = async (id: string) => {
    const team = picked[id]
    if (team === undefined) return
    try {
      await assignDocumentTeam(id, team)
      setFiled((f) => ({ ...f, [id]: team }))
      setTeamless((rows) => (rows ?? []).filter((r) => r.id !== id))
      await refresh()
      recount()
    } catch {
      setFailed(true)
    }
  }

  const wipe = async () => {
    setConfirming(false)
    setBusy(true)
    try {
      await resetWriterStorage()
      await refresh()
    } catch {
      setFailed(true)
    }
    recount()
    setBusy(false)
  }

  return (
    <div className="team-gate">
      <main className="team-gate__card">
        <h1 className="team-gate__title">어느 팀으로 기획서를 쓰시나요?</h1>
        <p className="team-gate__lead">
          팀을 고르면 빈 기획서 한 건으로 시작합니다. 그 팀의 지난 기획서는 편집 화면 오른쪽 목록에서 다시 열 수 있습니다.
        </p>

        <label className="team-gate__member">
          <span className="team-gate__member-label">작업자 이름</span>
          <input
            className="field__input"
            aria-label="작업자 이름"
            value={member}
            maxLength={MEMBER_NAME_MAX}
            placeholder="예: 김하늘"
            autoComplete="off"
            disabled={busy}
            onChange={(e) => setMember(e.target.value)}
          />
          <span className="team-gate__member-hint">
            기획서에 <b>누가 작업했는지</b>가 남습니다. 팀 목록에서 함께 보입니다.
          </span>
        </label>

        <div className="team-gate__teams">
          {REQUEST_TEAMS.map((team) => (
            <button
              key={team.value}
              type="button"
              className="btn btn--primary team-gate__team"
              disabled={busy || member.trim().length === 0}
              title={member.trim().length === 0 ? '작업자 이름을 먼저 입력해 주세요' : undefined}
              onClick={() => void start(team.value)}
            >
              {team.label}
            </button>
          ))}
        </div>
        {member.trim().length === 0 && (
          <p className="team-gate__lead">작업자 이름을 입력하면 팀을 고를 수 있습니다.</p>
        )}

        {failed && <p className="team-gate__error">기획서를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}

        {importedTeamless !== null && (
          <p className="team-gate__imported" role="status">
            «{importedTeamless || '제목 없음'}» 파일에는 팀이 적혀 있지 않아 저장만 했습니다. 아래 팀 미지정 이전
            자료에서 소속 팀을 정하면 열 수 있습니다.
          </p>
        )}

        <div className="team-gate__tools">
          <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            파일 불러오기
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void openTeamless()}
            title="팀을 정하지 않고 쓴 이전 기획서를 팀별로 정리합니다"
          >
            팀 미지정 이전 자료{teamlessCount > 0 ? ` (${teamlessCount})` : ''}
          </button>
          <button
            type="button"
            className="btn team-gate__wipe"
            disabled={busy || counts === null || counts.briefs === 0}
            onClick={() => setConfirming(true)}
          >
            이 브라우저의 모든 기획서 초기화
          </button>
        </div>

        <p className="team-gate__note">
          저장은 이 브라우저 안에만 있습니다. 다른 컴퓨터와 공유되지 않습니다.
          {counts !== null && ` 지금 기획서 ${counts.briefs}건, 이미지 ${counts.images}장이 있습니다.`}
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".eventbrief,application/zip"
          className="toolbar__file-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void openFile(file)
            e.target.value = ''
          }}
        />
      </main>

      {teamless !== null && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setTeamless(null)}>
          <div
            className="confirm team-gate__teamless"
            role="dialog"
            aria-modal="true"
            aria-label="팀 미지정 이전 자료 정리"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="confirm__title">팀 미지정 이전 자료</h2>
            <p className="confirm__body">
              팀을 정하기 전에 쓴 기획서입니다. 지워지지 않았고, 어느 팀에도 자동으로 들어가지 않습니다. 소속 팀을
              정해 주면 그 팀의 목록에 나타나고 그때부터 열 수 있습니다.
            </p>

            {teamless.length === 0 ? (
              <p className="team-gate__note">
                {Object.keys(filed).length > 0 ? '정리할 자료가 더 없습니다.' : '팀 미지정 이전 자료가 없습니다.'}
              </p>
            ) : (
              <ul className="team-gate__list">
                {teamless.map((row) => (
                  <li key={row.id} className="team-gate__row">
                    <span className="team-gate__row-title">{row.title || '제목 없음'}</span>
                    <span className="team-gate__row-meta">
                      {new Date(row.createdAt).toLocaleDateString('ko-KR')} · {row.pageCount}페이지
                    </span>
                    <select
                      className="field__input team-gate__row-team"
                      aria-label={`${row.title || '제목 없음'} 소속 팀`}
                      value={picked[row.id] ?? ''}
                      onChange={(e) => {
                        const value = e.target.value
                        if (isRequestTeam(value)) setPicked((p) => ({ ...p, [row.id]: value }))
                      }}
                    >
                      <option value="">팀 선택</option>
                      {REQUEST_TEAMS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      disabled={picked[row.id] === undefined}
                      onClick={() => void fileUnder(row.id)}
                    >
                      이 팀 자료로 옮기기
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {Object.entries(filed).map(([id, team]) => (
              <p key={id} className="team-gate__note">{teamLabel(team)} 자료로 옮겼습니다.</p>
            ))}

            <div className="confirm__actions">
              <button type="button" className="btn" onClick={() => setTeamless(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {confirming && counts !== null && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setConfirming(false)}>
          <div
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="기획서 전체 초기화 확인"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="confirm__title">이 브라우저의 기획서를 모두 지울까요?</h2>
            <p className="confirm__body">
              기획서 {counts.briefs}건과 그 기획서만 쓰는 이미지 {counts.images}장이 지워집니다. 지운 뒤에는 되돌릴 수
              없습니다. 파일로 저장해 둔 `.eventbrief`는 지워지지 않습니다.
            </p>
            <div className="confirm__actions">
              <button type="button" className="btn" onClick={() => setConfirming(false)}>취소</button>
              <button type="button" className="btn btn--danger" onClick={() => void wipe()}>모두 지우기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
