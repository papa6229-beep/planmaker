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
import { selectTeam } from '../../features/team/teamSession'
import { isRequestTeam, REQUEST_TEAMS, type RequestTeam } from '../../domain/requestTeam'
import { countWriterStorage, resetWriterStorage, type StorageCount } from '../../services/storageReset'
import { readEventDocument } from '../../services/eventBriefImport'
import { resolveAssetCollisions } from '../../services/importAssets'
import { putAssets } from '../../services/assetStore'
import { createDocument } from '../../services/documentStore'

export function TeamGatePage() {
  const { createNew, refresh } = useDocuments()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement | null>(null)
  // 한 번 누른 팀 선택이 문서를 두 건 만들지 않도록 잠근다.
  const startingRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [counts, setCounts] = useState<StorageCount | null>(null)
  const [confirming, setConfirming] = useState(false)

  const recount = useCallback(() => {
    void countWriterStorage()
      .then(setCounts)
      .catch(() => setCounts(null))
  }, [])

  useEffect(recount, [recount])

  const start = async (team: RequestTeam) => {
    if (startingRef.current) return
    startingRef.current = true
    setBusy(true)
    try {
      selectTeam(team)
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
   * 기획서 한 건이 된다. 이미지는 공용 풀에 *더하기만* 하고, 파일이 지녔던 팀을
   * 그대로 이어받는다.
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
      if (isRequestTeam(team)) selectTeam(team)
      const id = await createDocument(resolved.doc, Date.now())
      await refresh()
      navigate(`/briefs/${id}`, { replace: true })
    } catch {
      setFailed(true)
      startingRef.current = false
      setBusy(false)
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

        <div className="team-gate__teams">
          {REQUEST_TEAMS.map((team) => (
            <button
              key={team.value}
              type="button"
              className="btn btn--primary team-gate__team"
              disabled={busy}
              onClick={() => void start(team.value)}
            >
              {team.label}
            </button>
          ))}
        </div>

        {failed && <p className="team-gate__error">기획서를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}

        <div className="team-gate__tools">
          <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            파일 불러오기
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
