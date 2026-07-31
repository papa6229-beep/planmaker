/**
 * Right column — 내 기획서 (§6).
 *
 * The panel is no longer a property editor (everything is edited on the canvas
 * now). It is the list of briefs this browser holds: search by title, open one,
 * or copy one into a new brief. Each row shows when it was written, last
 * changed, last delivered, and whether it has been edited since that delivery —
 * decided by comparing content, not timestamps.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDocuments } from '../../features/documents/useDocuments'
import { useRequests } from '../../features/requests/useRequests'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { loadDocumentById } from '../../services/documentStore'
import { BRIEF_STATUS_LABELS, briefStatus, lastDeliveredAt, type BriefDeliveryStatus } from '../../domain/briefStatus'
import type { BriefDocument } from '../../domain/pageSchema'

const STATUS_CLASS: Record<BriefDeliveryStatus, string> = {
  draft: 'is-draft',
  delivered: 'is-delivered',
  editedAfterDelivery: 'is-edited',
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function BriefLibrary() {
  const { documents, loaded, createNew, duplicate, refresh } = useDocuments()
  const { requests } = useRequests()
  const { saveNow } = useBriefDocument()
  const navigate = useNavigate()
  const { id: openId } = useParams()

  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Full documents for the delivered briefs, so status can compare content.
  const [docs, setDocs] = useState<Record<string, BriefDocument>>({})

  const deliveredIds = useMemo(
    () => new Set(requests.map((r) => r.documentId).filter((v): v is string => v !== undefined)),
    [requests],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next: Record<string, BriefDocument> = {}
      for (const summary of documents) {
        if (!deliveredIds.has(summary.id)) continue
        const doc = await loadDocumentById(summary.id)
        if (doc) next[summary.id] = doc
      }
      if (!cancelled) setDocs(next)
    })()
    return () => {
      cancelled = true
    }
  }, [documents, deliveredIds])

  const visible = useMemo(() => {
    const q = query.trim()
    return q ? documents.filter((d) => d.title.includes(q)) : documents
  }, [documents, query])

  /** Saves the brief on screen before leaving it; never navigates on failure. */
  const goTo = async (targetId: string) => {
    if (targetId === openId) return
    setBusy(true)
    setError('')
    try {
      await saveNow()
    } catch {
      setError('현재 기획서를 저장하지 못했습니다. 화면을 그대로 두었습니다.')
      setBusy(false)
      return
    }
    await refresh()
    setBusy(false)
    navigate(`/briefs/${targetId}`)
  }

  const startNew = async () => {
    setBusy(true)
    setError('')
    try {
      await saveNow()
      const id = await createNew()
      setBusy(false)
      navigate(`/briefs/${id}`)
    } catch {
      setError('새 기획서를 만들지 못했습니다.')
      setBusy(false)
    }
  }

  const copy = async (sourceId: string) => {
    setBusy(true)
    setError('')
    try {
      if (sourceId === openId) await saveNow()
      const copyId = await duplicate(sourceId)
      setBusy(false)
      if (copyId) navigate(`/briefs/${copyId}`)
    } catch {
      setError('복사하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <aside className="inspector library" aria-label="내 기획서">
      <header className="library__header">
        <h2 className="library__title">내 기획서</h2>
        <button type="button" className="btn btn--primary library__new" disabled={busy} onClick={() => void startNew()}>
          새 기획서
        </button>
      </header>

      <input
        type="search"
        className="field__input library__search"
        aria-label="기획서 제목 검색"
        placeholder="제목으로 찾기"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <p className="library__error" role="alert">{error}</p>}

      {!loaded ? (
        <p className="library__empty">불러오는 중…</p>
      ) : visible.length === 0 ? (
        <p className="library__empty">
          {documents.length === 0 ? '아직 저장된 기획서가 없습니다.' : '검색 결과가 없습니다.'}
        </p>
      ) : (
        <ul className="library__list">
          {visible.map((d) => {
            const status = briefStatus(requests, d.id, docs[d.id])
            const delivered = lastDeliveredAt(requests, d.id)
            const isOpen = d.id === openId
            return (
              <li key={d.id} className={`library__item${isOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="library__open"
                  disabled={busy}
                  onClick={() => void goTo(d.id)}
                >
                  <span className="library__item-title">{d.title}</span>
                  <span className={`library__status ${STATUS_CLASS[status]}`}>{BRIEF_STATUS_LABELS[status]}</span>
                  <span className="library__dates">
                    작성 {day(d.createdAt)} · 수정 {day(d.updatedAt)}
                    {delivered ? ` · 전달 ${delivered.slice(0, 10)}` : ''}
                  </span>
                </button>
                <details className="library__menu">
                  <summary className="library__menu-trigger" aria-label={`${d.title} 메뉴`}>⋯</summary>
                  <div className="library__menu-panel">
                    <button type="button" className="library__menu-item" disabled={busy} onClick={() => void copy(d.id)}>
                      복사해서 새 기획서 만들기
                    </button>
                  </div>
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
