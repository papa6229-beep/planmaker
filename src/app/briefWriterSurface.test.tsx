/**
 * 타 팀 배포용 작성기 표면 — what each deployment may reach.
 *
 * Marketing, product and CS open the brief writer and nothing else: a brief is
 * written, saved as a file, and sent by hand. The image-generation side of the
 * product is not finished and is not theirs, so it must not be reachable from
 * their build — not through a link, and not by typing its address.
 *
 * The design team's build (`studio`) keeps everything it has today. Nothing is
 * deleted here; the same components render on both surfaces.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { resolveAppSurface, DEFAULT_APP_SURFACE } from './appSurface'
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
import { createBlock, createEmptyProject } from '../domain/factory'
import { packageEventDocument } from '../services/eventBriefExport'
import { readEventDocument } from '../services/eventBriefImport'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

function renderSurface(path: string, surface: 'brief-writer' | 'studio') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes surface={surface} />
    </MemoryRouter>,
  )
}

/** The editor is on screen once its canvas is. */
const editorShown = async () =>
  waitFor(() => expect(screen.getByRole('region', { name: '기획 캔버스' })).toBeTruthy(), { timeout: 8000 })

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
  resetDocumentStoreForTests()
  await clearAllDocuments()
})

describe('§3 표면 결정', () => {
  it('opens as the brief writer unless a build says otherwise', () => {
    expect(resolveAppSurface(undefined)).toBe('brief-writer')
    expect(resolveAppSurface('')).toBe('brief-writer')
    expect(resolveAppSurface('Studio')).toBe('brief-writer')
    expect(resolveAppSurface('studioo')).toBe('brief-writer')
    expect(resolveAppSurface('brief-writer')).toBe('brief-writer')
    expect(resolveAppSurface('anything else')).toBe('brief-writer')
    expect(DEFAULT_APP_SURFACE).toBe('brief-writer')
  })

  it('opens the studio only for an exact match', () => {
    expect(resolveAppSurface('studio')).toBe('studio')
  })
})

describe('§4 타 팀 작성기 표면', () => {
  it('lands in a brief from the root', async () => {
    renderSurface('/', 'brief-writer')
    await editorShown()
  })

  it('sends the gate address into the brief writer', async () => {
    renderSurface('/gate', 'brief-writer')
    await editorShown()
    expect(screen.queryByRole('heading', { name: '어떤 작업을 시작할까요?' })).toBeNull()
  })

  it('sends the image-request list into the brief writer', async () => {
    renderSurface('/image-requests', 'brief-writer')
    await editorShown()
    expect(screen.queryByRole('heading', { name: /이미지 생성 요청/ })).toBeNull()
  })

  it('sends a single image request into the brief writer', async () => {
    renderSurface('/image-requests/req_1', 'brief-writer')
    await editorShown()
    expect(screen.queryByText(/요청을 찾을 수 없습니다/)).toBeNull()
  })

  it('shows no way into the internal side of the product', async () => {
    renderSurface('/briefs/new', 'brief-writer')
    await editorShown()

    expect(screen.queryByRole('button', { name: '전달하기' })).toBeNull()
    expect(screen.queryByText('이미지 생성 요청으로 전달합니다.')).toBeNull()
    expect(screen.queryByRole('link', { name: '목록 보기' })).toBeNull()
    expect(screen.queryByRole('link', { name: '게이트로 돌아가기' })).toBeNull()
    expect(screen.queryByRole('link', { name: /이미지 생성/ })).toBeNull()
    expect(document.body.textContent).not.toContain('이미지 생성 목록')
  })

  it('keeps every part of writing a brief', async () => {
    renderSurface('/briefs/new', 'brief-writer')
    await editorShown()

    // File in, file out, and the one line that says what to do with the file.
    expect(screen.getByRole('button', { name: '파일 불러오기' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '파일로 저장' })).toBeTruthy()
    expect(screen.getByText('작성이 끝나면 파일로 저장해 사내 메신저로 디자인팀에 보내 주세요.')).toBeTruthy()

    // Naming, the team, the direction, the tools, the pages, the summary.
    expect(screen.getByLabelText('기획서 제목')).toBeTruthy()
    expect(within(document.querySelector('.editor-topbar') as HTMLElement).getByLabelText('작성팀')).toBeTruthy()
    expect(screen.getByLabelText('원하는 분위기·컨셉')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'AI 요약' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '실행 취소' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ 페이지 추가' })).toBeTruthy()
    const palette = screen.getByRole('complementary', { name: '블록 팔레트' })
    for (const tool of ['글 넣기', '이미지', '버튼·링크']) {
      expect(within(palette).getByRole('button', { name: tool })).toBeTruthy()
    }

    // 내 기획서, with all three ways of finding an old brief.
    const library = screen.getByRole('complementary', { name: '내 기획서' })
    expect(within(library).getByRole('button', { name: '새 기획서' })).toBeTruthy()
    expect(within(library).getByLabelText('기획서 제목 검색')).toBeTruthy()
    expect(within(library).getByLabelText('작성 월')).toBeTruthy()
    expect(within(library).getByLabelText('작성팀 필터')).toBeTruthy()
  })

  it('says the handoff line once, and only on this surface', async () => {
    renderSurface('/briefs/new', 'brief-writer')
    await editorShown()
    expect(screen.getAllByText('작성이 끝나면 파일로 저장해 사내 메신저로 디자인팀에 보내 주세요.')).toHaveLength(1)
  })

  it('still opens a stored brief by its own address', async () => {
    const doc = createEmptyDocument(createEmptyProject('저장된 기획서'))
    doc.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_1', content: '보관된 문구' })]
    const id = await createDocument(doc, 1000)

    renderSurface(`/briefs/${id}`, 'brief-writer')
    await waitFor(() => expect(screen.getByText('보관된 문구')).toBeTruthy(), { timeout: 8000 })
  })
})

describe('§5 내부 studio 표면 보존', () => {
  it('still has the gate', async () => {
    renderSurface('/gate', 'studio')
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: '어떤 작업을 시작할까요?' })).toBeTruthy(),
    )
    expect(screen.getByRole('link', { name: /이미지 생성/ })).toBeTruthy()
  })

  it('still has the image-request list and a request work page', async () => {
    renderSurface('/image-requests', 'studio')
    await waitFor(() => expect(document.querySelector('.page-header')).not.toBeNull())
    expect(document.body.textContent).toContain('이미지 생성')

    renderSurface('/image-requests/req_missing', 'studio')
    // A missing request says so rather than silently becoming a brief.
    await waitFor(() => expect(screen.getAllByText(/요청/).length).toBeGreaterThan(0))
  })

  it('still has 전달하기 in the editor', async () => {
    renderSurface('/briefs/new', 'studio')
    await editorShown()
    expect(screen.getByRole('button', { name: '전달하기' })).toBeTruthy()
    expect(screen.getByText('이미지 생성 요청으로 전달합니다.')).toBeTruthy()
  })
})

describe('§6.3 파일 왕복 불변', () => {
  it('carries every part of a brief through a file, on the writer surface', async () => {
    const doc = createEmptyDocument(createEmptyProject('아크웨이브 이벤트'))
    doc.project.concept = '밝고 경쾌한 여름 분위기'
    doc.project.requestTeam = 'marketing'
    doc.assets = [{ id: 'asset_ref', fileName: 'ref.png', mimeType: 'image/png' }]
    const text = createBlock('free_text', { id: 'blk_text', content: '여름 세일\n최대 70%' })
    text.layoutHint = { ...text.layoutHint, alignment: 'center' }
    text.position = { x: 40, y: 60, width: 700, height: 320 }
    const image = createBlock('main_product_image', { id: 'blk_img', content: '시원한 바다 사진 자리' })
    const button = createBlock('cta_button', { id: 'blk_btn', content: '지금 사러가기', groupId: 'grp_1' })
    const link = createBlock('button_url', { id: 'blk_url', content: 'https://example.com/event', groupId: 'grp_1' })
    doc.pages[0]!.blocks = [text, image, button, link]
    doc.pages[0]!.canvasHeight = 1600
    doc.pages[0]!.reference = { assetId: 'asset_ref', viewMode: 'overlay', opacity: 0.35, fit: 'width', visible: true }
    doc.pages.push(createPage({ title: '2페이지', canvasHeight: 700 }))

    const pkg = await packageEventDocument({
      doc,
      assets: [
        {
          id: 'asset_ref',
          blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
          fileName: 'ref.png',
          mimeType: 'image/png',
          byteSize: 4,
        },
      ],
      previews: doc.pages.map(() => new Blob([new Uint8Array([1])], { type: 'image/png' })),
      createdAt: new Date(0).toISOString(),
    })
    const read = await readEventDocument(pkg.blob)

    expect(read.doc.project.title).toBe('아크웨이브 이벤트')
    expect(read.doc.project.concept).toBe('밝고 경쾌한 여름 분위기')
    expect(read.doc.project.requestTeam).toBe('marketing')
    expect(read.doc.pages.map((p) => p.canvasHeight)).toEqual([1600, 700])
    const [first] = read.doc.pages
    expect(first!.blocks.find((b) => b.id === 'blk_text')!.content).toBe('여름 세일\n최대 70%')
    expect(first!.blocks.find((b) => b.id === 'blk_text')!.layoutHint.alignment).toBe('center')
    expect(first!.blocks.find((b) => b.id === 'blk_text')!.position).toEqual({ x: 40, y: 60, width: 700, height: 320 })
    expect(first!.blocks.find((b) => b.id === 'blk_img')!.content).toBe('시원한 바다 사진 자리')
    expect(first!.blocks.find((b) => b.id === 'blk_btn')!.content).toBe('지금 사러가기')
    expect(first!.blocks.find((b) => b.id === 'blk_url')!.content).toBe('https://example.com/event')
    expect(first!.reference).toEqual({
      assetId: 'asset_ref',
      viewMode: 'overlay',
      opacity: 0.35,
      fit: 'width',
      visible: true,
    })
    expect(read.assets.map((a) => a.id)).toEqual(['asset_ref'])
  })

  it('opens a file on the writer surface and lets the planner keep editing', async () => {
    const incoming = createEmptyDocument(createEmptyProject('받은 기획서'))
    incoming.project.requestTeam = 'cs'
    incoming.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_i', content: '받은 문구' })]
    const pkg = await packageEventDocument({
      doc: incoming,
      assets: [],
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
    })
    const file = new File([pkg.blob], 'in.eventbrief', { type: 'application/zip' })

    const user = userEvent.setup()
    renderSurface('/briefs/new', 'brief-writer')
    await editorShown()

    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(document.querySelector('.toolbar__file-input') as HTMLInputElement, {
      target: { files: [file] },
    })
    await waitFor(() => expect(screen.getByText('받은 문구')).toBeTruthy(), { timeout: 8000 })
    expect(
      (within(document.querySelector('.editor-topbar') as HTMLElement).getByLabelText('작성팀') as HTMLSelectElement)
        .value,
    ).toBe('cs')

    // And it is still an ordinary brief: editing it saves into the open row.
    await user.click(within(screen.getByRole('complementary', { name: '블록 팔레트' })).getByRole('button', { name: '글 넣기' }))
    await user.type(screen.getByLabelText('문구 내용'), '이어서 쓴 문구')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(async () => {
      const [summary] = await listDocuments()
      const saved = (await loadDocumentById(summary!.id)) as BriefDocument
      expect(saved.pages[0]!.blocks.some((b) => b.content === '이어서 쓴 문구')).toBe(true)
    }, { timeout: 8000 })
  })
})
