import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
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

function panels() {
  return {
    palette: screen.getByRole('complementary', { name: '블록 팔레트' }),
    canvas: screen.getByRole('region', { name: '기획 캔버스' }),
    inspector: screen.getByRole('complementary', { name: '선택 블록 설정' }),
  }
}

const px = (v: string) => Number.parseFloat(v)

describe('canvas editing — drag to move', () => {
  it('moves a block by the pointer delta (accounting for canvas scale) and undoes it', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    const card = within(canvas).getByRole('button', { name: /문구/ })
    const startLeft = px(card.style.left)

    // Drag 60 screen px right. Zoom defaults to 100% (1:1) in jsdom (fit-to-view
    // resolves to the default when the container reports 0 width), so screen
    // delta == canvas delta.
    fireEvent.pointerDown(card, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 160, clientY: 100 })
    fireEvent.pointerUp(window, { clientX: 160, clientY: 100 })

    expect(px(card.style.left)).toBeCloseTo(startLeft + 60, 0)

    // Undo returns it to the start.
    const { canvas: canvas2 } = panels()
    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    const cardAfter = within(canvas2).getByRole('button', { name: /문구/ })
    expect(px(cardAfter.style.left)).toBeCloseTo(startLeft, 0)
  })
})

describe('canvas editing — resize', () => {
  it('resizes from the SE handle', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    const card = within(canvas).getByRole('button', { name: /문구/ })
    const startWidth = px(card.style.width)

    const seHandle = container.querySelector('.block-card__handle--se')
    expect(seHandle).not.toBeNull()

    fireEvent.pointerDown(seHandle!, { button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(window, { clientX: 260, clientY: 200 }) // +60 screen → +60 canvas at 100%
    fireEvent.pointerUp(window, { clientX: 260, clientY: 200 })

    expect(px(card.style.width)).toBeCloseTo(startWidth + 60, 0)
  })
})

describe('canvas editing — duplicate', () => {
  it('duplicates the selected block from the card menu', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    expect(canvas.querySelectorAll('.block-card')).toHaveLength(1)

    // 복제 moved onto the card's ⋯ menu (§8 — the right panel no longer edits).
    await user.click(within(canvas).getByRole('button', { name: '블록 복제' }))
    expect(canvas.querySelectorAll('.block-card')).toHaveLength(2)
  })
})

describe('canvas editing — multi-selection', () => {
  it('shift-selects a second block and reports the multi-selection', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '이미지' }))
    await user.click(within(palette).getByRole('button', { name: '요청 메모' }))

    const cards = Array.from(canvas.querySelectorAll('.block-card')) as HTMLElement[]
    await user.click(cards[0]!)
    fireEvent.pointerDown(cards[1]!, { button: 0, clientX: 10, clientY: 10, shiftKey: true })
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 })

    expect(within(inspector).getByText('2개 블록 선택됨')).toBeTruthy()
  })
})

describe('canvas editing — scales to 20+ blocks', () => {
  it('renders 20 blocks and keeps the brief valid', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    const add = within(palette).getByRole('button', { name: '글 넣기' })
    for (let i = 0; i < 20; i++) {
      await user.click(add)
    }
    // 20 free-text cards on the canvas.
    expect(within(canvas).getAllByRole('button', { name: /문구/ })).toHaveLength(20)
  })
})
