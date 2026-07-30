/**
 * Canvas zoom (Phase 7 Step 8B). Zoom is a view-only concern: the controls
 * change how the fixed 840px canvas is displayed but must never alter saved
 * block coordinates. jsdom reports 0-width elements, so fit-to-view resolves to
 * the 100% default here and the discrete +/− steps drive the assertions.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <RequestsProvider>
        <AppShell />
      </RequestsProvider>
    </MemoryRouter>,
  )
}

function zoomBar() {
  return screen.getByRole('group', { name: '캔버스 확대·축소' })
}

/** The live zoom readout (labelled, so it never collides with the 100% button). */
function zoomValue() {
  return (zoomBar().querySelector('.canvas-toolbar__value') as HTMLElement).textContent
}

describe('canvas zoom — view-only display control', () => {
  it('renders zoom controls at 100% by default', () => {
    renderShell()
    const bar = zoomBar()
    expect(zoomValue()).toBe('100%')
    expect(within(bar).getByRole('button', { name: '확대' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: '축소' })).toBeTruthy()
  })

  it('steps up and down through discrete zoom levels', async () => {
    const user = userEvent.setup()
    renderShell()
    const bar = zoomBar()

    await user.click(within(bar).getByRole('button', { name: '확대' }))
    expect(zoomValue()).toBe('125%')

    await user.click(within(bar).getByRole('button', { name: '확대' }))
    expect(zoomValue()).toBe('150%')

    await user.click(within(bar).getByRole('button', { name: '축소' }))
    expect(zoomValue()).toBe('125%')
  })

  it('does not change saved block coordinates when zooming (display only)', async () => {
    const user = userEvent.setup()
    renderShell()
    const palette = screen.getByRole('complementary', { name: '블록 팔레트' })
    const canvas = screen.getByRole('region', { name: '기획 캔버스' })

    await user.click(within(palette).getByRole('button', { name: '글 넣기' }))
    const card = within(canvas).getByRole('button', { name: /문구/ })
    const before = { left: card.style.left, top: card.style.top, width: card.style.width }

    await user.click(within(zoomBar()).getByRole('button', { name: '확대' }))
    await user.click(within(zoomBar()).getByRole('button', { name: '확대' }))

    // Logical coordinates are unchanged — only the sheet's transform scales.
    expect(card.style.left).toBe(before.left)
    expect(card.style.top).toBe(before.top)
    expect(card.style.width).toBe(before.width)

    const sheet = canvas.querySelector('.canvas__sheet') as HTMLElement
    expect(sheet.style.transform).toBe('scale(1.5)')
  })

  it('100% button returns to actual size and clears fit mode', async () => {
    const user = userEvent.setup()
    renderShell()
    const bar = zoomBar()

    const fit = within(bar).getByRole('button', { name: '화면 맞춤' })
    expect(fit.getAttribute('aria-pressed')).toBe('true')

    await user.click(within(bar).getByRole('button', { name: '확대' }))
    expect(fit.getAttribute('aria-pressed')).toBe('false')
    expect(within(bar).getByText('125%')).toBeTruthy()

    await user.click(within(bar).getByRole('button', { name: '100%' }))
    expect(zoomValue()).toBe('100%')
    expect(fit.getAttribute('aria-pressed')).toBe('false')
  })
})
