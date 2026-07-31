import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {/* the internal screens live on the studio surface (타 팀 배포 §5). */}
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
}

describe('AppRoutes — Phase 7 Step 2 entry gate', () => {
  // §12.1 — the gate renders both entry cards
  it('renders both entry cards at /gate', () => {
    renderAt('/gate')
    expect(screen.getByRole('heading', { level: 1, name: '어떤 작업을 시작할까요?' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /기획서 생성/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /이미지 생성/ })).toBeTruthy()
  })

  // §12.8 — the common app header (brand) renders on the gate
  it('renders the common app header brand', () => {
    renderAt('/gate')
    expect(screen.getByRole('link', { name: /Event Brief Builder 홈/ })).toBeTruthy()
  })

  // §12.9 — entry cards are keyboard-accessible links (real anchors with hrefs)
  it('exposes the entry cards as focusable links with hrefs', () => {
    renderAt('/gate')
    const briefCard = screen.getByRole('link', { name: /기획서 생성/ })
    const imageCard = screen.getByRole('link', { name: /이미지 생성/ })
    expect(briefCard.tagName).toBe('A')
    expect(briefCard.getAttribute('href')).toBe('/briefs')
    expect(imageCard.tagName).toBe('A')
    expect(imageCard.getAttribute('href')).toBe('/image-requests')
  })

  // §12.2 — the 기획서 생성 card navigates to /briefs
  it('navigates from the 기획서 생성 card to /briefs', async () => {
    const user = userEvent.setup()
    renderAt('/gate')
    await user.click(screen.getByRole('link', { name: /기획서 생성/ }))
    expect(screen.getByRole('heading', { level: 1, name: '기획서 생성' })).toBeTruthy()
    expect(screen.getByText('아직 작성하거나 전달한 기획서가 없습니다')).toBeTruthy()
  })

  // §12.3 — the 이미지 생성 card navigates to /image-requests
  it('navigates from the 이미지 생성 card to /image-requests', async () => {
    const user = userEvent.setup()
    renderAt('/gate')
    await user.click(screen.getByRole('link', { name: /이미지 생성/ }))
    expect(screen.getByRole('heading', { level: 1, name: '이미지 생성' })).toBeTruthy()
    expect(screen.getByText('아직 전달된 이미지 작업 요청이 없습니다')).toBeTruthy()
  })

  // §12.7 — with no delivered requests, the image card shows no counts, only a
  // truthful "아직 전달된 요청이 없습니다" note (never fabricated numbers).
  it('shows no fake request counts on the image card', () => {
    const { container } = renderAt('/gate')
    expect(container.querySelector('.entry-card__stats')).toBeNull()
    expect(screen.getByText('아직 전달된 요청이 없습니다')).toBeTruthy()
  })

  // §12.5 — /briefs has an honest empty state, no fake list and no fake counts
  it('renders /briefs with an empty state and no fake list', () => {
    const { container } = renderAt('/briefs')
    expect(screen.getByRole('heading', { level: 1, name: '기획서 생성' })).toBeTruthy()
    expect(screen.getByText('아직 작성하거나 전달한 기획서가 없습니다')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(container.querySelector('.entry-card__stats')).toBeNull()
  })

  // §12.4 — the 새 기획서 작성 action opens the editor
  it('opens the editor from the 새 기획서 작성 action', async () => {
    const user = userEvent.setup()
    renderAt('/briefs')
    const [primary] = screen.getAllByRole('link', { name: '새 기획서 작성' })
    expect(primary?.getAttribute('href')).toBe('/briefs/new')
    if (primary) await user.click(primary)
    // /briefs/new mints a brief and hands over to /briefs/:id, so the editor
    // appears once that write resolves.
    expect(await screen.findByRole('complementary', { name: '블록 팔레트' })).toBeTruthy()
  })

  // §12.6 — /image-requests renders a polished empty state with truthful zero counts
  it('renders /image-requests empty state with zero (not fake) counts', () => {
    renderAt('/image-requests')
    expect(screen.getByRole('heading', { level: 1, name: '이미지 생성' })).toBeTruthy()
    expect(screen.getByText('아직 전달된 이미지 작업 요청이 없습니다')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)

    const summary = screen.getByLabelText('요청 상태 요약')
    expect(within(summary).getByText('신규')).toBeTruthy()
    expect(within(summary).getByText('작업 중')).toBeTruthy()
    expect(within(summary).getByText('완료')).toBeTruthy()
    // every displayed count is a truthful zero
    expect(within(summary).getAllByText('0')).toHaveLength(3)
  })

  // §12.11 — the existing editor mounts unchanged at /briefs/new and /briefs/:id
  it('mounts the editor at /briefs/new after creating the brief', async () => {
    renderAt('/briefs/new')
    expect(await screen.findByRole('complementary', { name: '블록 팔레트' })).toBeTruthy()
  })

  it('mounts the editor at /briefs/:id', () => {
    renderAt('/briefs/abc123')
    expect(screen.getByRole('complementary', { name: '블록 팔레트' })).toBeTruthy()
  })

  // §12.10 — an unknown route, and the root itself, land in the brief maker:
  // a planner opening the app is here to write a brief (v1 마감 §10.2).
  it('sends unknown routes and the root into the brief maker', () => {
    renderAt('/nonexistent')
    expect(screen.getByText('기획서를 준비하는 중입니다…')).toBeTruthy()

    renderAt('/')
    expect(screen.getAllByText('기획서를 준비하는 중입니다…').length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { level: 1, name: '어떤 작업을 시작할까요?' })).toBeNull()
  })

  // §12.12 — deep links resolve directly (refresh/direct-entry compatible)
  it('resolves deep links directly for refresh compatibility', () => {
    renderAt('/image-requests')
    expect(screen.getByRole('heading', { level: 1, name: '이미지 생성' })).toBeTruthy()
  })
})
