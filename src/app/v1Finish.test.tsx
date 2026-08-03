/**
 * 기획서 작성기 v1 마감 — the last of the hand-inspection findings.
 *
 * Six things a planner asked for, in the order they hit them: wording big
 * enough for an event page and able to sit left, centre or right; a file that
 * gets the name they choose; no menus that hold one thing; a page's reference
 * image still there when the file is opened again; and a brief that says which
 * team wrote it, so it can be found again by team.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { AppRoutes } from './AppRoutes'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { clearAll, resetAssetStoreForTests } from '../services/assetStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import {
  clearAllDocuments,
  createDocument,
  loadDocumentById,
  resetDocumentStoreForTests,
  saveDocumentById,
} from '../services/documentStore'
import { briefReducer, createInitialEditorState, type EditorState } from '../features/editor/briefEditor'
import { historyReducer, type HistoryState } from '../features/editor/history'
import { MAX_FONT_PX, MIN_FONT_PX, fitTextSize } from '../domain/textFit'
import { textAlignOf } from '../domain/simpleBlocks'
import { eventBriefFileName, sanitizeFileName, FALLBACK_FILE_NAME } from '../features/export/exportFileName'
import { teamLabel, teamFilterKey } from '../domain/requestTeam'
import { buildDesignSummary } from '../domain/summaryBuilder'
import { pageAsEventBrief } from '../domain/briefMigration'
import { documentFingerprint } from '../domain/documentFingerprint'
import { packageEventDocument } from '../services/eventBriefExport'
import { readEventDocument } from '../services/eventBriefImport'
import { createEmptyDocument, createPage } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { duplicatePage } from '../domain/pageOps'
import type { BriefDocument } from '../domain/pageSchema'
import type { StoredAsset } from '../services/assetStore'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 800, height: 1200 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

function renderShell(binding?: { load: () => Promise<BriefDocument | null>; save: (d: BriefDocument) => Promise<void> }) {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <RequestsProvider>
        <DocumentsProvider>{binding ? <AppShell binding={binding} /> : <AppShell />}</DocumentsProvider>
      </RequestsProvider>
    </MemoryRouter>,
  )
}

const palette = () => screen.getByRole('complementary', { name: '블록 팔레트' })
const library = () => screen.getByRole('complementary', { name: '내 기획서' })

/** A text block of the given size, and the state holding it. */
function blockSized(width: number, height: number, content: string): { state: EditorState; id: string } {
  let state = briefReducer(createInitialEditorState(), { type: 'ADD_BLOCK', blockType: 'free_text', label: '문구' })
  const id = state.brief.blocks[0]!.id
  state = briefReducer(state, { type: 'UPDATE_BLOCK', blockId: id, patch: { content } })
  state = briefReducer(state, { type: 'RESIZE_BLOCK', blockId: id, rect: { x: 0, y: 0, width, height } })
  return { state, id }
}

/** A PNG-ish blob, enough for the archive to carry bytes around. */
function storedAsset(id: string, fileName: string): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
    fileName,
    mimeType: 'image/png',
    byteSize: 8,
  }
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
  resetDocumentStoreForTests()
  await clearAllDocuments()
})

describe('§2 문구 최대 크기', () => {
  it('draws far past the old 72px ceiling as the block grows, and stops at 200px', () => {
    // 840px wide, most of a page tall: an event page's main wording.
    const big = fitTextSize('50%', 800, 600)
    expect(big.fontSize).toBeGreaterThan(72)
    expect(big.fontSize).toBeLessThanOrEqual(MAX_FONT_PX)

    // Bigger than any wording needs: it settles at the ceiling, not above it.
    expect(fitTextSize('!', 4000, 4000).fontSize).toBe(MAX_FONT_PX)
    expect(MAX_FONT_PX).toBe(200)
    expect(MIN_FONT_PX).toBe(12)
  })

  it('never clips, however big the type gets — two lines included', () => {
    const text = '여름 정기세일\n최대 70% 할인'
    for (const [w, h] of [[800, 600], [600, 400], [840, 900], [300, 120]] as const) {
      const { fontSize, overflow } = fitTextSize(text, w, h)
      expect(overflow).toBe(false)
      // Both lines, at the size chosen, inside the block.
      expect(Math.ceil(2 * fontSize * 1.35)).toBeLessThanOrEqual(h)
    }
  })

  it('reports the loudest emphasis for page-filling type', () => {
    const { state } = blockSized(700, 400, '50% 할인')
    expect(state.brief.blocks[0]!.layoutHint.emphasis).toBe('very_high')
  })
})

describe('§3 문구 정렬', () => {
  it('starts left, and moves through centre and right', () => {
    const { state, id } = blockSized(400, 120, '여름 세일')
    expect(textAlignOf(state.brief.blocks[0]!)).toBe('left')

    const centred = briefReducer(state, { type: 'SET_TEXT_ALIGN', blockId: id, align: 'center' })
    expect(textAlignOf(centred.brief.blocks[0]!)).toBe('center')
    const right = briefReducer(centred, { type: 'SET_TEXT_ALIGN', blockId: id, align: 'right' })
    expect(textAlignOf(right.brief.blocks[0]!)).toBe('right')
  })

  it('leaves the block where it is and the size it is', () => {
    const { state, id } = blockSized(400, 120, '여름 세일')
    const before = state.brief.blocks[0]!.position
    const after = briefReducer(state, { type: 'SET_TEXT_ALIGN', blockId: id, align: 'center' }).brief.blocks[0]!
    expect(after.position).toEqual(before)
  })

  it('undoes and redoes as one step', () => {
    const { state, id } = blockSized(400, 120, '여름 세일')
    let history: HistoryState = { past: [], present: state, future: [], lastCoalesceKey: null }
    history = historyReducer(history, { type: 'SET_TEXT_ALIGN', blockId: id, align: 'center' })
    expect(textAlignOf(history.present.brief.blocks[0]!)).toBe('center')

    history = historyReducer(history, { type: 'UNDO' })
    expect(textAlignOf(history.present.brief.blocks[0]!)).toBe('left')
    history = historyReducer(history, { type: 'REDO' })
    expect(textAlignOf(history.present.brief.blocks[0]!)).toBe('center')
  })

  it('reads as 왼쪽 for a document written before alignment existed', () => {
    const legacy = createBlock('free_text', { id: 'blk_legacy', content: '예전 문구' })
    expect(legacy.layoutHint.alignment).toBeUndefined()
    expect(textAlignOf(legacy)).toBe('left')
  })

  it('offers the three alignments on a 문구 block, and on nothing else', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.click(within(palette()).getByRole('button', { name: '글 넣기' }))
    await user.type(screen.getByLabelText('문구 내용'), '여름 세일')
    await user.keyboard('{Control>}{Enter}{/Control}')

    const aligns = screen.getByRole('group', { name: '문구 정렬' })
    expect(within(aligns).getByRole('button', { name: '왼쪽 정렬' }).getAttribute('aria-pressed')).toBe('true')

    await user.click(within(aligns).getByRole('button', { name: '가운데 정렬' }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: '문구 정렬' }))
          .getByRole('button', { name: '가운데 정렬' })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    )
    // What is written and what is being typed agree.
    expect((document.querySelector('.block-card__content') as HTMLElement).style.textAlign).toBe('center')

    // An image block is not wording, so it has no side to sit on.
    await user.keyboard('{Escape}')
    await user.click(within(palette()).getByRole('button', { name: '이미지' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: '문구 정렬' })).toBeNull()
  })

  it('carries the alignment into the AI summary and the delivery fingerprint', () => {
    const doc = createEmptyDocument(createEmptyProject('정렬 기획서'))
    const block = createBlock('free_text', { id: 'blk_1', content: '여름 세일' })
    block.layoutHint = { ...block.layoutHint, alignment: 'center' }
    doc.pages[0]!.blocks = [block]

    const page = doc.pages[0]!
    const design = buildDesignSummary(pageAsEventBrief(doc, page), { pageId: page.id })
    expect(design.layoutHints.find((h) => h.blockId === 'blk_1')!.alignment).toBe('center')

    // Alignment is part of the work, so a delivered brief notices it changed.
    const moved: BriefDocument = {
      ...doc,
      pages: [{ ...page, blocks: [{ ...block, layoutHint: { ...block.layoutHint, alignment: 'right' } }] }],
    }
    expect(documentFingerprint(moved)).not.toBe(documentFingerprint(doc))
  })

  it('survives a page duplicate and a file round-trip', async () => {
    const doc = createEmptyDocument(createEmptyProject('정렬 왕복'))
    const block = createBlock('free_text', { id: 'blk_1', content: '가운데 문구' })
    block.layoutHint = { ...block.layoutHint, alignment: 'center' }
    doc.pages[0]!.blocks = [block]

    const copied = duplicatePage(doc, doc.pages[0]!.id)
    expect(copied.pages[1]!.blocks[0]!.layoutHint.alignment).toBe('center')

    const pkg = await packageEventDocument({
      doc: copied,
      assets: [],
      previews: copied.pages.map(() => new Blob([new Uint8Array([1])], { type: 'image/png' })),
      createdAt: new Date(0).toISOString(),
    })
    const read = await readEventDocument(pkg.blob)
    expect(read.doc.pages[0]!.blocks[0]!.layoutHint.alignment).toBe('center')
    expect(read.doc.pages[1]!.blocks[0]!.layoutHint.alignment).toBe('center')
  })
})

describe('§4 저장 파일명', () => {
  it('keeps Korean, trims, and replaces what a file system refuses', () => {
    expect(sanitizeFileName('아크웨이브 신상 발매 기념 이벤트')).toBe('아크웨이브 신상 발매 기념 이벤트')
    expect(sanitizeFileName('  여름 세일  ')).toBe('여름 세일')
    expect(sanitizeFileName('7/1 세일: 50%↓ <핫딜>')).toBe('7 1 세일 50%↓ 핫딜')
    expect(sanitizeFileName('여름 이벤트 . ')).toBe('여름 이벤트')
    expect(sanitizeFileName('   ')).toBe(FALLBACK_FILE_NAME)
  })

  it('adds the extension once, however it was typed', () => {
    expect(eventBriefFileName('여름 세일')).toBe('여름 세일.eventbrief')
    expect(eventBriefFileName('여름 세일.eventbrief')).toBe('여름 세일.eventbrief')
    expect(eventBriefFileName('여름 세일.EVENTBRIEF')).toBe('여름 세일.eventbrief')
    expect(eventBriefFileName('')).toBe(`${FALLBACK_FILE_NAME}.eventbrief`)
  })

  it('offers the brief title, saves under the typed name, and leaves the title alone', async () => {
    const user = userEvent.setup()
    const names: string[] = []
    const created: HTMLAnchorElement[] = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'a') {
        created.push(el as HTMLAnchorElement)
        ;(el as HTMLAnchorElement).click = () => names.push((el as HTMLAnchorElement).download)
      }
      return el
    }) as typeof document.createElement)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')

    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.clear(screen.getByLabelText('기획서 제목'))
    await user.type(screen.getByLabelText('기획서 제목'), '아크웨이브 이벤트')

    await user.click(screen.getByRole('button', { name: '파일로 저장' }))
    const dialog = screen.getByRole('dialog', { name: '기획서 파일로 저장' })
    const input = within(dialog).getByLabelText('파일명') as HTMLInputElement
    expect(input.value).toBe('아크웨이브 이벤트')

    await user.clear(input)
    await user.type(input, '아크웨이브_마케팅팀_이벤트')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(names).toContain('아크웨이브_마케팅팀_이벤트.eventbrief'), { timeout: 8000 })
    // Naming a file is not renaming the brief.
    expect((screen.getByLabelText('기획서 제목') as HTMLInputElement).value).toBe('아크웨이브 이벤트')
    vi.restoreAllMocks()
  })

  it('closes on Esc without saving anything', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.click(screen.getByRole('button', { name: '파일로 저장' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '기획서 파일로 저장' })).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('§7-8 페이지 참고 이미지 왕복', () => {
  it('keeps the reference asset in the document pool while the page is edited', async () => {
    const id = await createDocument(createEmptyDocument(createEmptyProject('참고 보존')), 1)
    const user = userEvent.setup()
    const { container } = renderShell({
      load: () => loadDocumentById(id),
      save: (d: BriefDocument) => saveDocumentById(id, d, Date.now()),
    })
    await waitFor(() => expect(screen.getByRole('region', { name: '참고 이미지 도구' })).toBeTruthy())

    await user.upload(
      container.querySelector('.ref-tools__file-input') as HTMLInputElement,
      new File([new Uint8Array([137, 80, 78, 71])], 'ref.png', { type: 'image/png' }),
    )
    await waitFor(() => expect(screen.getByAltText('현재 참고 이미지')).toBeTruthy())

    // Editing the page used to wipe the reference's metadata out of the pool —
    // the page still pointed at an asset the document no longer listed, so the
    // export packed no binary for it and the file opened with nothing to show.
    await user.click(within(palette()).getByRole('button', { name: '글 넣기' }))
    await user.type(screen.getByLabelText('문구 내용'), '문구 하나')
    await user.keyboard('{Control>}{Enter}{/Control}')

    await waitFor(
      async () => {
        const saved = (await loadDocumentById(id))!
        const referenced = saved.pages[0]!.reference.assetId
        expect(referenced).toBeDefined()
        expect(saved.assets.map((a) => a.id)).toContain(referenced)
        expect(saved.pages[0]!.blocks).toHaveLength(1)
      },
      { timeout: 6000 },
    )
  })

  it('carries the image and every view setting through a file round-trip, per page', async () => {
    const doc = createEmptyDocument(createEmptyProject('참고 왕복'))
    doc.assets = [
      { id: 'asset_a', fileName: 'a.png', mimeType: 'image/png' },
      { id: 'asset_b', fileName: 'b.png', mimeType: 'image/png' },
    ]
    doc.pages[0]!.reference = { assetId: 'asset_a', viewMode: 'overlay', opacity: 0.35, fit: 'width', visible: true }
    doc.pages.push(
      createPage({
        title: '2페이지',
        reference: { assetId: 'asset_b', viewMode: 'side', opacity: 0.6, fit: 'original', visible: false },
      }),
    )

    const pkg = await packageEventDocument({
      doc,
      assets: [storedAsset('asset_a', 'a.png'), storedAsset('asset_b', 'b.png')],
      previews: doc.pages.map(() => new Blob([new Uint8Array([1])], { type: 'image/png' })),
      createdAt: new Date(0).toISOString(),
    })

    // The binaries travel in the archive's reference area, not as design assets.
    expect(pkg.manifest.assets.map((a) => a.path)).toEqual([
      'references/asset_a__a.png',
      'references/asset_b__b.png',
    ])

    const read = await readEventDocument(pkg.blob)
    expect(read.assets.map((a) => a.id)).toEqual(['asset_a', 'asset_b'])
    expect(read.doc.pages[0]!.reference).toEqual({
      assetId: 'asset_a',
      viewMode: 'overlay',
      opacity: 0.35,
      fit: 'width',
      visible: true,
    })
    expect(read.doc.pages[1]!.reference).toEqual({
      assetId: 'asset_b',
      viewMode: 'side',
      opacity: 0.6,
      fit: 'original',
      visible: false,
    })
  })

  it('opens a removed reference as removed, and refuses a file whose image is missing', async () => {
    const doc = createEmptyDocument(createEmptyProject('참고 제거'))
    doc.pages[0]!.reference = { viewMode: 'canvas', opacity: 0.5, fit: 'width', visible: false }
    const pkg = await packageEventDocument({
      doc,
      assets: [],
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
    })
    const read = await readEventDocument(pkg.blob)
    expect(read.doc.pages[0]!.reference.assetId).toBeUndefined()

    // A page pointing at an image the archive does not carry is a broken file,
    // not a page that quietly lost its reference.
    const broken = createEmptyDocument(createEmptyProject('깨진 파일'))
    broken.pages[0]!.reference = { assetId: 'asset_missing', viewMode: 'overlay', opacity: 0.4, fit: 'width', visible: true }
    const brokenPkg = await packageEventDocument({
      doc: broken,
      assets: [],
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
    })
    await expect(readEventDocument(brokenPkg.blob)).rejects.toThrow(/참고 이미지 파일이 누락/)
  })

  it('never reads a page reference as an image to use', () => {
    const doc = createEmptyDocument(createEmptyProject('참고 구분'))
    doc.assets = [{ id: 'asset_a', fileName: 'a.png', mimeType: 'image/png' }]
    doc.pages[0]!.reference = { assetId: 'asset_a', viewMode: 'overlay', opacity: 0.35, fit: 'width', visible: true }

    const page = doc.pages[0]!
    const design = buildDesignSummary(pageAsEventBrief(doc, page), { pageId: page.id })
    expect(design.requiredProducts).toHaveLength(0)
    expect(design.verbatimImages).toHaveLength(0)
    expect(design.imageSlots).toHaveLength(0)
  })
})

describe('§5·10 보조 메뉴와 게이트', () => {
  it('has no overflow menu and no way back to the gate', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    expect(screen.queryByText('보조 메뉴')).toBeNull()
    expect(screen.queryByRole('button', { name: '새로 만들기' })).toBeNull()
    expect(screen.queryByRole('link', { name: '게이트로 돌아가기' })).toBeNull()
    // The one way to start a brief is still there.
    expect(within(library()).getByRole('button', { name: '새 기획서' })).toBeTruthy()
  })

  it('asks which team is writing at the root, and never opens the old gate', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    // 첫 화면은 팀 선택으로 바뀌었다 (첫 사용 흐름 §4). 옛 게이트는 여전히 없다.
    await waitFor(() => expect(screen.getByRole('heading', { name: '어느 팀으로 기획서를 쓰시나요?' })).toBeTruthy())
    expect(screen.queryByRole('heading', { name: '어떤 작업을 시작할까요?' })).toBeNull()
  })
})

describe('§11-12 작성팀', () => {
  it('labels the codes, keeps older free text, and files everything else under 팀 미지정', () => {
    expect(teamLabel('marketing')).toBe('마케팅팀')
    expect(teamLabel('product')).toBe('상품팀')
    expect(teamLabel('cs')).toBe('CS팀')
    expect(teamLabel(undefined)).toBe('팀 미지정')
    // A document written before the codes existed keeps saying what it said.
    expect(teamLabel('마케팅팀')).toBe('마케팅팀')
    expect(teamFilterKey('마케팅팀')).toBe('none')
    expect(teamFilterKey('cs')).toBe('cs')
  })

  it('starts 팀 미지정, and autosaves the team that is chosen', async () => {
    const id = await createDocument(createEmptyDocument(createEmptyProject('팀 기획서')), 1)
    const user = userEvent.setup()
    renderShell({
      load: () => loadDocumentById(id),
      save: (d: BriefDocument) => saveDocumentById(id, d, Date.now()),
    })

    const topbar = document.querySelector('.editor-topbar') as HTMLElement
    const select = (await within(topbar).findByLabelText('작성팀')) as HTMLSelectElement
    expect(select.value).toBe('')
    expect((await loadDocumentById(id))!.project.requestTeam).toBeUndefined()

    await user.selectOptions(select, 'marketing')
    await waitFor(async () => expect((await loadDocumentById(id))!.project.requestTeam).toBe('marketing'), {
      timeout: 6000,
    })
  })

  it('is kept by a copy, a file round-trip, and the AI summary', async () => {
    const doc = createEmptyDocument(createEmptyProject('마케팅 기획서'))
    doc.project.requestTeam = 'marketing'
    doc.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_1', content: '여름 세일' })]

    const pkg = await packageEventDocument({
      doc,
      assets: [],
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
    })
    const read = await readEventDocument(pkg.blob)
    expect(read.doc.project.requestTeam).toBe('marketing')

    const page = doc.pages[0]!
    const design = buildDesignSummary(pageAsEventBrief(doc, page), { pageId: page.id })
    expect(design.requestTeam).toBe('marketing')
    // It is context for the AI, never wording to print.
    expect(design.texts.some((t) => t.content.includes('마케팅'))).toBe(false)
  })

  it('shows the team on each card and narrows by title, month and team together', async () => {
    const withTeam = (title: string, team?: string) => {
      const d = createEmptyDocument(createEmptyProject(title))
      if (team !== undefined) d.project.requestTeam = team
      d.pages[0]!.blocks = [createBlock('free_text', { id: `blk_${title}`, content: title })]
      return d
    }
    const june = new Date(2026, 5, 10, 9).getTime()
    const july = new Date(2026, 6, 20, 9).getTime()
    await createDocument(withTeam('여름 마케팅 기획전', 'marketing'), july)
    await createDocument(withTeam('여름 상품 기획전', 'product'), july)
    await createDocument(withTeam('여름 옛 기획전'), june)
    const open = await createDocument(withTeam('CS 안내 개편', 'cs'), july)

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[`/briefs/${open}`]}>
        <AppRoutes />
      </MemoryRouter>,
    )
    await waitFor(() => expect(within(library()).getByText('여름 마케팅 기획전')).toBeTruthy())
    // Every card says which team wrote it.
    const cards = () => library().querySelector('.library__groups') as HTMLElement
    expect(within(cards()).getAllByText('마케팅팀').length).toBeGreaterThan(0)
    expect(within(cards()).getByText('팀 미지정')).toBeTruthy()

    await user.selectOptions(within(library()).getByLabelText('작성팀 필터'), 'marketing')
    await waitFor(() => expect(within(library()).queryByText('여름 상품 기획전')).toBeNull())
    expect(within(library()).getByText('여름 마케팅 기획전')).toBeTruthy()

    await user.selectOptions(within(library()).getByLabelText('작성팀 필터'), 'none')
    await waitFor(() => expect(within(library()).getByText('여름 옛 기획전')).toBeTruthy())
    expect(within(library()).queryByText('여름 마케팅 기획전')).toBeNull()

    // Title AND month AND team, all at once.
    await user.selectOptions(within(library()).getByLabelText('작성팀 필터'), 'marketing')
    await user.selectOptions(within(library()).getByLabelText('작성 월'), '2026-07')
    await user.type(within(library()).getByLabelText('기획서 제목 검색'), '여름')
    await waitFor(() => expect(within(library()).getByText('여름 마케팅 기획전')).toBeTruthy())
    expect(within(library()).queryByText('CS 안내 개편')).toBeNull()
    expect(within(library()).queryByText('여름 옛 기획전')).toBeNull()

    // Filtering never changes which brief is being edited.
    expect((screen.getByLabelText('기획서 제목') as HTMLInputElement).value).toBe('CS 안내 개편')
  })
})
