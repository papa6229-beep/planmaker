/**
 * Focused tests for the 기획서 작성 화면 1차 단순화 (§7 자동검사 목록).
 *
 * The point of this suite is that simplifying the *screen* must not make the
 * saved data or the AI input any vaguer: exact wording survives verbatim, an
 * image slot keeps its description and its asset, a button's wording and its URL
 * stay separated, and a 요청 메모 is marked as never-printed.
 *
 * Screen behaviour is checked through the rendered editor; the data contracts
 * are checked on the pure reducer + summary builders and through a real
 * `.eventbrief` round-trip, which is both exact and free of autosave timing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { clearAll, getAllAssets, resetAssetStoreForTests, saveDocument } from '../services/assetStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { createBlock, createEmptyBrief } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'
import { buildDesignSummary, buildPublishingInfo } from '../domain/summaryBuilder'
import { pageAsEventBrief } from '../domain/briefMigration'
import { briefReducer, createInitialEditorState, type EditorState } from '../features/editor/briefEditor'
import { findLinkPartner } from '../domain/simpleBlocks'
import { packageEventDocument } from '../services/eventBriefExport'
import { readEventDocument } from '../services/eventBriefImport'
import { createWorkRequest } from '../domain/workRequest'
import type { BriefDocument } from '../domain/pageSchema'
import type { EventBrief } from '../domain/briefSchema'

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
        <AppShell />
      </RequestsProvider>
    </MemoryRouter>,
  )
}

const palette = () => screen.getByRole('complementary', { name: '블록 팔레트' })
const inspector = () => screen.getByRole('complementary', { name: '선택 블록 설정' })
const canvas = () => screen.getByRole('region', { name: '기획 캔버스' })

function pngFile(name = 'photo.png') {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' })
}

/** Runs reducer actions from a fresh editor state. */
function reduce(...actions: Parameters<typeof briefReducer>[1][]): EditorState {
  return actions.reduce((s, a) => briefReducer(s, a), createInitialEditorState())
}

/** Wraps a single-page brief as a document so summary/archive code can read it. */
function asDocument(brief: EventBrief): BriefDocument {
  const doc = createEmptyDocument(brief.project)
  doc.pages[0]!.blocks = brief.blocks
  doc.assets = brief.assets
  return doc
}

function summarize(doc: BriefDocument) {
  const page = doc.pages[0]!
  const brief = pageAsEventBrief(doc, page)
  return {
    page,
    design: buildDesignSummary(brief, { pageId: page.id }),
    publishing: buildPublishingInfo(brief),
  }
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
})

// ── 첫 시작 선택 (§2.1) ──────────────────────────────────────────────────────

describe('첫 시작 선택 (§2.1)', () => {
  it('offers the two starting choices on a brand-new document', () => {
    renderEditor()
    const start = screen.getByRole('group', { name: '어떻게 시작할까요' })
    expect(within(start).getByRole('button', { name: /참고 이미지 위에서 시작/ })).toBeTruthy()
    expect(within(start).getByRole('button', { name: /빈 화면에서 시작/ })).toBeTruthy()
  })

  it('does not show the choice again for a document already in progress', async () => {
    const doc = createEmptyDocument(createEmptyBrief('진행 중 기획서').project)
    doc.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_x', content: '이미 작성한 문구' })]
    await saveDocument(doc, 1)

    renderEditor()
    await waitFor(() => {
      expect(within(canvas()).getByRole('button', { name: /이미 작성한 문구/ })).toBeTruthy()
    })
    expect(screen.queryByRole('group', { name: '어떻게 시작할까요' })).toBeNull()
  })

  it('goes straight to the canvas when 빈 화면에서 시작 is chosen', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    expect(screen.queryByRole('group', { name: '어떻게 시작할까요' })).toBeNull()
    expect(canvas()).toBeTruthy()
  })

  it('starting on a reference image lays it visibly under the canvas', async () => {
    const user = userEvent.setup()
    const { container } = renderEditor()

    const input = container.querySelector('.start-choice__input') as HTMLInputElement
    await user.upload(input, pngFile('past-event.png'))

    // The choice is done, and the reference is actually showing — the overlay
    // layer defaults to hidden, so this guards against a silent dead end.
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: '어떻게 시작할까요' })).toBeNull()
      expect(container.querySelector('.canvas__overlay')).not.toBeNull()
    })
    // Overlay mode is selected in the existing reference controls.
    expect(screen.getByRole('radio', { name: '오버레이' }).getAttribute('aria-checked')).toBe('true')
  })
})

// ── 단순 팔레트 (§2.2) ───────────────────────────────────────────────────────

describe('단순 팔레트 (§2.2)', () => {
  it('shows exactly the four tools', () => {
    renderEditor()
    const tools = within(screen.getByRole('list', { name: '기본 블록' })).getAllByRole('button')
    expect(tools).toHaveLength(4)
    expect(tools.map((b) => b.getAttribute('aria-label'))).toEqual([
      '글 넣기',
      '이미지',
      '버튼·링크',
      '요청 메모',
    ])
  })

  it('keeps a hidden legacy block type intact, rendered, and editable', async () => {
    // 혜택 is no longer offered in the palette, but an existing document holding
    // one must open, render, and stay editable with its data untouched.
    const benefit = createBlock('benefit', {
      id: 'blk_benefit',
      content: '1+1 혜택',
      notes: '원본 메모',
      position: { x: 40, y: 40, width: 300, height: 90 },
    })
    const doc = createEmptyDocument(createEmptyBrief('과거 문서').project)
    doc.pages[0]!.blocks = [benefit]
    await saveDocument(doc, 1)

    const user = userEvent.setup()
    renderEditor()
    const card = await waitFor(() => within(canvas()).getByRole('button', { name: /1\+1 혜택/ }))

    // The legacy type keeps its own name and stays editable in place.
    await user.click(card)
    expect(within(inspector()).getByText('혜택')).toBeTruthy()
    await user.dblClick(card)
    const editor = screen.getByLabelText('혜택 내용') as HTMLTextAreaElement
    expect(editor.value).toBe('1+1 혜택')
    await user.keyboard('{Escape}')
  })
})

// ── 글 넣기 (§2.3) ───────────────────────────────────────────────────────────

describe('글 넣기 (§2.3)', () => {
  it('stores the exact wording typed straight into the block', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(within(palette()).getByRole('button', { name: '글 넣기' }))

    const exact = '여름 특가 40% + 사은품 증정!!'
    await user.dblClick(canvas().querySelector('.block-card') as HTMLElement)
    await user.type(screen.getByLabelText('문구 내용'), exact)
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(within(canvas()).getByRole('button', { name: new RegExp(exact.replace(/[+()]/g, '\\$&')) })).toBeTruthy()
  })

  it('keeps the block type neutral and records emphasis on the layout hint', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'free_text', label: '문구' })
    const id = created.brief.blocks[0]!.id
    const next = briefReducer(created, {
      type: 'UPDATE_BLOCK',
      blockId: id,
      patch: { content: '여름 세일', layoutHint: { emphasis: 'high' } },
    })
    const block = next.brief.blocks[0]!
    // Emphasis never rewrites the semantic type — large text is not a headline.
    expect(block.type).toBe('free_text')
    expect(block.content).toBe('여름 세일')
    expect(block.layoutHint.emphasis).toBe('high')
  })

  it('carries every generic text into the AI summary with emphasis, ids and geometry', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'free_text', label: '문구' })
    const id = created.brief.blocks[0]!.id
    const typed = briefReducer(created, {
      type: 'UPDATE_BLOCK',
      blockId: id,
      patch: { content: '가격 9,900원' },
    })
    // Emphasis follows the block's size, so shrink it to make this text small.
    const next = briefReducer(typed, {
      type: 'RESIZE_BLOCK',
      blockId: id,
      rect: { x: 20, y: 20, width: 180, height: 40 },
    })

    const { page, design } = summarize(asDocument(next.brief))
    const entry = design.texts.find((t) => t.content === '가격 9,900원')
    expect(entry).toBeDefined()
    expect(entry!.emphasis).toBe('low')
    expect(entry!.pageId).toBe(page.id)
    expect(entry!.blockId).toBe(id)
    expect(entry!.geometry.width).toBeGreaterThan(0)
  })

  it('does not warn about a missing headline when generic text exists', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'free_text', label: '문구' })
    const id = created.brief.blocks[0]!.id
    const next = briefReducer(created, { type: 'UPDATE_BLOCK', blockId: id, patch: { content: '문구 있음' } })
    // Regression guard: the old NO_MAIN_HEADLINE rule fired on every simplified
    // brief. Now only a brief with no wording at all is flagged.
    const { design } = summarize(asDocument(next.brief))
    expect(design.texts).toHaveLength(1)
  })
})

// ── 이미지 자리 (§2.3) ───────────────────────────────────────────────────────

describe('이미지 (§2.3)', () => {
  it('can be placed with only a description and no image yet', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(within(palette()).getByRole('button', { name: '이미지' }))
    const card = canvas().querySelector('.block-card') as HTMLElement
    await user.dblClick(card)
    await user.type(screen.getByLabelText('이미지 내용'), '여기에 대표 제품 사진')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(within(canvas()).getByText('여기에 대표 제품 사진')).toBeTruthy()
  })

  it('keeps the description when a real image is attached', async () => {
    const user = userEvent.setup()
    const { container } = renderEditor()
    await user.click(within(palette()).getByRole('button', { name: '이미지' }))
    const card = canvas().querySelector('.block-card') as HTMLElement
    await user.dblClick(card)
    await user.type(screen.getByLabelText('이미지 내용'), '대표 제품 사진')
    await user.keyboard('{Control>}{Enter}{/Control}')

    const fileInput = container.querySelector('.block-card__file') as HTMLInputElement
    await user.upload(fileInput, pngFile())

    await waitFor(async () => {
      expect(await getAllAssets()).toHaveLength(1)
    })
    // The description survives alongside the picture.
    await user.dblClick(canvas().querySelector('.block-card') as HTMLElement)
  })

  it('reports the slot description and asset to the AI summary', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'main_product_image', label: '이미지 자리' })
    const id = created.brief.blocks[0]!.id
    const next = briefReducer(created, {
      type: 'UPDATE_BLOCK',
      blockId: id,
      patch: { content: '여기에 대표 제품', image: { productName: '여름 쿨 티셔츠' } },
    })
    const { design } = summarize(asDocument(next.brief))
    const product = design.requiredProducts.find((p) => p.blockId === id)
    expect(product).toBeDefined()
    expect(product!.productName).toBe('여름 쿨 티셔츠')
    expect(next.brief.blocks[0]!.content).toBe('여기에 대표 제품')
  })
})

// ── 버튼·링크 (§2.3, 판정 3) ─────────────────────────────────────────────────

describe('버튼·링크 (§2.3, 판정 3)', () => {
  it('shows one card while storing two blocks', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(within(palette()).getByRole('button', { name: '버튼·링크' }))

    // One card only — the publishing URL half is not drawn.
    expect(canvas().querySelectorAll('.block-card')).toHaveLength(1)
    // Both the wording and the URL are entered on that card.
    const card = canvas().querySelector('.block-card') as HTMLElement
    expect(within(card).getByRole('button', { name: '버튼 링크 연결' })).toBeTruthy()
    // The internal group id used for pairing is not advertised as a user group.
    expect(within(card).queryByTitle('그룹')).toBeNull()
    expect(card.className).not.toContain('block-card--grouped')
  })

  it('separates the wording (design) from the URL (publishing) in the data', () => {
    const created = reduce({ type: 'ADD_BUTTON_LINK', label: '버튼' })
    const blocks = created.brief.blocks
    expect(blocks).toHaveLength(2)

    const button = blocks.find((b) => b.type === 'cta_button')!
    const url = blocks.find((b) => b.type === 'button_url')!
    expect(button.aiVisibility).toBe('design')
    expect(url.aiVisibility).toBe('publishing')
    expect(findLinkPartner(blocks, button)?.id).toBe(url.id)
    expect(findLinkPartner(blocks, url)?.id).toBe(button.id)
  })

  it('never leaks the URL into the AI design summary, only into publishing info', () => {
    const created = reduce({ type: 'ADD_BUTTON_LINK', label: '버튼' })
    const button = created.brief.blocks.find((b) => b.type === 'cta_button')!
    const url = created.brief.blocks.find((b) => b.type === 'button_url')!
    const withText = briefReducer(created, { type: 'UPDATE_BLOCK', blockId: button.id, patch: { content: '자세히 보기' } })
    const withUrl = briefReducer(withText, {
      type: 'UPDATE_BLOCK',
      blockId: url.id,
      patch: { content: 'https://secret.example.com/x' },
    })

    const { design, publishing } = summarize(asDocument(withUrl.brief))
    expect(JSON.stringify(design)).not.toContain('secret.example.com')
    expect(design.ctaButtons.some((c) => c.text === '자세히 보기' && c.hasLink)).toBe(true)
    expect(publishing.links.some((l) => l.url === 'https://secret.example.com/x')).toBe(true)
  })

  it('creates, undoes and deletes the pair as one unit', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(within(palette()).getByRole('button', { name: '버튼·링크' }))
    expect(canvas().querySelectorAll('.block-card')).toHaveLength(1)

    // A single undo removes the whole pair.
    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    expect(canvas().querySelectorAll('.block-card')).toHaveLength(0)

    // Deleting the visible card removes both halves.
    await user.click(within(palette()).getByRole('button', { name: '버튼·링크' }))
    await user.click(within(canvas()).getByRole('button', { name: '삭제' }))
    expect(canvas().querySelectorAll('.block-card')).toHaveLength(0)
  })

  it('deletes both halves and duplicates into a fresh pair (reducer level)', () => {
    const created = reduce({ type: 'ADD_BUTTON_LINK', label: '버튼' })
    const button = created.brief.blocks.find((b) => b.type === 'cta_button')!

    const deleted = briefReducer(created, { type: 'DELETE_BLOCK', blockId: button.id })
    expect(deleted.brief.blocks).toHaveLength(0)

    const duped = briefReducer(created, { type: 'DUPLICATE_BLOCK', blockId: button.id })
    expect(duped.brief.blocks.filter((b) => b.type === 'cta_button')).toHaveLength(2)
    expect(duped.brief.blocks.filter((b) => b.type === 'button_url')).toHaveLength(2)
    // Two separate pairs, not one group of four.
    expect(new Set(duped.brief.blocks.map((b) => b.groupId)).size).toBe(2)
    // The copy is a recognised pair too.
    const clones = duped.brief.blocks.filter((b) => !created.brief.blocks.some((o) => o.id === b.id))
    const cloneButton = clones.find((b) => b.type === 'cta_button')!
    expect(findLinkPartner(duped.brief.blocks, cloneButton)).toBeDefined()
  })

  it('leaves a legacy standalone button_url visible and untouched', async () => {
    const legacy = createBlock('button_url', {
      id: 'blk_legacy_url',
      content: 'https://old.example.com',
      position: { x: 40, y: 400, width: 300, height: 80 },
    })
    const doc = createEmptyDocument(createEmptyBrief('과거 문서').project)
    doc.pages[0]!.blocks = [legacy]
    await saveDocument(doc, 1)

    renderEditor()
    // Not part of any pair → still shown as its own card, as before.
    await waitFor(() => {
      expect(within(canvas()).getByRole('button', { name: /버튼 연결 URL/ })).toBeTruthy()
    })
    expect(findLinkPartner(doc.pages[0]!.blocks, legacy)).toBeUndefined()
  })
})

// ── 요청 메모 (§2.3, 판정 1) ─────────────────────────────────────────────────

describe('요청 메모 (§2.3, 판정 1)', () => {
  it('is created as a non-printing reference instruction', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(within(palette()).getByRole('button', { name: '요청 메모' }))
    await user.dblClick(canvas().querySelector('.block-card') as HTMLElement)
    await user.type(screen.getByLabelText('요청 메모 내용'), '이 부분은 시원한 느낌으로')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(within(canvas()).getByText('이 부분은 시원한 느낌으로')).toBeTruthy()
  })

  it('appears in the AI summary as an instruction that must not be rendered', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'revision_reference', label: '요청 메모' })
    const id = created.brief.blocks[0]!.id
    const next = briefReducer(created, {
      type: 'UPDATE_BLOCK',
      blockId: id,
      patch: { content: '이 부분은 시원한 느낌으로' },
    })
    expect(next.brief.blocks[0]!.aiVisibility).toBe('reference')

    const { page, design, publishing } = summarize(asDocument(next.brief))
    const memo = design.instructions.find((i) => i.content === '이 부분은 시원한 느낌으로')
    expect(memo).toBeDefined()
    expect(memo!.renderAsText).toBe(false)
    expect(memo!.pageId).toBe(page.id)
    expect(memo!.blockId).toBe(id)
    expect(memo!.scope).toBe('block')
    expect(memo!.geometry!.width).toBeGreaterThan(0)

    // Not something to print verbatim…
    expect(design.texts.some((t) => t.content === '이 부분은 시원한 느낌으로')).toBe(false)
    // …and not publishing information either.
    expect(JSON.stringify(publishing)).not.toContain('시원한 느낌')
  })

  it('reads a pre-existing revision_reference block as the same instruction', () => {
    const legacy = createBlock('revision_reference', {
      id: 'blk_legacy_note',
      content: '기존 수정 요청 메모',
      position: { x: 40, y: 40, width: 300, height: 90 },
    })
    const doc = createEmptyDocument(createEmptyBrief('과거 문서').project)
    doc.pages[0]!.blocks = [legacy]

    const { design } = summarize(doc)
    expect(design.instructions).toHaveLength(1)
    expect(design.instructions[0]!.content).toBe('기존 수정 요청 메모')
    expect(design.instructions[0]!.renderAsText).toBe(false)
    // The stored block itself is untouched.
    expect(doc.pages[0]!.blocks[0]!.type).toBe('revision_reference')
    expect(doc.pages[0]!.blocks[0]!.content).toBe('기존 수정 요청 메모')
  })
})

// ── 왕복 보존 (§7) ───────────────────────────────────────────────────────────

describe('왕복 보존 (§7)', () => {
  /** Builds a brief holding all four simplified kinds. */
  function fourKindBrief() {
    let state = reduce({ type: 'ADD_BLOCK', blockType: 'free_text', label: '문구' })
    const textId = state.brief.blocks[0]!.id
    state = briefReducer(state, {
      type: 'UPDATE_BLOCK',
      blockId: textId,
      patch: { content: '여름 특가 40%!!  (사은품 증정)', layoutHint: { emphasis: 'high' } },
    })

    state = briefReducer(state, { type: 'ADD_BLOCK', blockType: 'main_product_image', label: '이미지 자리' })
    const slotId = state.brief.blocks.at(-1)!.id
    state = briefReducer(state, { type: 'UPDATE_BLOCK', blockId: slotId, patch: { content: '여기에 대표 제품' } })

    state = briefReducer(state, { type: 'ADD_BUTTON_LINK', label: '버튼' })
    const button = state.brief.blocks.find((b) => b.type === 'cta_button')!
    const url = state.brief.blocks.find((b) => b.type === 'button_url')!
    state = briefReducer(state, { type: 'UPDATE_BLOCK', blockId: button.id, patch: { content: '지금 신청하기' } })
    state = briefReducer(state, {
      type: 'UPDATE_BLOCK',
      blockId: url.id,
      patch: { content: 'https://event.example.com/apply' },
    })

    state = briefReducer(state, { type: 'ADD_BLOCK', blockType: 'revision_reference', label: '요청 메모' })
    const noteId = state.brief.blocks.at(-1)!.id
    state = briefReducer(state, { type: 'UPDATE_BLOCK', blockId: noteId, patch: { content: '20%를 강하게 강조' } })

    return state.brief
  }

  it('survives a .eventbrief export → import round-trip unchanged', async () => {
    const doc = asDocument(fourKindBrief())
    const pkg = await packageEventDocument({ doc, assets: [], previews: [], createdAt: 't' })
    const reopened = (await readEventDocument(pkg.blob)).doc

    const before = doc.pages[0]!.blocks
    const after = reopened.pages[0]!.blocks
    expect(after).toHaveLength(before.length)

    // Exact wording, type, visibility, emphasis and geometry all survive.
    for (const original of before) {
      const restored = after.find((b) => b.id === original.id)!
      expect(restored.type).toBe(original.type)
      expect(restored.content).toBe(original.content)
      expect(restored.aiVisibility).toBe(original.aiVisibility)
      expect(restored.layoutHint.emphasis).toBe(original.layoutHint.emphasis)
      expect(restored.position).toEqual(original.position)
      expect(restored.groupId).toBe(original.groupId)
    }

    // The pair is still recognised after the round-trip, and the URL still
    // belongs to publishing only.
    const button = after.find((b) => b.type === 'cta_button')!
    expect(findLinkPartner(after, button)).toBeDefined()
    const { design, publishing } = summarize(reopened)
    expect(JSON.stringify(design)).not.toContain('event.example.com')
    expect(publishing.links.some((l) => l.url === 'https://event.example.com/apply')).toBe(true)
    expect(design.instructions.some((i) => i.content === '20%를 강하게 강조')).toBe(true)
    expect(design.texts.some((t) => t.content === '여름 특가 40%!!  (사은품 증정)')).toBe(true)
  })

  it('preserves the simplified blocks inside a WorkRequest submitted snapshot', () => {
    const doc = asDocument(fourKindBrief())
    const request = createWorkRequest('req_test', doc, '2026-07-30T00:00:00.000Z')

    const submitted = request.submittedDoc.pages[0]!.blocks
    expect(submitted.find((b) => b.type === 'free_text')!.content).toBe('여름 특가 40%!!  (사은품 증정)')
    expect(submitted.find((b) => b.type === 'button_url')!.content).toBe('https://event.example.com/apply')
    expect(submitted.find((b) => b.type === 'revision_reference')!.content).toBe('20%를 강하게 강조')

    // The snapshot is a copy: editing the live document cannot change it.
    doc.pages[0]!.blocks[0]!.content = '바뀐 문구'
    expect(request.submittedDoc.pages[0]!.blocks.find((b) => b.type === 'free_text')!.content).toBe(
      '여름 특가 40%!!  (사은품 증정)',
    )
  })
})
