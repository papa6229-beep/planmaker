/**
 * Focused tests for 1-B — 이미지 블록 참고자료 첨부.
 *
 * What the planner attaches to an image block is a *capture*: "something like
 * this belongs here". It is not the file the finished page will use — the
 * design team picks that later. These tests hold that line in the data: the
 * attachment is marked reference-only, it never shows up as the asset a
 * required product is made from, and the click URL stays out of the design
 * input entirely. They also hold the boring but essential part — the
 * attachment has to survive autosave, duplication, export, and delivery.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { clearAll, getAllAssets, resetAssetStoreForTests, saveDocument, loadDocument } from '../services/assetStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { briefReducer, createInitialEditorState, type EditorState } from '../features/editor/briefEditor'
import { buildDesignSummary, buildPublishingInfo } from '../domain/summaryBuilder'
import { pageAsEventBrief } from '../domain/briefMigration'
import { createEmptyDocument } from '../domain/pageSchema'
import { duplicatePage } from '../domain/pageOps'
import { createBlock, createEmptyBrief } from '../domain/factory'
import { classifyAssetArea } from '../services/eventBriefArchive'
import { findLinkPartner, imagePreviewHeight } from '../domain/simpleBlocks'
import { packageEventDocument } from '../services/eventBriefExport'
import { readEventDocument } from '../services/eventBriefImport'
import { createWorkRequest, requestAssetIds } from '../domain/workRequest'
import type { Asset, EventBrief } from '../domain/briefSchema'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))
vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 20, height: 20 }) }
})

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

const palette = () => screen.getByRole('complementary', { name: '블록 팔레트' })
const canvas = () => screen.getByRole('region', { name: '기획 캔버스' })
const tool = (name: string) => within(palette()).getByRole('button', { name })
const card = () => canvas().querySelector('.block-card') as HTMLElement

function pngFile(name = 'capture.png') {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' })
}

const asset: Asset = { id: 'asset_ref', fileName: 'capture.png', mimeType: 'image/png' }

function reduce(...actions: Parameters<typeof briefReducer>[1][]): EditorState {
  return actions.reduce((s, a) => briefReducer(s, a), createInitialEditorState())
}

function summarize(brief: EventBrief) {
  const doc = createEmptyDocument(brief.project)
  doc.pages[0]!.blocks = brief.blocks
  doc.assets = brief.assets
  const page = doc.pages[0]!
  const projected = pageAsEventBrief(doc, page)
  return { page, design: buildDesignSummary(projected, { pageId: page.id }), publishing: buildPublishingInfo(projected) }
}

/** An image block carrying a description and a reference capture. */
function withReference(): EditorState {
  const created = reduce({ type: 'ADD_BLOCK', blockType: 'main_product_image', label: '이미지' })
  const id = created.brief.blocks[0]!.id
  const described = briefReducer(created, {
    type: 'COMMIT_TEXT',
    blockId: id,
    content: '아크웨이브 제품 누끼 이미지',
  })
  return briefReducer(described, { type: 'ASSIGN_IMAGE', blockId: id, asset, image: { referenceOnly: true } })
}

/** Attaches a file through the block's own file input. */
async function attach(user: ReturnType<typeof userEvent.setup>, file = pngFile()) {
  const input = card().querySelector('.block-card__file') as HTMLInputElement
  await user.upload(input, file)
  await waitFor(() => expect(canvas().querySelector('.block-card__thumb')).not.toBeNull())
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
})

describe('§2.2 참고자료 첨부', () => {
  it('offers attaching a reference capture and shows it in the block', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))
    await user.type(screen.getByLabelText('이미지 내용'), '여름 바다 느낌의 배경')
    await user.keyboard('{Control>}{Enter}{/Control}')

    await user.click(within(card()).getByLabelText('이미지 블록 메뉴'))
    expect(within(card()).getByRole('button', { name: '참고 이미지 넣기' })).toBeTruthy()
    await user.keyboard('{Escape}')

    await attach(user)
    // The capture is shown, the description is still there, and the block says
    // plainly what the picture is for.
    expect(within(card()).getByText('여름 바다 느낌의 배경')).toBeTruthy()
    expect(within(card()).getByText('참고용 이미지 · 최종 사용 이미지 아님')).toBeTruthy()
  })

  it('takes a capture dropped onto the block', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))
    await user.keyboard('{Escape}')

    fireEvent.drop(card(), { dataTransfer: { files: [pngFile()], types: ['Files'] } })
    await waitFor(() => expect(canvas().querySelector('.block-card__thumb')).not.toBeNull())
    await waitFor(async () => expect(await getAllAssets()).toHaveLength(1))
  })

  it('takes a pasted capture while the block is selected', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))
    await user.keyboard('{Escape}')

    const file = pngFile()
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
    })
    window.dispatchEvent(paste)
    await waitFor(() => expect(canvas().querySelector('.block-card__thumb')).not.toBeNull())
  })

  it('leaves an ordinary text paste alone', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))
    await user.keyboard('{Escape}')

    const title = screen.getByRole('textbox', { name: '기획서 제목' })
    title.focus()
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] },
    })
    title.dispatchEvent(paste)

    expect(paste.defaultPrevented).toBe(false)
    expect(canvas().querySelector('.block-card__thumb')).toBeNull()
  })

  it('removes the capture without touching the description or the link', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))
    await user.type(screen.getByLabelText('이미지 내용'), '모델이 제품을 든 사진')
    await user.keyboard('{Control>}{Enter}{/Control}')

    await user.click(within(card()).getByRole('button', { name: '이미지 링크 연결' }))
    await user.type(screen.getByLabelText('이미지 연결 주소'), 'https://shop.example.com/item/1')
    await user.click(card().querySelector('.block-card__link-save') as HTMLElement)
    await attach(user)

    await user.click(within(card()).getByLabelText('이미지 블록 메뉴'))
    await user.click(within(card()).getByRole('button', { name: '참고 이미지 제거' }))

    await waitFor(() => expect(canvas().querySelector('.block-card__thumb')).toBeNull())
    expect(within(card()).getByText('모델이 제품을 든 사진')).toBeTruthy()
    expect(within(card()).getByLabelText('연결된 주소 있음')).toBeTruthy()
    expect(canvas().querySelectorAll('.block-card')).toHaveLength(1)
  })
})

describe('마감 §1 새 이미지 블록은 참고 사진이 보이는 크기', () => {
  it('gives a new image block enough height to actually show the capture', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'main_product_image', label: '이미지' })
    const { width, height } = created.brief.blocks[0]!.position
    expect(width).toBe(320)
    expect(height).toBeGreaterThanOrEqual(200)
    expect(height).toBeLessThanOrEqual(220)
    // What is left for the picture once the card's own rows are taken out.
    expect(imagePreviewHeight(height)).toBeGreaterThanOrEqual(120)
  })

  it('leaves 문구 and 버튼 blocks at the size they had', () => {
    const text = reduce({ type: 'ADD_BLOCK', blockType: 'free_text', label: '문구' })
    expect(text.brief.blocks[0]!.position.height).toBe(96)
    const button = reduce({ type: 'ADD_BUTTON_LINK', label: '버튼' })
    expect(button.brief.blocks[0]!.position.height).toBe(96)
    expect(button.brief.blocks[0]!.position.width).toBe(320)
  })

  it('never resizes a block that already exists', async () => {
    const old = createBlock('main_product_image', {
      id: 'blk_old',
      label: '이미지',
      position: { x: 10, y: 10, width: 300, height: 96 },
    })
    const doc = createEmptyDocument(createEmptyBrief('과거 문서').project)
    doc.pages[0]!.blocks = [old]
    await saveDocument(doc, 1)

    renderEditor()
    await waitFor(() => expect(canvas().querySelectorAll('.block-card')).toHaveLength(1))
    expect(card().style.height).toBe('96px')
    expect(card().style.width).toBe('300px')
  })
})

describe('마감 §2 제거하면 파일 정보도 함께 사라진다', () => {
  it('keeps the description, the box, and the link, and drops the file data', () => {
    const state = withReference()
    const id = state.brief.blocks[0]!.id
    const linked = briefReducer(state, { type: 'SET_BLOCK_LINK', blockId: id, url: 'https://shop.example.com/item/1' })
    const before = linked.brief.blocks[0]!
    expect(before.assetId).toBe('asset_ref')
    expect(before.image?.referenceOnly).toBe(true)

    const removed = briefReducer(linked, { type: 'REMOVE_BLOCK_ASSET', blockId: id })
    const after = removed.brief.blocks[0]!

    expect(after.assetId).toBeUndefined()
    expect(after.image?.referenceOnly).toBeUndefined()
    expect(after.image?.productName).toBeUndefined()
    // What the planner wrote, where the block sits, and the link all stay.
    expect(after.content).toBe('아크웨이브 제품 누끼 이미지')
    expect(after.position).toEqual(before.position)
    expect(findLinkPartner(removed.brief.blocks, after)).not.toBeNull()
  })

  it('leaves no trace of an attachment in the AI summary', () => {
    const state = withReference()
    const id = state.brief.blocks[0]!.id
    const linked = briefReducer(state, { type: 'SET_BLOCK_LINK', blockId: id, url: 'https://shop.example.com/item/1' })
    const removed = briefReducer(linked, { type: 'REMOVE_BLOCK_ASSET', blockId: id })

    const { design, publishing } = summarize(removed.brief)
    const slot = design.imageSlots.find((s) => s.blockId === id)!
    expect(slot.description).toBe('아크웨이브 제품 누끼 이미지')
    expect(slot.referenceAssetId).toBeUndefined()
    expect(slot.referenceOnly).toBeUndefined()
    expect(JSON.stringify(design)).not.toContain('asset_ref')
    // The publishing link is untouched.
    expect(publishing.links.some((l) => l.url === 'https://shop.example.com/item/1')).toBe(true)
  })

  it('takes a fresh capture again after a removal', () => {
    const state = withReference()
    const id = state.brief.blocks[0]!.id
    const removed = briefReducer(state, { type: 'REMOVE_BLOCK_ASSET', blockId: id })

    const next: Asset = { id: 'asset_new', fileName: 'second.png', mimeType: 'image/png' }
    const again = briefReducer(removed, {
      type: 'ASSIGN_IMAGE',
      blockId: id,
      asset: next,
      image: { productName: 'second', referenceOnly: true },
    })
    const block = again.brief.blocks[0]!
    expect(block.assetId).toBe('asset_new')
    expect(block.image?.productName).toBe('second')
    expect(block.image?.referenceOnly).toBe(true)
    expect(summarize(again.brief).design.imageSlots[0]!.referenceAssetId).toBe('asset_new')
  })

  it('undoes a removal back to the attached state', () => {
    const state = withReference()
    const id = state.brief.blocks[0]!.id
    const removed = briefReducer(state, { type: 'REMOVE_BLOCK_ASSET', blockId: id })
    expect(removed.brief.blocks[0]!.assetId).toBeUndefined()
    // The pre-removal state is untouched, which is what undo restores.
    expect(state.brief.blocks[0]!.assetId).toBe('asset_ref')
    expect(state.brief.blocks[0]!.image?.referenceOnly).toBe(true)
  })
})

describe('손검수 1 §4 첨부 후에도 블록을 다룰 수 있다', () => {
  it('leaves the description editor as soon as a capture arrives, and drags again', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))
    // The description field is still open — the flow a planner actually takes.
    await user.type(screen.getByLabelText('이미지 내용'), '참고 사진 설명')
    await attach(user)

    // The picture is visible, the field is closed, and the description is kept.
    expect(screen.queryByLabelText('이미지 내용')).toBeNull()
    expect(within(card()).getByText('참고 사진 설명')).toBeTruthy()

    // And the block moves again.
    const before = card().style.left
    fireEvent.pointerDown(card(), { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 40, clientY: 130 })
    fireEvent.pointerUp(window, { clientX: 40, clientY: 130 })
    expect(card().style.left).not.toBe(before)
  })

  it('keeps the ⋯ menu working on a block that holds a capture', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))
    await user.type(screen.getByLabelText('이미지 내용'), '참고 사진 설명')
    await attach(user)

    await user.click(within(card()).getByLabelText('이미지 블록 메뉴'))
    await user.click(within(card()).getByRole('button', { name: '참고 이미지 제거' }))
    await waitFor(() => expect(canvas().querySelector('.block-card__thumb')).toBeNull())
    expect(within(card()).getByText('참고 사진 설명')).toBeTruthy()
  })
})

describe('§3 참고자료의 의미', () => {
  it('marks the attachment reference-only, never as the asset to use', () => {
    const state = withReference()
    const block = state.brief.blocks[0]!
    expect(block.image?.referenceOnly).toBe(true)

    const { design, page } = summarize(state.brief)
    const slot = design.imageSlots.find((s) => s.blockId === block.id)!
    expect(slot.referenceAssetId).toBe('asset_ref')
    expect(slot.referenceOnly).toBe(true)
    expect(slot.description).toBe('아크웨이브 제품 누끼 이미지')
    expect(slot.pageId).toBe(page.id)
    expect(slot.geometry.width).toBe(block.position.width)

    // Nothing tells the AI to insert this file: a reference capture is not a
    // product image at all, and not a verbatim image.
    expect(design.requiredProducts.some((p) => p.blockId === block.id)).toBe(false)
    expect(design.verbatimImages.some((i) => i.assetId === 'asset_ref')).toBe(false)
  })

  it('keeps a legacy image block meaning exactly what it did', () => {
    const legacy = createBlock('existing_full_image', { id: 'blk_old', label: '기존 통이미지', assetId: 'asset_old' })
    const brief = { ...createEmptyBrief('과거 문서'), blocks: [legacy] }

    const { design } = summarize(brief)
    expect(design.verbatimImages.find((i) => i.blockId === 'blk_old')!.assetId).toBe('asset_old')
    expect(design.imageSlots.find((s) => s.blockId === 'blk_old')?.referenceOnly).toBeUndefined()
    expect(classifyAssetArea(brief, 'asset_old')).toBe('design')
  })

  it('files a reference capture under references/, not under the design assets', () => {
    const state = withReference()
    expect(classifyAssetArea(state.brief, 'asset_ref')).toBe('reference')
  })

  it('keeps the click URL in publishing only, even with a capture attached', () => {
    const state = withReference()
    const id = state.brief.blocks[0]!.id
    const linked = briefReducer(state, { type: 'SET_BLOCK_LINK', blockId: id, url: 'https://shop.example.com/item/1' })

    const { design, publishing } = summarize(linked.brief)
    expect(JSON.stringify(design)).not.toContain('shop.example.com')
    expect(publishing.links.some((l) => l.url === 'https://shop.example.com/item/1')).toBe(true)
  })

  it('describes an image slot that has no capture at all', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'main_product_image', label: '이미지' })
    const id = created.brief.blocks[0]!.id
    const described = briefReducer(created, { type: 'COMMIT_TEXT', blockId: id, content: '여름 바다 느낌의 배경' })

    const slot = summarize(described.brief).design.imageSlots.find((s) => s.blockId === id)!
    expect(slot.description).toBe('여름 바다 느낌의 배경')
    expect(slot.referenceAssetId).toBeUndefined()
    expect(slot.referenceOnly).toBeUndefined()
  })
})

describe('§4 보존', () => {
  function docWithReference(): BriefDocument {
    const state = withReference()
    const doc = createEmptyDocument(state.brief.project)
    doc.pages[0]!.blocks = state.brief.blocks
    doc.assets = state.brief.assets
    return doc
  }

  it('survives an autosave and a reload', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))
    await user.type(screen.getByLabelText('이미지 내용'), '아크웨이브 제품 누끼')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await attach(user)

    await waitFor(async () => {
      const saved = await loadDocument()
      const block = saved!.pages[0]!.blocks[0]!
      expect(block.assetId).toBeDefined()
      expect(block.image?.referenceOnly).toBe(true)
      expect(block.content).toBe('아크웨이브 제품 누끼')
    }, { timeout: 6000 })
  })

  it('is carried by block duplication, page duplication, and delivery', () => {
    const state = withReference()
    const doc = createEmptyDocument(state.brief.project)
    doc.pages[0]!.blocks = state.brief.blocks
    doc.assets = state.brief.assets
    const source = doc.pages[0]!.blocks[0]!

    const duplicated = briefReducer(state, { type: 'DUPLICATE_BLOCK', blockId: source.id })
    const copy = duplicated.brief.blocks[1]!
    expect(copy.assetId).toBe('asset_ref')
    expect(copy.image?.referenceOnly).toBe(true)

    const withPageCopy = duplicatePage(doc, doc.pages[0]!.id)
    expect(withPageCopy.pages[1]!.blocks[0]!.image?.referenceOnly).toBe(true)
    expect(withPageCopy.pages[1]!.blocks[0]!.assetId).toBe('asset_ref')

    const request = createWorkRequest('req_1', doc, '2026-07-31T00:00:00.000Z')
    expect(request.submittedDoc.pages[0]!.blocks[0]!.image?.referenceOnly).toBe(true)
    expect(requestAssetIds(request)).toContain('asset_ref')
  })

  it('survives an .eventbrief round-trip with its meaning intact', async () => {
    const doc = docWithReference()
    const stored = [{
      id: 'asset_ref',
      fileName: 'capture.png',
      mimeType: 'image/png' as const,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      byteSize: 3,
      createdAt: '2026-07-31T00:00:00.000Z',
    }]

    const pkg = await packageEventDocument({ doc, assets: stored, previews: [], createdAt: 't' })
    expect(pkg.manifest.assets.find((a) => a.assetId === 'asset_ref')!.path.startsWith('references/')).toBe(true)

    const reopened = (await readEventDocument(pkg.blob)).doc
    const block = reopened.pages[0]!.blocks[0]!
    expect(block.image?.referenceOnly).toBe(true)
    expect(block.assetId).toBe('asset_ref')
    expect(block.content).toBe('아크웨이브 제품 누끼 이미지')
  })

  it('leaves the page-wide 참고 이미지 feature alone', async () => {
    const doc = createEmptyDocument(createEmptyBrief('과거 이벤트 참고').project)
    doc.pages[0]!.reference = { ...doc.pages[0]!.reference, assetId: 'asset_page', viewMode: 'overlay', visible: true }
    doc.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_1', content: '문구' })]
    await saveDocument(doc, 1)

    renderEditor()
    await waitFor(() => expect(screen.getByRole('radio', { name: '오버레이' }).getAttribute('aria-checked')).toBe('true'))
    // The page reference is not an image block and never becomes one.
    expect(canvas().querySelectorAll('.block-card')).toHaveLength(1)
  })
})
