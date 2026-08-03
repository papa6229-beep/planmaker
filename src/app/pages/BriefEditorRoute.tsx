/**
 * Editor routes for the multi-document world (기획서 보관함 §6.3).
 *
 *   /briefs/new  — mints a brief, then replaces the URL with its id, so a
 *                  reload or a shared link reopens that exact brief rather
 *                  than starting a new one.
 *   /briefs/:id  — opens the brief stored under that id.
 *
 * The editor shell is keyed by id, so switching briefs tears down the previous
 * document provider (cancelling its pending autosave) instead of letting one
 * brief's edits drift into another's row.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../AppShell'
import { AppShellLayout } from '../../components/shell/AppShellLayout'
import { PageHeader } from '../../components/shell/PageHeader'
import { useDocuments } from '../../features/documents/useDocuments'
import { loadDocumentById, saveDocumentById } from '../../services/documentStore'
import { selectedTeam } from '../../features/team/teamSession'
import { teamFilterKey, teamLabel } from '../../domain/requestTeam'
import { useAppSurface } from '../AppSurfaceContext'
import type { DocumentBinding } from '../../features/document/useBriefDocument'

/** `/briefs/new` — create, then hand over to the id-based route. */
export function NewBriefRoute() {
  const { createNew, loaded } = useDocuments()
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)
  const surface = useAppSurface()
  // 팀을 고르기 전에는 기획서를 만들지도 않는다 — 만들면 주인 없는 문서가 하나
  // 생기고, 그것이 곧 팀 미지정 자료가 된다 (첫 사용 흐름 교정2 §1).
  const needsTeam = surface === 'brief-writer' && selectedTeam() === null

  useEffect(() => {
    if (needsTeam) return
    // Wait for the legacy import so a first-run user does not end up with both
    // an imported brief and a redundant empty one.
    if (!loaded) return
    let cancelled = false
    void (async () => {
      try {
        // 지금 일하고 있는 팀의 기획서로 만든다. 팀 없이 만들면 그 순간 주인 없는
        // 문서가 되고, 방금 만든 사람조차 열 수 없게 된다.
        const team = selectedTeam()
        const id = await createNew(...(team === null ? [] : [team]))
        if (!cancelled) navigate(`/briefs/${id}`, { replace: true })
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loaded, createNew, navigate, needsTeam])

  if (needsTeam) return <Navigate to="/" replace />

  return (
    <AppShellLayout>
      <PageHeader
        title="새 기획서"
        description={failed ? '기획서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' : '기획서를 준비하는 중입니다…'}
      />
    </AppShellLayout>
  )
}

/** `/briefs/:id` — opens one stored brief through the repository. */
export function BriefEditorRoute() {
  const { id } = useParams()
  const surface = useAppSurface()
  /**
   * Whose brief this is. Typing an address is not a way into somebody else's
   * work: the gate picked a team, and only that team's briefs open here (첫 사용
   * 흐름 §4). A brief with no team at all belongs to nobody yet — it is not
   * deleted and not given a team behind the user's back; it waits in the gate's
   * '팀 미지정 이전 자료' until someone says which team it is.
   */
  const gateTeam = surface === 'brief-writer' ? selectedTeam() : null
  /**
   * 팀을 고르기 전에는 어떤 기획서도 읽지 않는다. 주소만으로 남의 작업이 잠깐
   * 스쳐 보이는 일도 없어야 하므로, 저장소를 읽기 전에 게이트로 돌려보낸다.
   */
  const needsTeam = surface === 'brief-writer' && gateTeam === null
  const [denied, setDenied] = useState<'other-team' | 'teamless' | 'checking' | null>(
    surface === 'brief-writer' ? 'checking' : null,
  )

  useEffect(() => {
    if (id === undefined || gateTeam === null) return
    let cancelled = false
    void (async () => {
      const doc = await loadDocumentById(id)
      if (cancelled) return
      // 아직 저장되지 않은 새 기획서는 곧 이 자리에 저장된다 — 남의 것이 아니다.
      if (doc === null) {
        setDenied(null)
        return
      }
      const owner = teamFilterKey(doc.project.requestTeam)
      setDenied(owner === 'none' ? 'teamless' : owner === gateTeam ? null : 'other-team')
    })()
    return () => {
      cancelled = true
    }
  }, [id, gateTeam])

  const binding = useMemo<DocumentBinding | undefined>(() => {
    if (id === undefined) return undefined
    return {
      load: () => loadDocumentById(id),
      save: (doc) => saveDocumentById(id, doc, Date.now()),
    }
  }, [id])

  if (needsTeam) return <Navigate to="/" replace />

  // 누구 것인지 확인되기 전에는 아무것도 그리지 않는다. 그리고 나서 물리면 남의
  // 기획서가 한순간 스쳐 보인다.
  if (denied === 'checking') {
    return (
      <AppShellLayout>
        <PageHeader title="기획서" description="기획서를 여는 중입니다…" />
      </AppShellLayout>
    )
  }

  if (denied !== null) {
    return (
      <AppShellLayout>
        <PageHeader
          title={denied === 'teamless' ? '팀이 지정되지 않은 이전 자료입니다' : '다른 팀의 기획서입니다'}
          description={
            denied === 'teamless'
              ? '어느 팀 자료인지 아직 정해지지 않아 여기서는 열 수 없습니다. 시작 화면의 팀 미지정 이전 자료에서 팀을 정한 뒤 열어 주세요.'
              : `지금은 ${teamLabel(gateTeam ?? undefined)}으로 일하고 있습니다. 이 기획서는 다른 팀의 것이라 열 수 없습니다.`
          }
        />
        <p className="page-note"><Link to="/">팀 선택 화면으로 돌아가기</Link></p>
      </AppShellLayout>
    )
  }

  if (id === undefined || binding === undefined) {
    return (
      <AppShellLayout>
        <PageHeader title="기획서" description="기획서를 찾을 수 없습니다." />
      </AppShellLayout>
    )
  }

  return <AppShell key={id} binding={binding} />
}
