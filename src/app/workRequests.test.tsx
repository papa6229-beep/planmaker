/**
 * Phase 7 Step 7 — work-request flow (WORK_PLAN §5, §6, §13). Drives the whole
 * router: 전달하기 creates a request that appears in the image-generation queue
 * and updates the gate counts; opening the request lets the design team change
 * its status, which reflects back on the gate and the planning list.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, resetAssetStoreForTests } from '../services/assetStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'

function renderApp(path = '/briefs/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

/** Adds a headline block and delivers the brief as a work request. */
async function deliver(user: ReturnType<typeof userEvent.setup>, title: string) {
  const palette = await screen.findByRole('complementary', { name: '블록 팔레트' })
  await user.click(within(palette).getByRole('button', { name: '메인 문구' }))

  const titleInput = screen.getByLabelText('기획서 제목')
  await user.clear(titleInput)
  await user.type(titleInput, title)

  await user.click(screen.getByRole('button', { name: '전달하기' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('전달되었습니다'))
}

beforeEach(async () => {
  resetAssetStoreForTests()
  resetRequestStoreForTests()
  await clearAll()
  await clearAllRequests()
})

describe('전달하기 → work request', () => {
  it('creates a request that appears in the image-generation queue as 신규', async () => {
    const user = userEvent.setup()
    renderApp()
    await deliver(user, '여름 세일 기획')

    // Follow the "목록 보기" link into the queue.
    await user.click(screen.getByRole('link', { name: '목록 보기' }))
    expect(await screen.findByRole('heading', { level: 1, name: '이미지 생성' })).toBeTruthy()

    // The delivered request is listed with its title, and the summary counts it.
    expect(screen.getByRole('heading', { level: 3, name: '여름 세일 기획' })).toBeTruthy()
    const summary = screen.getByLabelText('요청 상태 요약')
    expect(within(summary).getByText('신규').closest('.badge')!.textContent).toContain('1')
  })

  it('reflects a status change on the gate and the planning list', async () => {
    const user = userEvent.setup()
    renderApp()
    await deliver(user, '팝업 이벤트')

    await user.click(screen.getByRole('link', { name: '목록 보기' }))
    await user.click(await screen.findByRole('link', { name: '기획서 불러오기' }))

    // Editor opens in 이미지 생성 mode; move the request to 작업 중.
    await waitFor(() => expect(screen.getByLabelText('현재 모드').textContent).toBe('이미지 생성'))
    const statusGroup = screen.getByRole('group', { name: '요청 상태 변경' })
    await user.click(within(statusGroup).getByRole('button', { name: '작업 중' }))
    await waitFor(() =>
      expect((within(statusGroup).getByRole('button', { name: '작업 중' }) as HTMLElement).getAttribute('aria-pressed')).toBe('true'),
    )

    // Gate reflects 작업 중.
    await user.click(screen.getByRole('link', { name: '요청 목록으로 돌아가기' }))
    await screen.findByRole('heading', { level: 1, name: '이미지 생성' })
    const summary = screen.getByLabelText('요청 상태 요약')
    expect(within(summary).getByText('작업 중').closest('.badge')!.textContent).toContain('1')
  })
})

describe('image-generation placeholder (§13.4)', () => {
  it('shows the honest "다음 단계" notice with no fake generate button', async () => {
    const user = userEvent.setup()
    renderApp()
    await deliver(user, '생성 자리 테스트')
    await user.click(screen.getByRole('link', { name: '목록 보기' }))
    await user.click(await screen.findByRole('link', { name: '기획서 불러오기' }))

    await waitFor(() => expect(screen.getByText('이미지 생성 기능은 다음 단계에서 연결됩니다.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /생성|만들기 시작|generate/i })).toBeNull()
  })
})
