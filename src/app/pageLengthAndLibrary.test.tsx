/**
 * Focused tests for 손검수 마감 2 — page length, page deletion, brief deletion,
 * and finding a brief by the month it was written in.
 *
 * The through-line is that each page is its own length (the width stays 840),
 * that nothing is deleted without being asked, and that "when was this written"
 * means the day the planner started it, in their own calendar — not the last
 * time it was saved, and not whatever UTC says.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { clearAll, resetAssetStoreForTests } from '../services/assetStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import {
  clearAllDocuments,
  createDocument,
  listDocuments,
  loadDocumentById,
  resetDocumentStoreForTests,
} from '../services/documentStore'
import { createEmptyDocument, createPage } from '../domain/pageSchema'
import { NEW_PAGE_HEIGHT } from '../domain/briefSchema'
import { addPage, duplicatePage } from '../domain/pageOps'
import { createBlock, createEmptyProject } from '../domain/factory'
import { clampCanvasHeight, MAX_CANVAS_HEIGHT, MIN_CANVAS_HEIGHT } from '../features/editor/canvasGeometry'
import { createdMonths, groupByCreatedDay, localMonthKey } from '../domain/briefCalendar'
import { packageEventDocument } from '../services/eventBriefExport'
import { readEventDocument } from '../services/eventBriefImport'
import { createWorkRequest } from '../domain/workRequest'
import type { BriefDocument } from '../domain/pageSchema'

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

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

const canvas = () => screen.getByRole('region', { name: '기획 캔버스' })
const sheet = () => canvas().querySelector('.canvas__sheet') as HTMLElement
const library = () => screen.getByRole('complementary', { name: '내 기획서' })
const px = (v: string) => Number.parseFloat(v)

function docNamed(title: string, createdAt: number): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject(title))
  doc.pages[0]!.blocks = [createBlock('free_text', { id: `blk_${createdAt}`, label: '문구', content: title })]
  return doc
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
  resetDocumentStoreForTests()
  await clearAllDocuments()
})

describe('§3 페이지마다 다른 길이', () => {
  it('starts a new page at 840×1000', () => {
    const page = createPage({ title: '1페이지' })
    expect(page.canvasWidth).toBe(840)
    expect(page.canvasHeight).toBe(NEW_PAGE_HEIGHT)
    expect(NEW_PAGE_HEIGHT).toBe(1000)
  })

  it('changes only the page being edited', () => {
    const doc = addPage(createEmptyDocument(createEmptyProject('두 장')))
    const tall = { ...doc, pages: [{ ...doc.pages[0]!, canvasHeight: 1600 }, doc.pages[1]!] }
    expect(tall.pages[0]!.canvasHeight).toBe(1600)
    expect(tall.pages[1]!.canvasHeight).toBe(NEW_PAGE_HEIGHT)
  })

  it('never shortens a page past the wording on it, and holds the outer limits', () => {
    const blocks = [createBlock('free_text', { position: { x: 0, y: 900, width: 300, height: 100 } })]
    // The lowest block ends at 1000; 80px of air is kept under it.
    expect(clampCanvasHeight(500, blocks)).toBe(1080)
    expect(clampCanvasHeight(10, [])).toBe(MIN_CANVAS_HEIGHT)
    expect(clampCanvasHeight(999999, [])).toBe(MAX_CANVAS_HEIGHT)
  })

  it('carries the page length through duplication and delivery', async () => {
    const doc = docNamed('길이 보존', 1000)
    doc.pages[0]!.canvasHeight = 1600
    const copied = duplicatePage(doc, doc.pages[0]!.id)
    expect(copied.pages[1]!.canvasHeight).toBe(1600)

    const request = createWorkRequest('req_1', doc, '2026-07-31T00:00:00.000Z')
    expect(request.submittedDoc.pages[0]!.canvasHeight).toBe(1600)

    const pkg = await packageEventDocument({ doc, assets: [], previews: [], createdAt: 't' })
    const reopened = (await readEventDocument(pkg.blob)).doc
    expect(reopened.pages[0]!.canvasHeight).toBe(1600)
  })

  it('drags the page longer from the handle, and one undo puts it back', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    const startHeight = px(sheet().style.height)
    expect(startHeight).toBe(NEW_PAGE_HEIGHT)

    const handle = screen.getByRole('button', { name: '페이지 길이 조절' })
    fireEvent.pointerDown(handle, { button: 0, clientY: 500 })
    fireEvent.pointerMove(window, { clientY: 800 })
    fireEvent.pointerUp(window, { clientY: 800 })

    expect(px(sheet().style.height)).toBe(startHeight + 300)
    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    expect(px(sheet().style.height)).toBe(startHeight)
  })

  it('keeps each page at its own length across a save and reload', async () => {
    const doc = createEmptyDocument(createEmptyProject('두 길이'))
    doc.pages[0]!.canvasHeight = 1600
    const withSecond = addPage(doc)
    const id = await createDocument(withSecond, 1000)

    const reloaded = await loadDocumentById(id)
    expect(reloaded!.pages[0]!.canvasHeight).toBe(1600)
    expect(reloaded!.pages[1]!.canvasHeight).toBe(NEW_PAGE_HEIGHT)
  })

  it('opens an existing document at the height it was saved with', async () => {
    const doc = createEmptyDocument(createEmptyProject('과거 문서'))
    doc.pages[0]!.canvasHeight = 1800
    const id = await createDocument(doc, 1000)
    expect((await loadDocumentById(id))!.pages[0]!.canvasHeight).toBe(1800)
  })
})

describe('§4 페이지 삭제', () => {
  it('asks before deleting a page that holds work, and cancelling changes nothing', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.click(within(screen.getByRole('complementary', { name: '블록 팔레트' })).getByRole('button', { name: '글 넣기' }))
    await user.type(screen.getByLabelText('문구 내용'), '지우면 안 되는 문구')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await user.click(screen.getByRole('button', { name: '+ 페이지 추가' }))
    await user.click(screen.getByRole('button', { name: '1페이지' }))

    const tab1 = screen.getByLabelText('1페이지 페이지 메뉴').closest('.page-tab') as HTMLElement
    await user.click(within(tab1).getByLabelText('1페이지 페이지 메뉴'))
    await user.click(within(tab1).getByRole('button', { name: '페이지 삭제' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }))

    expect(screen.getByText('지우면 안 되는 문구')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /페이지$/ }).length).toBeGreaterThanOrEqual(2)
  })

  it('deletes the page and restores it — blocks, length and all — on undo', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.click(screen.getByRole('button', { name: '+ 페이지 추가' }))
    await user.click(within(screen.getByRole('complementary', { name: '블록 팔레트' })).getByRole('button', { name: '글 넣기' }))
    await user.type(screen.getByLabelText('문구 내용'), '2페이지 문구')
    await user.keyboard('{Control>}{Enter}{/Control}')

    const tab2 = screen.getByLabelText('2페이지 페이지 메뉴').closest('.page-tab') as HTMLElement
    await user.click(within(tab2).getByLabelText('2페이지 페이지 메뉴'))
    await user.click(within(tab2).getByRole('button', { name: '페이지 삭제' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '페이지 삭제' }))

    await waitFor(() => expect(screen.queryByText('2페이지 문구')).toBeNull())
    expect(screen.queryByRole('button', { name: '2페이지' })).toBeNull()

    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => expect(screen.getByText('2페이지 문구')).toBeTruthy())
  })

  it('refuses to delete the only page', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    const onlyTab = screen.getByLabelText('1페이지 페이지 메뉴').closest('.page-tab') as HTMLElement
    await user.click(within(onlyTab).getByLabelText('1페이지 페이지 메뉴'))

    const item = within(onlyTab).getByRole('button', { name: '페이지 삭제' })
    expect(item.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('마지막 페이지는 삭제할 수 없습니다')).toBeTruthy()
  })
})

describe('§5 기획서 삭제', () => {
  it('asks first, and cancelling leaves the list alone', async () => {
    const open = await createDocument(docNamed('열어둔 기획서', 2000), 2000)
    await createDocument(docNamed('지울 기획서', 1000), 1000)

    const user = userEvent.setup()
    renderApp(`/briefs/${open}`)
    await waitFor(() => expect(within(library()).getByText('지울 기획서')).toBeTruthy())

    const row = within(library()).getByText('지울 기획서').closest('li') as HTMLElement
    await user.click(within(row).getByLabelText('지울 기획서 메뉴'))
    await user.click(within(row).getByRole('button', { name: '기획서 삭제' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }))

    expect(within(library()).getByText('지울 기획서')).toBeTruthy()
    expect(await listDocuments()).toHaveLength(2)
  })

  it('removes a brief that is not open and leaves the open one on screen', async () => {
    const open = await createDocument(docNamed('열어둔 기획서', 2000), 2000)
    await createDocument(docNamed('지울 기획서', 1000), 1000)

    const user = userEvent.setup()
    renderApp(`/briefs/${open}`)
    await waitFor(() => expect(within(library()).getByText('지울 기획서')).toBeTruthy())

    const row = within(library()).getByText('지울 기획서').closest('li') as HTMLElement
    await user.click(within(row).getByLabelText('지울 기획서 메뉴'))
    await user.click(within(row).getByRole('button', { name: '기획서 삭제' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '기획서 삭제' }))

    await waitFor(async () => expect(await listDocuments()).toHaveLength(1))
    expect(within(library()).queryByText('지울 기획서')).toBeNull()
    expect(within(canvas()).getByText('열어둔 기획서')).toBeTruthy()
  })

  it('opens the most recently edited brief left when the open one is deleted', async () => {
    const open = await createDocument(docNamed('지금 보는 기획서', 1000), 1000)
    await createDocument(docNamed('남는 기획서', 3000), 3000)

    const user = userEvent.setup()
    renderApp(`/briefs/${open}`)
    await waitFor(() => expect(screen.getByText('지금 보는 기획서')).toBeTruthy())

    const row = within(library()).getByText('지금 보는 기획서').closest('li') as HTMLElement
    await user.click(within(row).getByLabelText('지금 보는 기획서 메뉴'))
    await user.click(within(row).getByRole('button', { name: '기획서 삭제' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '기획서 삭제' }))

    await waitFor(() => expect(screen.getByText('남는 기획서')).toBeTruthy())
    expect(await listDocuments()).toHaveLength(1)
  })

  it('keeps a delivered snapshot after its brief is deleted', async () => {
    const doc = docNamed('전달한 기획서', 1000)
    doc.project.id = 'doc_1'
    const request = createWorkRequest('req_1', doc, '2026-07-30T00:00:00.000Z')
    const id = await createDocument(doc, 1000)

    const { deleteDocument } = await import('../services/documentStore')
    await deleteDocument(id)

    expect(await loadDocumentById(id)).toBeNull()
    expect(request.submittedDoc.pages[0]!.blocks[0]!.content).toBe('전달한 기획서')
  })
})

describe('§6 작성 월로 찾기', () => {
  const july31 = new Date(2026, 6, 31, 23, 30).getTime() // 지역 시간 밤 11시 30분
  const july28 = new Date(2026, 6, 28, 9, 0).getTime()
  const june10 = new Date(2026, 5, 10, 9, 0).getTime()

  it('files a brief under the local day it was written, not the UTC one', () => {
    // 23:30 on 7/31 local is already 8/1 in UTC; the brief still belongs to July.
    expect(localMonthKey(july31)).toBe('2026-07')
    const groups = groupByCreatedDay([
      { id: 'a', title: '늦은 밤 기획서', createdAt: july31, updatedAt: july31 },
    ])
    expect(groups[0]!.label).toBe('7월 31일')
  })

  it('groups by day, newest first, and lists the months that exist', () => {
    const briefs = [
      { id: 'a', title: '가', createdAt: july28, updatedAt: july28 },
      { id: 'b', title: '나', createdAt: july31, updatedAt: july31 },
      { id: 'c', title: '다', createdAt: june10, updatedAt: june10 },
    ]
    expect(groupByCreatedDay(briefs).map((g) => g.label)).toEqual(['7월 31일', '7월 28일', '6월 10일'])
    expect(createdMonths(briefs)).toEqual(['2026-07', '2026-06'])
  })

  it('does not move a brief to another month when it is edited later', () => {
    const brief = { id: 'a', title: '가', createdAt: june10, updatedAt: july31 }
    expect(localMonthKey(brief.createdAt)).toBe('2026-06')
  })

  it('narrows by month and title together, and says so when nothing matches', async () => {
    await createDocument(docNamed('여름 기획전', july31), july31)
    await createDocument(docNamed('여름 사은품', july28), july28)
    await createDocument(docNamed('봄 기획전', june10), june10)

    const user = userEvent.setup()
    renderApp('/briefs/new')
    await waitFor(() => expect(within(library()).getByText('여름 기획전')).toBeTruthy())

    // 전체 기간 keeps the day grouping.
    expect(within(library()).getByText('7월 31일')).toBeTruthy()
    expect(within(library()).getByText('6월 10일')).toBeTruthy()

    await user.selectOptions(within(library()).getByLabelText('작성 월'), '2026-07')
    await waitFor(() => expect(within(library()).queryByText('봄 기획전')).toBeNull())
    expect(within(library()).getByText('여름 기획전')).toBeTruthy()

    await user.type(within(library()).getByRole('searchbox', { name: '기획서 제목 검색' }), '사은품')
    await waitFor(() => expect(within(library()).queryByText('여름 기획전')).toBeNull())
    expect(within(library()).getByText('여름 사은품')).toBeTruthy()

    // A month with no match says which kind of emptiness it is.
    await user.selectOptions(within(library()).getByLabelText('작성 월'), '2026-06')
    await waitFor(() => expect(within(library()).getByText('이 기간에 만든 기획서가 없습니다.')).toBeTruthy())
  })

  it('gives a copy its own creation date', async () => {
    const source = await createDocument(docNamed('원본', june10), june10)
    const { duplicateDocument } = await import('../services/documentStore')
    const copyId = await duplicateDocument(source, july31)

    const rows = await listDocuments()
    expect(rows.find((r) => r.id === copyId)!.createdAt).toBe(july31)
    expect(rows.find((r) => r.id === source)!.createdAt).toBe(june10)
  })
})
