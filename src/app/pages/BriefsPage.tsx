/**
 * `/briefs` — planning entry page (WORK_PLAN §5, §7). Starts a new brief and
 * shows the status of requests this side has delivered (real data from the
 * request repository — no fake list, no draft counts this step). The planning
 * team only reads status here; editing happens on the image-generation side.
 */

import { Link } from 'react-router-dom'
import { AppShellLayout } from '../../components/shell/AppShellLayout'
import { PageHeader } from '../../components/shell/PageHeader'
import { EmptyState } from '../../components/shell/EmptyState'
import { StatusBadge } from '../../components/shell/StatusBadge'
import { DocIcon } from '../../components/shell/icons'
import { useRequests } from '../../features/requests/useRequests'
import { pageCount, type WorkRequestStatus } from '../../domain/workRequest'

/** Planning-side status wording (WORK_PLAN §5.3). */
const PLANNING_STATUS: Record<WorkRequestStatus, string> = {
  submitted: '전달 완료 · 대기',
  reviewed: '확인됨',
  in_progress: '디자인 작업 중',
  completed: '작업 완료',
}
const STATUS_TONE: Record<WorkRequestStatus, 'violet' | 'info' | 'warning' | 'success'> = {
  submitted: 'violet',
  reviewed: 'info',
  in_progress: 'warning',
  completed: 'success',
}

export function BriefsPage() {
  const { requests, loaded } = useRequests()

  return (
    <AppShellLayout>
      <PageHeader
        title="기획서 생성"
        description="이벤트·팝업·프로모션 작업 요청을 작성합니다."
        actions={
          <Link className="btn btn--primary btn--lg" to="/briefs/new">
            새 기획서 작성
          </Link>
        }
      />

      {loaded && requests.length > 0 ? (
        <section aria-label="전달한 요청" className="brief-requests">
          <h2 className="brief-requests__title">전달한 요청</h2>
          <ul className="req-list">
            {requests.map((r) => (
              <li key={r.id} className="req-row">
                <div className="req-row__main">
                  <span className="req-row__title">{r.title}</span>
                  <span className="req-row__meta">{pageCount(r)}페이지 · 전달 {r.submittedAt.slice(0, 10)}</span>
                </div>
                <StatusBadge label={PLANNING_STATUS[r.status]} tone={STATUS_TONE[r.status]} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState
          icon={<DocIcon size={30} />}
          title="아직 작성하거나 전달한 기획서가 없습니다"
          description="새 기획서를 작성하고 전달하면, 전달한 요청과 현재 작업 상태가 여기에 표시됩니다."
          action={
            <Link className="btn btn--primary" to="/briefs/new">
              새 기획서 작성
            </Link>
          }
        />
      )}
    </AppShellLayout>
  )
}
