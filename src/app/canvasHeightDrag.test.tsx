/**
 * 페이지 길이 손잡이 — 한 번 잡고 끝까지 (첫 사용 흐름 §3, §11 공통).
 *
 * 손잡이를 한 번 잡으면 중앙 작업영역이 스스로 스크롤되면서 페이지가 계속
 * 자라야 한다. 포인터를 놓는 순간 스크롤도 높이 변경도 완전히 멈춰야 하고,
 * 한 번의 드래그는 실행 취소 한 번으로 되돌아와야 한다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { AppSurfaceProvider } from './AppSurfaceContext'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { autoScrollStep, heightForPointer, EDGE_ZONE, MAX_SCROLL_STEP } from '../features/editor/heightDrag'
import { clearAll, resetAssetStoreForTests } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import { createEmptyDocument } from '../domain/pageSchema'
import { createEmptyProject } from '../domain/factory'
import type { BriefDocument } from '../domain/pageSchema'

describe('§11 가장자리 자동 스크롤과 좌표 환산', () => {
  const TOP = 100
  const BOTTOM = 700

  it('scrolls only near the edges, faster the deeper the pointer goes', () => {
    expect(autoScrollStep(400, TOP, BOTTOM)).toBe(0)
    expect(autoScrollStep(BOTTOM - EDGE_ZONE - 1, TOP, BOTTOM)).toBe(0)
    expect(autoScrollStep(TOP + EDGE_ZONE + 1, TOP, BOTTOM)).toBe(0)

    const shallow = autoScrollStep(BOTTOM - EDGE_ZONE / 2, TOP, BOTTOM)
    const deep = autoScrollStep(BOTTOM - 1, TOP, BOTTOM)
    expect(shallow).toBeGreaterThan(0)
    expect(deep).toBeGreaterThan(shallow)
    expect(deep).toBeLessThanOrEqual(MAX_SCROLL_STEP)

    expect(autoScrollStep(TOP + EDGE_ZONE / 2, TOP, BOTTOM)).toBeLessThan(0)
  })

  it('keeps scrolling at full speed when the pointer leaves the work area', () => {
    expect(autoScrollStep(BOTTOM + 200, TOP, BOTTOM)).toBe(MAX_SCROLL_STEP)
    expect(autoScrollStep(TOP - 200, TOP, BOTTOM)).toBe(-MAX_SCROLL_STEP)
  })

  it('converts screen position into document height at any zoom', () => {
    // 100%: 종이 위쪽이 화면 50px에 있고 포인터가 1050px이면 1000px 지점이다.
    expect(heightForPointer(1050, 50, 1, 0)).toBe(1000)
    // 50% 축소: 같은 화면 거리가 문서에서는 두 배다.
    expect(heightForPointer(1050, 50, 0.5, 0)).toBe(2000)
    // 잡은 지점(손잡이는 페이지 끝보다 조금 아래)은 그대로 유지된다.
    expect(heightForPointer(1050, 50, 1, 24)).toBe(976)
  })
})

describe('§3 손잡이 한 번으로 긴 페이지 늘이기', () => {
  const stored: BriefDocument = createEmptyDocument(createEmptyProject('길이 시험'))

  const binding = {
    load: async () => stored,
    save: async () => {},
  }

  beforeEach(async () => {
    resetAssetStoreForTests()
    resetDocumentStoreForTests()
    await clearAll()
    await clearAllDocuments()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** 레이아웃이 없는 jsdom에 작업영역과 종이의 화면 좌표를 심는다. */
  function layout(canvasTop: number, canvasBottom: number, sheetTop: () => number) {
    const canvas = document.querySelector('.canvas') as HTMLElement
    const sheet = document.querySelector('.canvas__sheet') as HTMLElement
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: canvasTop, bottom: canvasBottom, left: 0, right: 800, width: 800, height: canvasBottom - canvasTop }),
    })
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: canvasBottom - canvasTop })
    Object.defineProperty(canvas, 'scrollHeight', { configurable: true, value: 100000 })
    Object.defineProperty(sheet, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: sheetTop(), bottom: sheetTop() + 1000, left: 0, right: 840, width: 840, height: 1000 }),
    })
    return { canvas, sheet }
  }

  async function openEditor() {
    render(
      <MemoryRouter initialEntries={['/briefs/x']}>
        <AppSurfaceProvider surface="brief-writer">
          <DocumentsProvider>
            <AppShell binding={binding} />
          </DocumentsProvider>
        </AppSurfaceProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.canvas__height-handle')).not.toBeNull())
  }

  const handle = () => screen.getByRole('button', { name: '페이지 길이 조절' })
  const sheetHeight = () =>
    parseFloat((document.querySelector('.canvas__sheet') as HTMLElement).style.height)

  it('auto-scrolls the work area and keeps growing the page in one drag', async () => {
    await openEditor()
    expect(sheetHeight()).toBe(1000)

    // 작업영역은 화면 100~700, 종이 위쪽은 스크롤에 따라 올라간다.
    const { canvas } = layout(100, 700, () => 120 - canvas.scrollTop)
    canvas.scrollTop = 0

    // 손잡이를 잡고 아래 가장자리 밖까지 끌어 둔 채 가만히 둔다.
    fireEvent.pointerDown(handle(), { button: 0, clientY: 690 })
    fireEvent.pointerMove(window, { clientY: 900 })

    const afterFirstMove = sheetHeight()
    expect(afterFirstMove).toBeGreaterThan(1000)

    // 포인터는 그대로인데 작업영역이 스스로 스크롤되며 높이가 계속 자란다.
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(canvas.scrollTop).toBeGreaterThan(0)
    expect(sheetHeight()).toBeGreaterThan(3000)

    const grown = sheetHeight()
    const scrolled = canvas.scrollTop

    // 놓으면 스크롤도 높이도 즉시 멈춘다.
    fireEvent.pointerUp(window, { clientY: 900 })
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(canvas.scrollTop).toBe(scrolled)
    expect(sheetHeight()).toBe(grown)

    // 놓은 뒤의 포인터 이동은 더 이상 페이지를 바꾸지 않는다.
    fireEvent.pointerMove(window, { clientY: 200 })
    expect(sheetHeight()).toBe(grown)
  })

  it('undoes a whole drag with one 실행 취소', async () => {
    await openEditor()
    const { canvas } = layout(100, 700, () => 120 - canvas.scrollTop)
    canvas.scrollTop = 0

    fireEvent.pointerDown(handle(), { button: 0, clientY: 690 })
    fireEvent.pointerMove(window, { clientY: 800 })
    fireEvent.pointerMove(window, { clientY: 900 })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    fireEvent.pointerUp(window, { clientY: 900 })
    expect(sheetHeight()).toBeGreaterThan(1000)

    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => expect(sheetHeight()).toBe(1000))
  })

  it('stops the drag on Escape and on pointercancel', async () => {
    await openEditor()
    const { canvas } = layout(100, 700, () => 120 - canvas.scrollTop)
    canvas.scrollTop = 0

    fireEvent.pointerDown(handle(), { button: 0, clientY: 690 })
    fireEvent.pointerMove(window, { clientY: 900 })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    fireEvent.keyDown(window, { key: 'Escape' })
    const afterEscape = { height: sheetHeight(), scroll: canvas.scrollTop }
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(canvas.scrollTop).toBe(afterEscape.scroll)
    expect(sheetHeight()).toBe(afterEscape.height)
    // Escape 뒤의 포인터 이동은 더 이상 페이지를 바꾸지 않는다.
    fireEvent.pointerMove(window, { clientY: 300 })
    expect(sheetHeight()).toBe(afterEscape.height)

    fireEvent.pointerDown(handle(), { button: 0, clientY: 690 })
    fireEvent.pointerMove(window, { clientY: 900 })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    fireEvent.pointerCancel(window, {})
    const afterCancel = { height: sheetHeight(), scroll: canvas.scrollTop }
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(canvas.scrollTop).toBe(afterCancel.scroll)
    expect(sheetHeight()).toBe(afterCancel.height)
    fireEvent.pointerMove(window, { clientY: 300 })
    expect(sheetHeight()).toBe(afterCancel.height)
  })
})
