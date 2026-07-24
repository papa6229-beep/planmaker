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

  it('separates design-input blocks from reference/publishing blocks', () => {
    renderShell()
    expect(screen.getByRole('region', { name: '디자인 입력 블록' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '퍼블리싱 정보' })).toBeTruthy()
  })
})

describe('AppShell — block creation & selection', () => {
  it('creates a factory block from the palette and auto-selects it', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))

    // Card appears on the canvas…
    expect(within(canvas).getByRole('button', { name: /메인 문구/ })).toBeTruthy()
    // …and the inspector shows it as selected (empty-state gone, edit fields present).
    expect(within(inspector).queryByText('선택된 블록이 없습니다')).toBeNull()
    expect(within(inspector).getByLabelText('라벨')).toBeTruthy()
  })

  it('switches selection when another canvas card is clicked', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))
    await user.click(within(palette).getByRole('button', { name: '서브 문구' }))
    // Sub headline is selected now (inspector header shows its type).
    expect(within(inspector).getByText('서브 문구')).toBeTruthy()

    // Click the main headline card → inspector reflects it.
    await user.click(within(canvas).getByRole('button', { name: /메인 문구/ }))
    expect(within(inspector).getByText('메인 문구')).toBeTruthy()
    expect(within(inspector).queryByText('서브 문구')).toBeNull()
  })
})

describe('AppShell — deletion', () => {
  it('deletes the selected block via the card menu and clears selection', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))
    expect(within(canvas).getByRole('button', { name: /메인 문구/ })).toBeTruthy()

    // The inspector no longer has a delete button (§11.1); delete via the card ⋯ menu.
    await user.click(within(canvas).getByRole('button', { name: '삭제' }))

    expect(within(canvas).queryByRole('button', { name: /메인 문구/ })).toBeNull()
    expect(within(inspector).getByText('선택된 블록이 없습니다')).toBeTruthy()
  })

  it('deletes with the Delete key when focus is not in a text field', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas } = panels()

    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))
    const card = within(canvas).getByRole('button', { name: /메인 문구/ })
    await user.click(card) // focus is on the card button (not editable)
    await user.keyboard('{Delete}')

    expect(within(canvas).queryByRole('button', { name: /메인 문구/ })).toBeNull()
  })

  it('does NOT delete a block when Delete is pressed inside a text field', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))
    const labelInput = within(inspector).getByLabelText('라벨')
    await user.click(labelInput)
    await user.keyboard('{Delete}')

    // Block survives — the shortcut is suppressed while typing.
    expect(within(canvas).getByRole('button', { name: /메인 문구/ })).toBeTruthy()
  })
})

describe('AppShell — editing', () => {
  it('edits the label and reflects it on the canvas card', async () => {
    const user = userEvent.setup()
    renderShell()
    const { palette, canvas, inspector } = panels()

    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))
    const labelInput = within(inspector).getByLabelText('라벨')
    await user.clear(labelInput)
    await user.type(labelInput, '여름 세일 헤드라인')

    expect(within(canvas).getByRole('button', { name: /여름 세일 헤드라인/ })).toBeTruthy()
  })
})
