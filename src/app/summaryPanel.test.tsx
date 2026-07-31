import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 20, height: 20 }) }
})

/** The editor runs inside the router (mounted at /briefs/new · /briefs/:id). */
function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <RequestsProvider>
          <DocumentsProvider>
          <AppShell />
        </DocumentsProvider>
      </RequestsProvider>
    </MemoryRouter>,
  )
}

const PUBLISHING_URL = 'https://shop.example.com/cta'

async function buildBriefWithCtaAndUrl(user: ReturnType<typeof userEvent.setup>) {
  const palette = screen.getByRole('complementary', { name: '블록 팔레트' })

  // One 버튼·링크 tool: wording and address are both entered on the card, but
  // stay two blocks internally (design button + publishing URL).
  const canvas = screen.getByRole('region', { name: '기획 캔버스' })
  await user.click(within(palette).getByRole('button', { name: '버튼·링크' }))
  await user.dblClick(canvas.querySelector('.block-card') as HTMLElement)
  await user.type(screen.getByLabelText('버튼 내용'), '지금 구매')
  await user.keyboard('{Control>}{Enter}{/Control}')

  await user.click(within(canvas).getByRole('button', { name: '버튼 링크 연결' }))
  await user.type(screen.getByLabelText('버튼 연결 주소'), PUBLISHING_URL)
  await user.click(screen.getByRole('button', { name: '저장' }))
}

describe('AI summary panel — 이미지 자리 (1-C §4.5)', () => {
  it('shows what image belongs where, and marks an attached capture as reference', async () => {
    const user = userEvent.setup()
    renderShell()
    const palette = screen.getByRole('complementary', { name: '블록 팔레트' })
    await user.click(within(palette).getByRole('button', { name: '이미지' }))
    await user.type(screen.getByLabelText('이미지 내용'), '아크웨이브 신제품 누끼 이미지가 중앙에 크게 들어갑니다.')
    await user.keyboard('{Control>}{Enter}{/Control}')

    await user.click(screen.getByRole('button', { name: 'AI 요약' }))
    const dialog = screen.getByRole('dialog', { name: 'AI 요약 미리보기' })
    const slots = within(dialog).getByLabelText('이미지 자리')

    // The planner's description reaches the AI verbatim.
    expect(slots.textContent).toContain('아크웨이브 신제품 누끼 이미지가 중앙에 크게 들어갑니다.')
    // With no capture attached, nothing claims there is one.
    expect(slots.textContent).not.toContain('참고용')
  })

  it('says a reference capture is attached, and that it is only a reference', async () => {
    const user = userEvent.setup()
    renderShell()
    const palette = screen.getByRole('complementary', { name: '블록 팔레트' })
    await user.click(within(palette).getByRole('button', { name: '이미지' }))
    await user.type(screen.getByLabelText('이미지 내용'), '사은품 구성품 이미지')
    await user.keyboard('{Control>}{Enter}{/Control}')

    const canvas = screen.getByRole('region', { name: '기획 캔버스' })
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'capture.png', { type: 'image/png' })
    await user.upload(canvas.querySelector('.block-card__file') as HTMLInputElement, file)
    await waitFor(() => expect(canvas.querySelector('.block-card__thumb')).not.toBeNull())

    await user.click(screen.getByRole('button', { name: 'AI 요약' }))
    const slots = within(screen.getByRole('dialog', { name: 'AI 요약 미리보기' })).getByLabelText('이미지 자리')
    expect(slots.textContent).toContain('사은품 구성품 이미지')
    expect(slots.textContent).toContain('참고용')
  })
})

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
