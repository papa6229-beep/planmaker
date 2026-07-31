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

function panels() {
  return {
    palette: screen.getByRole('complementary', { name: '블록 팔레트' }),
    canvas: screen.getByRole('region', { name: '기획 캔버스' }),
    inspector: screen.getByRole('complementary', { name: '선택 블록 설정' }),
  }
}

describe('AppShell — 3-column layout', () => {
  it('renders palette, canvas, and inspector', () => {
    renderShell()
    const { palette, canvas, inspector } = panels()
    expect(palette).toBeTruthy()
    expect(canvas).toBeTruthy()
    expect(inspector).toBeTruthy()
    // Nothing selected initially.
    expect(within(inspector).getByText('선택된 블록이 없습니다')).toBeTruthy()
  })

  it('offers the four authoring tools in the palette', () => {
    renderShell()
    const tools = screen.getByRole('list', { name: '기본 블록' })
    expect(within(tools).getAllByRole('button')).toHaveLength(4)
  })
})

describe('AppShell — block creation & selection', () => {
  it('creates a factory block from the palette and auto-selects it', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))

    // Card appears on the canvas…
    expect(within(canvas).getByRole('button', { name: /문구/ })).toBeTruthy()
    // …and the inspector shows it as selected (empty-state gone).
    expect(within(inspector).queryByText('선택된 블록이 없습니다')).toBeNull()
    expect(within(inspector).getByText('글 넣기')).toBeTruthy()
  })

  it('switches selection when another canvas card is clicked', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    await user.click(within(palette).getByRole('button', { name: '요청 메모' }))
    // The memo is selected now (inspector header shows its tool name).
    expect(within(inspector).getByText('요청 메모')).toBeTruthy()

    // Click the text card → inspector reflects it.
    await user.click(within(canvas).getByRole('button', { name: /문구/ }))
    expect(within(inspector).getByText('글 넣기')).toBeTruthy()
    expect(within(inspector).queryByText('요청 메모')).toBeNull()
  })
})

describe('AppShell — deletion', () => {
  it('deletes the selected block via the card menu and clears selection', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    expect(within(canvas).getByRole('button', { name: /문구/ })).toBeTruthy()

    // The inspector no longer has a delete button (§11.1); delete via the card ⋯ menu.
    await user.click(within(canvas).getByRole('button', { name: '삭제' }))

    expect(within(canvas).queryByRole('button', { name: /문구/ })).toBeNull()
    expect(within(inspector).getByText('선택된 블록이 없습니다')).toBeTruthy()
  })

  it('deletes with the Delete key when focus is not in a text field', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    const card = within(canvas).getByRole('button', { name: /문구/ })
    await user.click(card) // focus is on the card button (not editable)
    await user.keyboard('{Delete}')

    expect(within(canvas).queryByRole('button', { name: /문구/ })).toBeNull()
  })

  it('does NOT delete a block when Delete is pressed inside a text field', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    // Editing happens in the block itself now; Delete inside it must not delete.
    await user.dblClick(canvas.querySelector('.block-card') as HTMLElement)
    await user.keyboard('{Delete}')

    expect(canvas.querySelectorAll('.block-card')).toHaveLength(1)
  })
})

describe('AppShell — editing', () => {
  it('reflects edited wording on the canvas card', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    await user.dblClick(canvas.querySelector('.block-card') as HTMLElement)
    await user.type(screen.getByLabelText('문구 내용'), '여름 세일 헤드라인')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(within(canvas).getByRole('button', { name: /여름 세일 헤드라인/ })).toBeTruthy()
  })
})
