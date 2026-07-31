import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'

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

function panels() {
  return {
    palette: screen.getByRole('complementary', { name: '블록 팔레트' }),
    canvas: screen.getByRole('region', { name: '기획 캔버스' }),
    // The right column is the brief library now; blocks are edited on the card.
    library: screen.getByRole('complementary', { name: '내 기획서' }),
  }
}

const selectedCards = (canvas: HTMLElement) => canvas.querySelectorAll('.block-card.is-selected')

describe('AppShell — 3-column layout', () => {
  it('renders palette, canvas, and inspector', () => {
    renderShell()
    const { palette, canvas, library } = panels()
    expect(palette).toBeTruthy()
    expect(canvas).toBeTruthy()
    expect(library).toBeTruthy()
    // Nothing selected initially.
    expect(selectedCards(canvas)).toHaveLength(0)
  })

  it('offers the three authoring tools in the palette', () => {
    renderShell()
    const tools = screen.getByRole('list', { name: '기본 블록' })
    expect(within(tools).getAllByRole('button')).toHaveLength(3)
  })
})

describe('AppShell — block creation & selection', () => {
  it('creates a factory block from the palette and auto-selects it', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))

    // The card appears on the canvas and is the current selection.
    expect(within(canvas).getByRole('button', { name: /문구/ })).toBeTruthy()
    expect(selectedCards(canvas)).toHaveLength(1)
  })

  it('switches selection when another canvas card is clicked', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    await user.keyboard('{Escape}')
    await user.click(within(palette).getByRole('button', { name: '이미지' }))
    await user.keyboard('{Escape}')
    // The image slot is the new selection.
    expect(selectedCards(canvas)[0]!.textContent).toContain('이미지')

    // Clicking the text card moves the selection to it.
    await user.click(within(canvas).getByRole('button', { name: /문구/ }))
    expect(selectedCards(canvas)).toHaveLength(1)
    expect(selectedCards(canvas)[0]!.className).toContain('block-card--bare')
  })
})

describe('AppShell — deletion', () => {
  it('deletes the selected block via the card menu and clears selection', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    expect(within(canvas).getByRole('button', { name: /문구/ })).toBeTruthy()

    // Delete lives on the card ⋯ menu.
    await user.click(within(canvas).getByRole('button', { name: '삭제' }))

    expect(within(canvas).queryByRole('button', { name: /문구/ })).toBeNull()
    expect(selectedCards(canvas)).toHaveLength(0)
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
