/**
 * `/image-requests` — the design team's queue (WORK_PLAN §13.1). Lists delivered
 * work requests with status filters (신규/확인/작업 중/완료), a status summary,
 * and per-request cards (제목·전달일·상태·페이지 수·불러오기). Real data from the
 * local repository — no fake cards. When empty, a polished empty state remains.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShellLayout } from '../../components/shell/AppShellLayout'
import { PageHeader } from '../../components/shell/PageHeader'
import { EmptyState } from '../../components/shell/EmptyState'
import { StatusBadge } from '../../components/shell/StatusBadge'
import { InboxIcon, DocIcon } from '../../components/shell/icons'
import { useRequests } from '../../features/requests/useRequests'
import { pageCount, STATUS_LABELS, WORK_REQUEST_STATUSES, type WorkRequestStatus } from '../../domain/workRequest'

const STATUS_TONE: Record<WorkRequestStatus, 'violet' | 'info' | 'warning' | 'success'> = {
  submitted: 'violet',
  reviewed: 'info',
  in_progress: 'warning',
  completed: 'success',
}

type Filter = WorkRequestStatus | 'all'

export function ImageRequestsPage() {
  const { requests, stats, loaded } = useRequests()
  const [filter, setFilter] = useState<Filter>('all')

  const visible = filter === 'all' ? requests : requests.filter((r) => r.status === filter)
  const hasAny = loaded && requests.length > 0

  return (
    <AppShellLayout>
      <PageHeader title="이미지 생성" description="전달된 기획서를 확인하고 디자인 작업을 관리합니다." />

      <div className="req-summary" aria-label="요청 상태 요약">
        <StatusBadge label="신규" value={stats.submitted} tone="violet" />
        <StatusBadge label="작업 중" value={stats.in_progress} tone="info" />
        <StatusBadge label="완료" value={stats.completed} tone="success" />
      </div>

      {hasAny ? (
        <>
          <div className="req-filters" role="group" aria-label="상태 필터">
            <button
              type="button"
              className={`req-filter${filter === 'all' ? ' is-active' : ''}`}
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              전체 {requests.length}
            </button>
            {WORK_REQUEST_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`req-filter${filter === s ? ' is-active' : ''}`}
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
              >
                {STATUS_LABELS[s]} {stats[s]}
              </button>
            ))}
          </div>

          {visible.length > 0 ? (
            <ul className="req-cards">
              {visible.map((r) => (
                <li key={r.id} className="req-card">
                  <div className="req-card__thumb" aria-hidden="true">
                    <DocIcon size={26} />
                    <span className="req-card__pages">{pageCount(r)}p</span>
                  </div>
                  <div className="req-card__body">
                    <h3 className="req-card__title">{r.title}</h3>
                    <p className="req-card__meta">전달 {r.submittedAt.slice(0, 10)} · {pageCount(r)}페이지</p>
                    <StatusBadge label={STATUS_LABELS[r.status]} tone={STATUS_TONE[r.status]} />
                  </div>
                  <Link className="btn req-card__open" to={`/image-requests/${r.id}`}>
                    기획서 불러오기
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="req-empty-filter">해당 상태의 요청이 없습니다.</p>
          )}
        </>
      ) : (
        <EmptyState
          icon={<InboxIcon size={30} />}
          title="아직 전달된 이미지 작업 요청이 없습니다"
          description="기획서 생성 화면에서 요청이 전달되면 이곳에 표시됩니다."
          action={
            <Link className="btn" to="/briefs">
              기획서 생성으로 이동
            </Link>
          }
        />
      )}
    </AppShellLayout>
  )
}
