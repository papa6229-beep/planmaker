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
import { createdMonths, groupByCreatedDay, localMonthKey, monthLabel } from '../../domain/briefCalendar'
import { NO_TEAM_LABEL, REQUEST_TEAMS, teamFilterKey, teamLabel } from '../../domain/requestTeam'
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
  const { documents, loaded, createNew, duplicate, remove, refresh } = useDocuments()
  const { requests } = useRequests()
  const { saveNow, getDocument, requestTeam: openTeam } = useBriefDocument()
  const navigate = useNavigate()
  const { id: openId } = useParams()

  const [query, setQuery] = useState('')
  /** `all`, or the `YYYY-MM` the brief was first written in. */
  const [month, setMonth] = useState('all')
  /** `all`, a team code, or `none` for 팀 미지정. */
  const [team, setTeam] = useState('all')
  const [confirmingId, setConfirming] = useState<string | null>(null)
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

  // Title and 작성 월 narrow the list together; the month is the month the
  // brief was first written in, never the month it was last touched.
  const visible = useMemo(() => {
    const q = query.trim()
    // The open brief is matched on what its card actually shows — the title as
    // it is being typed — so searching never hides the row in front of you.
    const titleOf = (d: { id: string; title: string }) =>
      d.id === openId ? (getDocument().project.title.trim() || d.title) : d.title
    return documents.filter(
      (d) =>
        (q === '' || titleOf(d).includes(q)) &&
        (month === 'all' || localMonthKey(d.createdAt) === month) &&
        // The brief on screen is filtered by the team it has right now, so
        // choosing a team in the bar moves its card immediately.
        (team === 'all' || teamFilterKey(d.id === openId ? openTeam : d.requestTeam) === team),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getDocument is a stable ref reader
  }, [documents, query, month, team, openId, openTeam])
  const months = useMemo(() => createdMonths(documents), [documents])
  const confirming = documents.find((d) => d.id === confirmingId)
  const groups = useMemo(() => groupByCreatedDay(visible), [visible])

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

  /**
   * Removes a brief. Deleting one that is not open leaves the screen alone;
   * deleting the open one moves to the most recently edited brief that is left,
   * or to a fresh empty one when nothing is (손검수 2 §5.2).
   */
  const removeBrief = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      await remove(id)
      if (id !== openId) {
        setBusy(false)
        return
      }
      const next = documents.filter((d) => d.id !== id).toSorted((a, b) => b.updatedAt - a.updatedAt)[0]
      const target = next?.id ?? (await createNew())
      setBusy(false)
      navigate(`/briefs/${target}`)
    } catch {
      // Nothing is removed from the screen that is still in the store.
      setError('기획서를 삭제하지 못했습니다. 목록은 그대로 두었습니다.')
      await refresh()
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

      <label className="library__month">
        <span className="library__month-label">작성 월</span>
        <select
          className="field__input library__month-select"
          aria-label="작성 월"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          <option value="all">전체 기간</option>
          {months.map((key) => (
            <option key={key} value={key}>{monthLabel(key)}</option>
          ))}
        </select>
      </label>

      <label className="library__month">
        <span className="library__month-label">작성팀</span>
        <select
          className="field__input library__month-select"
          aria-label="작성팀 필터"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
        >
          <option value="all">전체 팀</option>
          {REQUEST_TEAMS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
          <option value="none">{NO_TEAM_LABEL}</option>
        </select>
      </label>

      {error && <p className="library__error" role="alert">{error}</p>}

      {!loaded ? (
        <p className="library__empty">불러오는 중…</p>
      ) : visible.length === 0 ? (
        <p className="library__empty">
          {documents.length === 0
            ? '아직 저장된 기획서가 없습니다.'
            : month === 'all' && team === 'all'
              ? '검색 결과가 없습니다.'
              : '조건에 맞는 기획서가 없습니다.'}
        </p>
      ) : (
        <div className="library__groups">
          {groups.map((group) => (
            <section key={group.key} className="library__group" aria-label={`${group.label} 작성`}>
              <h3 className="library__group-title">{group.label}</h3>
              <ul className="library__list">
                {group.briefs.map((d) => {
                  const isOpen = d.id === openId
                  // The open brief is read from what is on screen, not from the
                  // last autosaved copy: its title shows as it is typed, and
                  // 전달 후 수정 중 shows as soon as the work actually differs
                  // from what was delivered.
                  const live = isOpen ? getDocument() : undefined
                  const title = live?.project.title.trim() ? live.project.title : d.title
                  const status = briefStatus(requests, d.id, live ?? docs[d.id])
                  const delivered = lastDeliveredAt(requests, d.id)
                  return (
                    <li key={d.id} className={`library__item${isOpen ? ' is-open' : ''}`}>
                      <button
                        type="button"
                        className="library__open"
                        disabled={busy}
                        onClick={() => void goTo(d.id)}
                      >
                        <span className="library__item-title">{title}</span>
                        <span className="library__meta">
                          <span className="library__team">{teamLabel(isOpen ? openTeam : d.requestTeam)}</span>
                          <span className={`library__status ${STATUS_CLASS[status]}`}>{BRIEF_STATUS_LABELS[status]}</span>
                        </span>
                        <span className="library__dates">
                          작성 {day(d.createdAt)} · 수정 {day(d.updatedAt)}
                          {delivered ? ` · 전달 ${delivered.slice(0, 10)}` : ''}
                        </span>
                      </button>
                      <details className="library__menu">
                        <summary className="library__menu-trigger" aria-label={`${title} 메뉴`}>⋯</summary>
                        <div className="library__menu-panel">
                          <button type="button" className="library__menu-item" disabled={busy} onClick={() => void copy(d.id)}>
                            복사해서 새 기획서 만들기
                          </button>
                          <button
                            type="button"
                            className="library__menu-item library__menu-item--danger"
                            disabled={busy}
                            onClick={() => setConfirming(d.id)}
                          >
                            기획서 삭제
                          </button>
                        </div>
                      </details>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {confirming && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setConfirming(null)}>
          <div
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="기획서 삭제 확인"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="confirm__text">
              ‘{confirming.title}’를 삭제할까요?<br />
              이 브라우저에 저장된 기획서가 삭제됩니다.
            </p>
            <div className="confirm__actions">
              <button type="button" className="btn" onClick={() => setConfirming(null)}>취소</button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  const id = confirming.id
                  setConfirming(null)
                  void removeBrief(id)
                }}
              >
                기획서 삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
