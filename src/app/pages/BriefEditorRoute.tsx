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
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../AppShell'
import { AppShellLayout } from '../../components/shell/AppShellLayout'
import { PageHeader } from '../../components/shell/PageHeader'
import { useDocuments } from '../../features/documents/useDocuments'
import { loadDocumentById, saveDocumentById } from '../../services/documentStore'
import type { DocumentBinding } from '../../features/document/useBriefDocument'

/** `/briefs/new` — create, then hand over to the id-based route. */
export function NewBriefRoute() {
  const { createNew, loaded } = useDocuments()
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // Wait for the legacy import so a first-run user does not end up with both
    // an imported brief and a redundant empty one.
    if (!loaded) return
    let cancelled = false
    void (async () => {
      try {
        const id = await createNew()
        if (!cancelled) navigate(`/briefs/${id}`, { replace: true })
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loaded, createNew, navigate])

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

  const binding = useMemo<DocumentBinding | undefined>(() => {
    if (id === undefined) return undefined
    return {
      load: () => loadDocumentById(id),
      save: (doc) => saveDocumentById(id, doc, Date.now()),
    }
  }, [id])

  if (id === undefined || binding === undefined) {
    return (
      <AppShellLayout>
        <PageHeader title="기획서" description="기획서를 찾을 수 없습니다." />
      </AppShellLayout>
    )
  }

  return <AppShell key={id} binding={binding} />
}
