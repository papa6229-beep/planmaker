/**
 * Business entry gate (WORK_PLAN §3, §5). Lets the user pick between the two
 * work areas: 기획서 생성 (planning) and 이미지 생성 (design). The cards now show
 * REAL work-request counts from the local repository (Step 7) — never fabricated
 * numbers. The planning card only summarizes delivered-request status (no draft
 * counts this step); the image card shows the queue by status.
 */

import { AppShellLayout } from '../../components/shell/AppShellLayout'
import { DocIcon, ImageIcon } from '../../components/shell/icons'
import { useRequests } from '../requests/useRequests'
import { EntryCard, type EntryCardStat } from './EntryCard'

export function EntryGate() {
  const { stats, loaded } = useRequests()

  const delivered = stats.total
  const briefStats: EntryCardStat[] | undefined =
    loaded && delivered > 0
      ? [
          { label: '전달 완료', value: delivered },
          { label: '작업 중', value: stats.in_progress },
        ]
      : undefined

  const imageStats: EntryCardStat[] | undefined =
    loaded && delivered > 0
      ? [
          { label: '신규', value: stats.submitted },
          { label: '작업 중', value: stats.in_progress },
          { label: '완료', value: stats.completed },
        ]
      : undefined

  const imageNote =
    !loaded || delivered === 0
      ? '아직 전달된 요청이 없습니다'
      : stats.submitted > 0
        ? `새로운 이미지 작업 요청이 ${stats.submitted}개 있습니다.`
        : '새로운 요청이 없습니다.'

  return (
    <AppShellLayout wide>
      <section className="gate" aria-label="업무 선택">
        <div className="gate__intro">
          <h1 className="gate__title">어떤 작업을 시작할까요?</h1>
          <p className="gate__subtitle">기획 요청 작성과 디자인 작업 관리를 한곳에서 진행합니다.</p>
        </div>

        <div className="gate__cards">
          <EntryCard
            to="/briefs"
            accent="brief"
            icon={<DocIcon size={28} />}
            audience="상품 · 마케팅 · CS팀"
            title="기획서 생성"
            description="이벤트·팝업·프로모션 작업 요청을 블록으로 시각적으로 작성합니다."
            cta="기획서 작성하기"
            {...(briefStats ? { stats: briefStats } : { note: '전달한 요청 상태가 여기에 표시됩니다' })}
          />
          <EntryCard
            to="/image-requests"
            accent="image"
            icon={<ImageIcon size={28} />}
            audience="디자인팀"
            title="이미지 생성"
            description="전달된 기획서를 확인하고 디자인 작업을 진행합니다."
            cta="작업 요청 확인하기"
            {...(imageStats ? { stats: imageStats } : {})}
            note={imageNote}
          />
        </div>
      </section>
    </AppShellLayout>
  )
}
