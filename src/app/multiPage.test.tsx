/**
 * Phase 7 Step 4 — multi-page editor wiring (WORK_PLAN §9). Drives the real
 * editor (AppShell) through the page filmstrip: add pages, switch, keep blocks
 * independent per page, reorder, rename, and delete. No fake data.
 */

import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <RequestsProvider>
        <AppShell />
      </RequestsProvider>
    </MemoryRouter>,
  )
}

const strip = () => screen.getByRole('group', { name: '기획 페이지' })
const canvas = () => screen.getByRole('region', { name: '기획 캔버스' })
const palette = () => screen.getByRole('complementary', { name: '블록 팔레트' })
/** The action menu panel for a page (scoped so per-page buttons aren't ambiguous). */
const menuOf = (title: string) => within(strip()).getByLabelText(`${title} 페이지 작업`)

describe('multi-page editor', () => {
  it('starts with a single page', () => {
    renderEditor()
    const labels = within(strip()).getAllByRole('button').filter((b) => b.className.includes('page-tab__label'))
    expect(labels).toHaveLength(1)
    expect(labels[0]!.textContent).toBe('1페이지')
  })

  it('adds a page and switches to it', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(within(strip()).getByRole('button', { name: '+ 페이지 추가' }))

    const labels = within(strip()).getAllByRole('button').filter((b) => b.className.includes('page-tab__label'))
    expect(labels.map((l) => l.textContent)).toEqual(['1페이지', '2페이지'])
    // The new page is active.
    expect(labels[1]!.getAttribute('aria-current')).toBe('page')
  })

  it('keeps blocks independent per page', async () => {
    const user = userEvent.setup()
    renderEditor()

    // Page 1: add a headline.
    await user.click(within(palette()).getByRole('button', { name: '메인 문구' }))
    expect(within(canvas()).getByRole('button', { name: /메인 문구/ })).toBeTruthy()

    // New page 2 starts empty.
    await user.click(within(strip()).getByRole('button', { name: '+ 페이지 추가' }))
    expect(within(canvas()).queryByRole('button', { name: /메인 문구/ })).toBeNull()

    // Add a benefit on page 2.
    await user.click(within(palette()).getByRole('button', { name: '서브 문구' }))
    expect(within(canvas()).getByRole('button', { name: /서브 문구/ })).toBeTruthy()
    expect(within(canvas()).queryByRole('button', { name: /메인 문구/ })).toBeNull()

    // Back to page 1: the headline is there, the benefit is not.
    const p1 = within(strip()).getAllByRole('button').find((b) => b.textContent === '1페이지')!
    await user.click(p1)
    expect(within(canvas()).getByRole('button', { name: /메인 문구/ })).toBeTruthy()
    expect(within(canvas()).queryByRole('button', { name: /서브 문구/ })).toBeNull()
  })

  it('renames a page through its menu', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(within(strip()).getByLabelText('1페이지 페이지 메뉴'))
    await user.click(within(menuOf('1페이지')).getByRole('button', { name: '이름 변경' }))
    const input = within(strip()).getByRole('textbox', { name: '페이지 이름' })
    await user.clear(input)
    await user.type(input, '표지{Enter}')
    expect(within(strip()).getByRole('button', { name: '표지' })).toBeTruthy()
  })

  it('reorders pages with move left/right', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(within(strip()).getByRole('button', { name: '+ 페이지 추가' })) // now [1페이지, 2페이지], active 2페이지

    // Move the active (2페이지) left via its menu.
    await user.click(within(strip()).getByLabelText('2페이지 페이지 메뉴'))
    await user.click(within(menuOf('2페이지')).getByRole('button', { name: '왼쪽으로 이동' }))

    const labels = within(strip()).getAllByRole('button').filter((b) => b.className.includes('page-tab__label'))
    expect(labels.map((l) => l.textContent)).toEqual(['2페이지', '1페이지'])
  })

  it('deletes a page (and forbids deleting the last one)', async () => {
    const user = userEvent.setup()
    renderEditor()
    // Only one page → delete is disabled.
    await user.click(within(strip()).getByLabelText('1페이지 페이지 메뉴'))
    expect((within(menuOf('1페이지')).getByRole('button', { name: '삭제' }) as HTMLButtonElement).disabled).toBe(true)

    // Add a page, then delete it.
    await user.click(within(strip()).getByRole('button', { name: '+ 페이지 추가' }))
    await user.click(within(strip()).getByLabelText('2페이지 페이지 메뉴'))
    await user.click(within(menuOf('2페이지')).getByRole('button', { name: '삭제' }))

    const labels = within(strip()).getAllByRole('button').filter((b) => b.className.includes('page-tab__label'))
    expect(labels.map((l) => l.textContent)).toEqual(['1페이지'])
  })
})
