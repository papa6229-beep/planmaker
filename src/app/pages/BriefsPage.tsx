/**
 * `/briefs` — planning entry page (WORK_PLAN Phase 7 §5). No brief list this
 * step: a tidy product page with an honest empty state and the primary action
 * to start a new brief. No fake list, no fake status, no server-like wording.
 */

import { Link } from 'react-router-dom'
import { AppShellLayout } from '../../components/shell/AppShellLayout'
import { PageHeader } from '../../components/shell/PageHeader'
import { EmptyState } from '../../components/shell/EmptyState'
import { DocIcon } from '../../components/shell/icons'

export function BriefsPage() {
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
      <EmptyState
        icon={<DocIcon size={30} />}
        title="아직 작성한 기획서가 없습니다"
        description="기획서 목록은 다음 단계에서 연결될 예정입니다. 지금 새 기획서를 작성해 보세요."
        action={
          <Link className="btn btn--primary" to="/briefs/new">
            새 기획서 작성
          </Link>
        }
      />
    </AppShellLayout>
  )
}
