/**
 * 긴급 교정 — 페이지 탭의 ⋯ 메뉴는 사람이 실제로 누를 수 있어야 한다.
 *
 * The menu used to be a `<summary>` inside `<details>`: the accessibility tree
 * called it a generic element, the target was 31×22px, Enter did not open it,
 * Esc and an outside click did not close it, and two menus could sit open at
 * once. These tests pin the contract a person actually needs — a real button,
 * a real target, one menu at a time, and keyboard parity with the mouse.
 *
 * The pointer-size rule cannot be measured in jsdom (no layout), so it is
 * pinned where it is declared: the stylesheet.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { clearAll, resetAssetStoreForTests } from '../services/assetStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'

vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

function renderEditor() {
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

/** Starts a blank brief with `count` pages and returns a user-event session. */
async function withPages(count: number) {
  const user = userEvent.setup()
  renderEditor()
  await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
  for (let i = 1; i < count; i += 1) {
    await user.click(screen.getByRole('button', { name: '+ 페이지 추가' }))
  }
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^\d+페이지 페이지 메뉴$/ }).length).toBe(count))
  return user
}

const trigger = (n: number) => screen.getByRole('button', { name: `${n}페이지 페이지 메뉴` })
const panels = () => document.querySelectorAll('.page-tab__menu-panel')
const openPanelLabel = () => panels()[0]?.getAttribute('aria-label') ?? null

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
  resetDocumentStoreForTests()
  await clearAllDocuments()
})

describe('페이지 ⋯ 메뉴', () => {
  it('is a real button, not a generic element', async () => {
    await withPages(2)
    const el = trigger(2)
    expect(el.tagName).toBe('BUTTON')
    expect(el.getAttribute('type')).toBe('button')
    expect(el.getAttribute('aria-haspopup')).toBe('menu')
    expect(el.getAttribute('aria-expanded')).toBe('false')
  })

  it('declares a pointer target of at least 36×32px', () => {
    const css = readFileSync('src/styles/global.css', 'utf8')
    const rule = /\.page-tab__menu-trigger\s*\{([^}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    const body = rule![1]!
    const minWidth = /min-width:\s*(\d+)px/.exec(body)
    const minHeight = /min-height:\s*(\d+)px/.exec(body)
    expect(Number(minWidth?.[1])).toBeGreaterThanOrEqual(36)
    expect(Number(minHeight?.[1])).toBeGreaterThanOrEqual(32)
  })

  it('opens with a click, and marks itself expanded', async () => {
    const user = await withPages(3)
    await user.click(trigger(3))
    expect(panels().length).toBe(1)
    expect(openPanelLabel()).toBe('3페이지 페이지 작업')
    expect(trigger(3).getAttribute('aria-expanded')).toBe('true')
  })

  it('opens with Enter and with Space', async () => {
    const user = await withPages(2)
    trigger(2).focus()
    await user.keyboard('{Enter}')
    expect(openPanelLabel()).toBe('2페이지 페이지 작업')

    await user.keyboard('{Escape}')
    expect(panels().length).toBe(0)

    trigger(2).focus()
    await user.keyboard(' ')
    expect(openPanelLabel()).toBe('2페이지 페이지 작업')
  })

  it('never leaves the click on ⋯ switching the page', async () => {
    const user = await withPages(3)
    await user.click(screen.getByRole('button', { name: '1페이지' }))
    await user.click(trigger(3))
    expect(document.querySelector('.page-tab.is-active .page-tab__label')?.textContent).toBe('1페이지')
  })

  it('switches to another page menu on the first click, never showing two at once', async () => {
    const user = await withPages(3)
    await user.click(trigger(1))
    expect(openPanelLabel()).toBe('1페이지 페이지 작업')

    await user.click(trigger(2))
    expect(panels().length).toBe(1)
    expect(openPanelLabel()).toBe('2페이지 페이지 작업')
  })

  it('closes on Esc and on a click outside the strip', async () => {
    const user = await withPages(2)
    await user.click(trigger(2))
    await user.keyboard('{Escape}')
    expect(panels().length).toBe(0)

    await user.click(trigger(2))
    expect(panels().length).toBe(1)
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(panels().length).toBe(0))
  })

  it('closes when the same ⋯ is clicked again', async () => {
    const user = await withPages(2)
    await user.click(trigger(2))
    await user.click(trigger(2))
    expect(panels().length).toBe(0)
  })

  it('shows 이름 변경 · 복제 · 이동 · 페이지 삭제, with 삭제 usable from two pages up', async () => {
    const user = await withPages(2)
    await user.click(trigger(2))
    const panel = screen.getByLabelText('2페이지 페이지 작업')
    const labels = within(panel).getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual(['이름 변경', '복제', '왼쪽으로 이동', '오른쪽으로 이동', '페이지 삭제'])
    expect(within(panel).getByRole('button', { name: '페이지 삭제' }).hasAttribute('disabled')).toBe(false)
  })

  it('keeps 페이지 삭제 disabled while a single page is left', async () => {
    const user = await withPages(1)
    await user.click(trigger(1))
    const panel = screen.getByLabelText('1페이지 페이지 작업')
    expect(within(panel).getByRole('button', { name: '페이지 삭제' }).hasAttribute('disabled')).toBe(true)
    expect(within(panel).getByText('마지막 페이지는 삭제할 수 없습니다')).toBeTruthy()
  })

  it('is drawn against the viewport so the scrolling strip cannot clip it', async () => {
    const user = await withPages(2)
    await user.click(trigger(2))
    const css = readFileSync('src/styles/global.css', 'utf8')
    const rule = /\.page-tab__menu-panel\s*\{([^}]*)\}/.exec(css)
    expect(rule![1]).toMatch(/position:\s*fixed/)
    // The panel carries the coordinates it was opened at, not the strip's flow.
    expect((panels()[0] as HTMLElement).style.top).not.toBe('')
  })
})
