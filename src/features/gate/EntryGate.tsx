/**
 * Business entry gate (WORK_PLAN Phase 7 §3, §5.2). Lets the user pick between
 * the two work areas: 기획서 생성 (planning) and 이미지 생성 (design). No fake
 * request counts — the image card shows a neutral "연결 예정" note until a
 * request store exists (§4).
 */

import { AppShellLayout } from '../../components/shell/AppShellLayout'
import { DocIcon, ImageIcon } from '../../components/shell/icons'
import { EntryCard } from './EntryCard'

export function EntryGate() {
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
          />
          <EntryCard
            to="/image-requests"
            accent="image"
            icon={<ImageIcon size={28} />}
            audience="디자인팀"
            title="이미지 생성"
            description="전달된 기획서를 확인하고 디자인 작업을 진행합니다."
            cta="작업 요청 확인하기"
            note="요청 관리 연결 예정"
          />
        </div>
      </section>
    </AppShellLayout>
  )
}
