/**
 * `/image-requests` — design work entry page (WORK_PLAN Phase 7 §6). No request
 * store yet, so this is a polished empty state. The 신규/작업 중/완료 status
 * structure is shown with real (zero) counts — never fabricated numbers — and
 * there is no status-change, load, or generation UI this step.
 */

import { Link } from 'react-router-dom'
import { AppShellLayout } from '../../components/shell/AppShellLayout'
import { PageHeader } from '../../components/shell/PageHeader'
import { EmptyState } from '../../components/shell/EmptyState'
import { StatusBadge } from '../../components/shell/StatusBadge'
import { InboxIcon } from '../../components/shell/icons'

export function ImageRequestsPage() {
  return (
    <AppShellLayout>
      <PageHeader title="이미지 생성" description="전달된 기획서를 확인하고 디자인 작업을 관리합니다." />

      {/* Status structure — all zero until a request store is connected. */}
      <div className="req-summary" aria-label="요청 상태 요약">
        <StatusBadge label="신규" value={0} tone="violet" />
        <StatusBadge label="작업 중" value={0} tone="info" />
        <StatusBadge label="완료" value={0} tone="success" />
      </div>

      <EmptyState
        icon={<InboxIcon size={30} />}
        title="아직 전달된 이미지 작업 요청이 없습니다"
        description="기획서 생성 화면에서 요청이 전달되면 이곳에 표시됩니다. 요청 관리 연결은 다음 단계에서 제공됩니다."
        action={
          <Link className="btn" to="/briefs">
            기획서 생성으로 이동
          </Link>
        }
      />
    </AppShellLayout>
  )
}
