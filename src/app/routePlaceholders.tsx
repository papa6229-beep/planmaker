/**
 * Minimal route shells for Phase 7 Step 1 (WORK_PLAN §15, §16 Step 1/2).
 *
 * These are intentionally bare skeletons — the designed business gate, request
 * lists, and status UI are NOT built yet (§16 items 11–13). They only prove the
 * routing structure exists and that refresh restores the current screen. No
 * fake counts, no fake generation controls.
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="route-shell">
      <div className="route-shell__card">
        <h1 className="route-shell__title">{title}</h1>
        {children}
      </div>
    </div>
  )
}

/** `/` — business gate skeleton (designed KPI gate comes in a later step). */
export function GateRoute() {
  return (
    <Shell title="Event Brief Builder">
      <p className="route-shell__desc">업무를 선택하세요. (게이트 디자인은 다음 단계에서 구현됩니다.)</p>
      <nav className="route-shell__links">
        <Link className="route-shell__link route-shell__link--brief" to="/briefs">기획서 생성</Link>
        <Link className="route-shell__link route-shell__link--image" to="/image-requests">이미지 생성</Link>
      </nav>
    </Shell>
  )
}

/** `/briefs` — brief list skeleton. */
export function BriefsRoute() {
  return (
    <Shell title="기획서 목록">
      <p className="route-shell__desc">기획서 목록 화면은 다음 단계에서 구현됩니다.</p>
      <nav className="route-shell__links">
        <Link className="route-shell__link route-shell__link--brief" to="/briefs/new">새 기획서 만들기</Link>
        <Link className="route-shell__link" to="/">게이트로</Link>
      </nav>
    </Shell>
  )
}

/** `/image-requests` — request list skeleton. */
export function ImageRequestsRoute() {
  return (
    <Shell title="이미지 생성 요청">
      <p className="route-shell__desc">요청 목록·상태 관리 화면은 다음 단계에서 구현됩니다.</p>
      <nav className="route-shell__links">
        <Link className="route-shell__link" to="/">게이트로</Link>
      </nav>
    </Shell>
  )
}

/** `/image-requests/:id` — image work screen skeleton. */
export function ImageRequestWorkRoute() {
  return (
    <Shell title="이미지 작업 화면">
      <p className="route-shell__desc">
        이미지 작업 화면은 다음 단계에서 구현됩니다. 이미지 생성 기능은 이 프로젝트에서 다루지 않습니다.
      </p>
      <nav className="route-shell__links">
        <Link className="route-shell__link" to="/image-requests">요청 목록으로</Link>
      </nav>
    </Shell>
  )
}
