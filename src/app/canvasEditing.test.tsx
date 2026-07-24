import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'

/** The editor runs inside the router (mounted at /briefs/new · /briefs/:id). */
function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <AppShell />
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

    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))
    const card = within(canvas).getByRole('button', { name: /메인 문구/ })
    const startLeft = px(card.style.left)

    // Drag 60 screen px right → 100 canvas px at scale 0.6.
    fireEvent.pointerDown(card, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 160, clientY: 100 })
    fireEvent.pointerUp(window, { clientX: 160, clientY: 100 })

    expect(px(card.style.left)).toBeCloseTo(startLeft + 100, 0)

    // Undo returns it to the start.
    const { canvas: canvas2 } = panels()
    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    const cardAfter = within(canvas2).getByRole('button', { name: /메인 문구/ })
    expect(px(cardAfter.style.left)).toBeCloseTo(startLeft, 0)
  })
})

describe('canvas editing — resize', () => {
  it('resizes from the SE handle', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))
    const card = within(canvas).getByRole('button', { name: /메인 문구/ })
    const startWidth = px(card.style.width)

    const seHandle = container.querySelector('.block-card__handle--se')
    expect(seHandle).not.toBeNull()

    fireEvent.pointerDown(seHandle!, { button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(window, { clientX: 260, clientY: 200 }) // +60 screen → +100 canvas
    fireEvent.pointerUp(window, { clientX: 260, clientY: 200 })

    expect(px(card.style.width)).toBeCloseTo(startWidth + 100, 0)
  })
})

describe('canvas editing — duplicate', () => {
  it('duplicates the selected block from the inspector', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))
    expect(within(canvas).getAllByRole('button', { name: /메인 문구/ })).toHaveLength(1)

    await user.click(within(inspector).getByRole('button', { name: '블록 복제' }))
    expect(within(canvas).getAllByRole('button', { name: /메인 문구/ })).toHaveLength(2)
  })
})

describe('canvas editing — grouping', () => {
  it('groups two shift-selected blocks and can ungroup them', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '메인 제품 이미지' }))
    await user.click(within(palette).getByRole('button', { name: '보조 제품 이미지' }))

    const cards = within(canvas).getAllByRole('button')
    // Select first, then shift-select second → multi-selection.
    await user.click(cards[0]!)
    fireEvent.pointerDown(cards[1]!, { button: 0, clientX: 10, clientY: 10, shiftKey: true })
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 })

    await user.click(within(inspector).getByRole('button', { name: '그룹으로 묶기' }))
    expect(container.querySelectorAll('.block-card--grouped')).toHaveLength(2)

    await user.click(within(inspector).getByRole('button', { name: '그룹 해제' }))
    expect(container.querySelectorAll('.block-card--grouped')).toHaveLength(0)
  })
})

describe('canvas editing — scales to 20+ blocks', () => {
  it('renders 20 blocks and keeps the brief valid', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    const add = within(palette).getByRole('button', { name: '자유 텍스트' })
    for (let i = 0; i < 20; i++) {
      await user.click(add)
    }
    // 20 free-text cards on the canvas.
    expect(within(canvas).getAllByRole('button', { name: /자유 텍스트/ })).toHaveLength(20)
  })
})
