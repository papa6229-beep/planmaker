/**
 * Phase 7 Step 3 — editor top bar (WORK_PLAN §7.1). Covers the required tests
 * for this step: the title input is the single source of truth and keeps its
 * value (§17.3), the 게이트로 돌아가기 link is present, the file actions live in
 * the 보조 메뉴, and 전달하기 is a non-functional placeholder that only surfaces
 * an honest "다음 단계에서 연결" notice (no WorkRequest, no navigation).
 */

import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './AppShell'

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <Routes>
        <Route path="/" element={<h1>게이트 화면</h1>} />
        <Route path="/briefs/new" element={<AppShell />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('editor top bar — Phase 7 Step 3', () => {
  it('shows the mode label and a back-to-gate link pointing to /', () => {
    renderEditor()
    expect(screen.getByLabelText('현재 모드').textContent).toBe('기획서 생성')
    const back = screen.getByRole('link', { name: '게이트로 돌아가기' })
    expect(back.getAttribute('href')).toBe('/')
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

  it('moves the .eventbrief file actions into the 보조 메뉴', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByText('보조 메뉴'))
    expect(screen.getByRole('button', { name: '파일로 저장 (.eventbrief)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '파일 불러오기' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '새로 만들기' })).toBeTruthy()
  })

  it('renders 전달하기 as a non-functional placeholder (no request, no navigation)', async () => {
    const user = userEvent.setup()
    renderEditor()

    const submit = screen.getByRole('button', { name: '전달하기' })
    const hint = screen.getByRole('status')
    expect(hint.textContent).toBe('다음 단계 연결 예정')

    await user.click(submit)

    // Honest guidance appears; we stay in the editor and nothing was created.
    expect(screen.getByRole('status').textContent).toBe('요청 전달 기능은 다음 단계에서 연결됩니다.')
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
