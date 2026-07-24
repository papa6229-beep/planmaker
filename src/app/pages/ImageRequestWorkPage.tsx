/**
 * `/image-requests/:id` — the design team opens a delivered request in the SAME
 * editor shell (WORK_PLAN §13.2). The submitted snapshot stays read-only; edits
 * go to a working copy (`workingDoc`) bound into the editor. A status panel
 * (§13.3) changes 신규/확인/작업 중/완료 — reflected on the gate and planning
 * list — and the image-generation area is an honest empty placeholder (§13.4:
 * no fake generate button, progress, or result).
 */

import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../AppShell'
import { AppShellLayout } from '../../components/shell/AppShellLayout'
import { PageHeader } from '../../components/shell/PageHeader'
import { EmptyState } from '../../components/shell/EmptyState'
import { InboxIcon } from '../../components/shell/icons'
import { useRequests } from '../../features/requests/useRequests'
import type { BriefDocument } from '../../domain/pageSchema'
import {
  cloneDocument,
  STATUS_LABELS,
  WORK_REQUEST_STATUSES,
  type WorkRequest,
  type WorkRequestStatus,
} from '../../domain/workRequest'

function RequestStatusPanel({ request, onStatus }: { request: WorkRequest; onStatus: (s: WorkRequestStatus) => void }) {
  return (
    <div className="req-status-panel">
      <div className="req-status-panel__row" role="group" aria-label="요청 상태 변경">
        <span className="req-status-panel__label">요청 상태</span>
        {WORK_REQUEST_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={request.status === s}
            className={`req-status-btn${request.status === s ? ' is-active' : ''}`}
            onClick={() => onStatus(s)}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <p className="req-status-panel__gen">이미지 생성 기능은 다음 단계에서 연결됩니다.</p>
    </div>
  )
}

function RequestWorkspace({ request }: { request: WorkRequest }) {
  const { saveWorkingDoc, setStatus } = useRequests()

  // Bind the editor to the request's working copy; the submitted snapshot is
  // never touched. `load` only runs on mount, so referencing `request` here is
  // safe even though later saves replace the object.
  const binding = useMemo(
    () => ({
      load: async () => request.workingDoc ?? cloneDocument(request.submittedDoc),
      save: async (doc: BriefDocument) => saveWorkingDoc(request.id, doc, new Date().toISOString()),
    }),
    [request.id, request.workingDoc, request.submittedDoc, saveWorkingDoc],
  )

  return (
    <AppShell
      mode="image"
      binding={binding}
      statusPanel={<RequestStatusPanel request={request} onStatus={(s) => void setStatus(request.id, s, new Date().toISOString())} />}
    />
  )
}

export function ImageRequestWorkPage() {
  const { id } = useParams()
  const { getRequest, loaded } = useRequests()
  const request = getRequest(id)

  if (loaded && !request) {
    return (
      <AppShellLayout>
        <PageHeader title="이미지 작업 화면" />
        <EmptyState
          icon={<InboxIcon size={30} />}
          title="요청을 찾을 수 없습니다"
          description="삭제되었거나 존재하지 않는 요청입니다."
          action={
            <Link className="btn" to="/image-requests">
              요청 목록으로
            </Link>
          }
        />
      </AppShellLayout>
    )
  }

  if (!request) {
    return (
      <AppShellLayout>
        <PageHeader title="이미지 작업 화면" description="요청을 불러오는 중입니다…" />
      </AppShellLayout>
    )
  }

  return <RequestWorkspace key={request.id} request={request} />
}
