/**
 * `/image-requests/:id` — minimal placeholder kept from Step 1 (WORK_PLAN §10),
 * now using the shared shell for consistency. The image work screen and image
 * generation are not part of this project.
 */

import { Link } from 'react-router-dom'
import { AppShellLayout } from '../../components/shell/AppShellLayout'
import { PageHeader } from '../../components/shell/PageHeader'
import { EmptyState } from '../../components/shell/EmptyState'
import { InboxIcon } from '../../components/shell/icons'

export function ImageRequestWorkPage() {
  return (
    <AppShellLayout>
      <PageHeader title="이미지 작업 화면" />
      <EmptyState
        icon={<InboxIcon size={30} />}
        title="이미지 작업 화면은 다음 단계에서 구현됩니다"
        description="요청 불러오기와 상태 관리는 다음 단계에서 제공되며, 이미지 생성 기능은 이 프로젝트에서 다루지 않습니다."
        action={
          <Link className="btn" to="/image-requests">
            요청 목록으로
          </Link>
        }
      />
    </AppShellLayout>
  )
}
