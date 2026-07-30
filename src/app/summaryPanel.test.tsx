import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'

/** The editor runs inside the router (mounted at /briefs/new · /briefs/:id). */
function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <RequestsProvider>
        <AppShell />
      </RequestsProvider>
    </MemoryRouter>,
  )
}

const PUBLISHING_URL = 'https://shop.example.com/cta'

async function buildBriefWithCtaAndUrl(user: ReturnType<typeof userEvent.setup>) {
  const palette = screen.getByRole('complementary', { name: '블록 팔레트' })
  const inspector = screen.getByRole('complementary', { name: '선택 블록 설정' })

  // One 버튼·링크 tool: the wording and the address are entered together, but
  // stay two blocks internally (design button + publishing URL).
  await user.click(within(palette).getByRole('button', { name: '버튼·링크' }))
  await user.type(within(inspector).getByLabelText('버튼에 보일 문구'), '지금 구매')
  await user.type(within(inspector).getByLabelText('연결 주소 (선택)'), PUBLISHING_URL)
}

describe('AI summary panel — information-area separation (Phase 5 gate)', () => {
  it('shows the publishing URL only in the publishing area, never in the AI design summary', async () => {
    const user = userEvent.setup()
    renderShell()
    await buildBriefWithCtaAndUrl(user)

    await user.click(screen.getByRole('button', { name: 'AI 요약' }))
    const dialog = screen.getByRole('dialog', { name: 'AI 요약 미리보기' })

    const designArea = within(dialog).getByLabelText('디자인 입력 요약')
    const publishingArea = within(dialog).getByLabelText('퍼블리싱 정보')

    // The CTA text is in the design summary, marked as having a link (no URL).
    expect(within(designArea).getByText(/지금 구매/)).toBeTruthy()
    expect(within(designArea).getByText(/연결 있음/)).toBeTruthy()
    expect(designArea.textContent ?? '').not.toContain(PUBLISHING_URL)

    // The URL lives only in the publishing area.
    expect(publishingArea.textContent ?? '').toContain(PUBLISHING_URL)
  })

  it('closes on the close button', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: 'AI 요약' }))
    expect(screen.getByRole('dialog', { name: 'AI 요약 미리보기' })).toBeTruthy()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
