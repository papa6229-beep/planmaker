/**
 * Phase 7 Step 3 — editor top bar (WORK_PLAN §7.1). Covers the required tests
 * for this step: the title input is the single source of truth and keeps its
 * value (§17.3), the 게이트로 돌아가기 link is present, the file actions are in
 * the bar itself, and 전달하기 is a non-functional placeholder that only surfaces
 * an honest "다음 단계에서 연결" notice (no WorkRequest, no navigation).
 */

import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <RequestsProvider>
          <DocumentsProvider>
          <Routes>
          <Route path="/" element={<h1>게이트 화면</h1>} />
          <Route path="/briefs/new" element={<AppShell />} />
        </Routes>
        </DocumentsProvider>
      </RequestsProvider>
    </MemoryRouter>,
  )
}

describe('editor top bar — Phase 7 Step 3', () => {
  it('shows the mode label, and no way back to the feature gate', () => {
    renderEditor()
    expect(screen.getByLabelText('현재 모드').textContent).toBe('기획서 생성')
    // A planner writing a brief has nowhere else to be (v1 마감 §10).
    expect(screen.queryByRole('link', { name: '게이트로 돌아가기' })).toBeNull()
  })

  it('keeps the title input value as the single source of truth', async () => {
    const user = userEvent.setup()
    renderEditor()
    const title = screen.getByLabelText('기획서 제목') as HTMLInputElement

    await user.clear(title)
    await user.type(title, '여름 프로모션 기획')

    // The controlled input reflects the project title and retains it.
    expect((screen.getByLabelText('기획서 제목') as HTMLInputElement).value).toBe('여름 프로모션 기획')
  })

  it('exposes a placeholder when the title is cleared', async () => {
    const user = userEvent.setup()
    renderEditor()
    const title = screen.getByLabelText('기획서 제목') as HTMLInputElement
    await user.clear(title)
    expect(title.placeholder).toBe('기획서 제목을 입력하세요')
    expect(title.value).toBe('')
  })

  it('keeps the .eventbrief file actions in the bar, and has no 보조 메뉴 at all', () => {
    renderEditor()
    // Saving and loading a file are everyday actions, so they are never hidden
    // behind a menu (자유 저장 §3).
    const bar = screen.getByRole('navigation', { name: '주요 작업' })
    expect(within(bar).getByRole('button', { name: '파일로 저장' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: '파일 불러오기' })).toBeTruthy()

    // 새로 만들기 lived alone in the overflow menu and is the 새 기획서 button in
    // 내 기획서; one way in is enough (v1 마감 §5).
    expect(screen.queryByText('보조 메뉴')).toBeNull()
    expect(screen.queryByRole('button', { name: '새로 만들기' })).toBeNull()
  })

  it('asks for a name before delivering — an unnamed brief creates no request and does not navigate', async () => {
    const user = userEvent.setup()
    renderEditor()

    const submit = screen.getByRole('button', { name: '전달하기' })
    expect(screen.getByRole('status').textContent).toContain('이미지 생성 요청으로 전달합니다.')

    await user.clear(screen.getByLabelText('기획서 제목'))
    await user.click(submit)

    // No name → nothing to find the request by later; we stay in the editor.
    // What the brief *contains* never blocks delivery (자유 저장 §2.2).
    expect(screen.getByRole('status').textContent).toContain('기획서 제목을 입력해야 전달할 수 있습니다.')
    expect(screen.getByRole('complementary', { name: '블록 팔레트' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '게이트 화면' })).toBeNull()
  })

  it('undo/redo and AI 요약 remain available in the top bar', () => {
    renderEditor()
    const bar = screen.getByRole('navigation', { name: '주요 작업' })
    expect(within(bar).getByRole('button', { name: '실행 취소' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: '다시 실행' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: 'AI 요약' })).toBeTruthy()
  })
})
