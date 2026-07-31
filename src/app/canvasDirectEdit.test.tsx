/**
 * Focused tests for 중앙 직접 편집 (§10 items 1–7).
 *
 * The point is that the canvas card is now the only place these things are
 * entered, and that doing so keeps the data contracts intact: wording stays
 * verbatim, emphasis follows the visible size instead of a separate control,
 * and a URL lands in a publishing block rather than in the design wording.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { clearAll, getAllAssets, resetAssetStoreForTests } from '../services/assetStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { briefReducer, createInitialEditorState, type EditorState } from '../features/editor/briefEditor'
import { findLinkPartner, linkUrlOf } from '../domain/simpleBlocks'
import { buildDesignSummary, buildPublishingInfo } from '../domain/summaryBuilder'
import { pageAsEventBrief } from '../domain/briefMigration'
import { createEmptyDocument } from '../domain/pageSchema'
import type { EventBrief } from '../domain/briefSchema'

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

function pngFile(name = 'photo.png') {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' })
}

function reduce(...actions: Parameters<typeof briefReducer>[1][]): EditorState {
  return actions.reduce((s, a) => briefReducer(s, a), createInitialEditorState())
}

function summarize(brief: EventBrief) {
  const doc = createEmptyDocument(brief.project)
  doc.pages[0]!.blocks = brief.blocks
  doc.assets = brief.assets
  const page = doc.pages[0]!
  const projected = pageAsEventBrief(doc, page)
  return { design: buildDesignSummary(projected, { pageId: page.id }), publishing: buildPublishingInfo(projected) }
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
})

describe('§10.1 중앙 문구 직접 입력', () => {
  it('takes the wording inside the block and shows it verbatim on the card', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('글 넣기'))

    const card = within(canvas()).getByRole('button', { name: /문구/ })
    await user.dblClick(card)
    const editor = screen.getByLabelText('문구 내용')
    await user.type(editor, '여름 특가 40% + 사은품!!')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(within(canvas()).getByRole('button', { name: /여름 특가 40% \+ 사은품!!/ })).toBeTruthy()
    // No duplicate wording input remains on the right — that column is the
    // brief library now, and the emphasis control is gone entirely.
    expect(screen.getByRole('complementary', { name: '내 기획서' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: '강조 정도' })).toBeNull()
  })

  it('records one inline edit as a single undo step', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('글 넣기'))
    const card = within(canvas()).getByRole('button', { name: /문구/ })
    await user.dblClick(card)
    await user.type(screen.getByLabelText('문구 내용'), '한 번에 병합')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(within(canvas()).getByRole('button', { name: /한 번에 병합/ })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    expect(within(canvas()).queryByRole('button', { name: /한 번에 병합/ })).toBeNull()
    // The block itself survives — only the wording edit was undone.
    expect(within(canvas()).getByRole('button', { name: /문구/ })).toBeTruthy()
  })
})

describe('§10.2–3 크기에 따른 글자 크기와 emphasis', () => {
  it('draws the wording larger as the block grows, and updates emphasis with it', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'free_text', label: '문구' })
    const id = created.brief.blocks[0]!.id
    const withText = briefReducer(created, { type: 'UPDATE_BLOCK', blockId: id, patch: { content: '50% 할인' } })

    const big = briefReducer(withText, {
      type: 'RESIZE_BLOCK',
      blockId: id,
      rect: { x: 20, y: 20, width: 600, height: 220 },
    })
    const small = briefReducer(withText, {
      type: 'RESIZE_BLOCK',
      blockId: id,
      rect: { x: 20, y: 20, width: 180, height: 40 },
    })

    expect(big.brief.blocks[0]!.layoutHint.emphasis).toBe('high')
    expect(small.brief.blocks[0]!.layoutHint.emphasis).toBe('low')
    // The semantic type is never rewritten by resizing.
    expect(big.brief.blocks[0]!.type).toBe('free_text')
    expect(small.brief.blocks[0]!.type).toBe('free_text')
  })

  it('shows the size change on the canvas as the block is resized', async () => {
    const user = userEvent.setup()
    const { container } = renderEditor()
    await user.click(tool('글 넣기'))
    const card = within(canvas()).getByRole('button', { name: /문구/ }) as HTMLElement
    await user.dblClick(card)
    await user.type(screen.getByLabelText('문구 내용'), '50% 할인')
    await user.keyboard('{Control>}{Enter}{/Control}')

    const textEl = card.querySelector('.block-card__content') as HTMLElement
    const before = Number.parseFloat(textEl.style.fontSize)

    const se = container.querySelector('.block-card__handle--se') as HTMLElement
    fireEvent.pointerDown(se, { button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(window, { clientX: 460, clientY: 380 })
    fireEvent.pointerUp(window, { clientX: 460, clientY: 380 })

    const after = Number.parseFloat(
      (canvas().querySelector('.block-card__content') as HTMLElement).style.fontSize,
    )
    expect(after).toBeGreaterThan(before)
  })

  it('feeds the derived emphasis into the AI summary', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'free_text', label: '문구' })
    const id = created.brief.blocks[0]!.id
    const withText = briefReducer(created, { type: 'UPDATE_BLOCK', blockId: id, patch: { content: '50% 할인' } })
    const resized = briefReducer(withText, {
      type: 'RESIZE_BLOCK',
      blockId: id,
      rect: { x: 20, y: 20, width: 600, height: 220 },
    })

    const { design } = summarize(resized.brief)
    const entry = design.texts.find((t) => t.content === '50% 할인')!
    expect(entry.emphasis).toBe('high')
    expect(entry.geometry.width).toBe(600)
  })
})

describe('§10.4 긴 문구의 최소 가독성', () => {
  it('marks the block as too small instead of shrinking the text away', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('글 넣기'))
    const card = within(canvas()).getByRole('button', { name: /문구/ }) as HTMLElement
    await user.dblClick(card)
    // A paragraph far longer than the default block can hold at a readable size.
    fireEvent.change(screen.getByLabelText('문구 내용'), {
      target: {
        value:
          '가을 리빙 기획전 이불 커튼 러그 전 품목 최대 50% 할인 5만원 이상 구매 시 무료배송 사은품 증정 9월 한 달 내내 진행합니다. ' +
          '일부 상품은 행사에서 제외되며 재고 소진 시 조기 종료될 수 있습니다. 자세한 내용은 상세페이지를 확인해 주세요.',
      },
    })
    await user.keyboard('{Control>}{Enter}{/Control}')

    const live = canvas().querySelector('.block-card') as HTMLElement
    expect(live.className).toContain('is-overflowing')
    expect(within(live).getByText('블록이 작아요')).toBeTruthy()
  })
})

describe('§10.5 이미지 블록', () => {
  it('accepts a description in the block while it has no picture', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))

    const card = canvas().querySelector('.block-card') as HTMLElement
    expect(within(card).getByText('어떤 이미지가 들어갈지 적어주세요')).toBeTruthy()

    await user.dblClick(card)
    await user.type(screen.getByLabelText('이미지 내용'), '여기에 대표 제품 사진')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(within(canvas()).getByText('여기에 대표 제품 사진')).toBeTruthy()
  })

  it('takes an image dropped straight onto the block', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))
    const card = canvas().querySelector('.block-card') as HTMLElement

    const file = pngFile()
    fireEvent.drop(card, { dataTransfer: { files: [file], types: ['Files'] } })

    await waitFor(async () => {
      expect(await getAllAssets()).toHaveLength(1)
    })
    await waitFor(() => {
      expect(canvas().querySelector('.block-card__thumb')).not.toBeNull()
    })
  })
})

describe('§10.6 이미지 링크 · §10.7 버튼 문구와 URL', () => {
  it('stores an image link in a publishing block, never in the design wording', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))
    const card = canvas().querySelector('.block-card') as HTMLElement

    await user.click(within(card).getByRole('button', { name: '이미지 링크 연결' }))
    await user.type(screen.getByLabelText('이미지 연결 주소'), 'https://shop.example.com/item/1')
    await user.click(screen.getByRole('button', { name: '저장' }))

    // The card shows it is linked, and still renders as one card.
    await waitFor(() => {
      expect(within(canvas()).getByLabelText('연결된 주소 있음')).toBeTruthy()
    })
    expect(canvas().querySelectorAll('.block-card')).toHaveLength(1)
  })

  it('keeps an image URL out of the AI summary and in publishing info', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'main_product_image', label: '이미지' })
    const id = created.brief.blocks[0]!.id
    const described = briefReducer(created, {
      type: 'UPDATE_BLOCK',
      blockId: id,
      patch: { content: '대표 제품 사진' },
    })
    const linked = briefReducer(described, {
      type: 'SET_BLOCK_LINK',
      blockId: id,
      url: 'https://shop.example.com/item/1',
    })

    const image = linked.brief.blocks.find((b) => b.id === id)!
    const partner = findLinkPartner(linked.brief.blocks, image)!
    expect(partner.type).toBe('product_detail_link')
    expect(partner.aiVisibility).toBe('publishing')
    expect(linkUrlOf(linked.brief.blocks, image)).toBe('https://shop.example.com/item/1')

    const { design, publishing } = summarize(linked.brief)
    expect(JSON.stringify(design)).not.toContain('shop.example.com')
    expect(publishing.links.some((l) => l.url === 'https://shop.example.com/item/1')).toBe(true)
  })

  it('clears the link by emptying it, and removes the publishing block', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'main_product_image', label: '이미지' })
    const id = created.brief.blocks[0]!.id
    const linked = briefReducer(created, { type: 'SET_BLOCK_LINK', blockId: id, url: 'https://a.example' })
    expect(linked.brief.blocks).toHaveLength(2)

    const cleared = briefReducer(linked, { type: 'SET_BLOCK_LINK', blockId: id, url: '   ' })
    expect(cleared.brief.blocks).toHaveLength(1)
    expect(cleared.brief.blocks[0]!.type).toBe('main_product_image')
  })

  it('deletes and duplicates a linked image together with its URL block', () => {
    const created = reduce({ type: 'ADD_BLOCK', blockType: 'main_product_image', label: '이미지' })
    const id = created.brief.blocks[0]!.id
    const linked = briefReducer(created, { type: 'SET_BLOCK_LINK', blockId: id, url: 'https://a.example' })

    expect(briefReducer(linked, { type: 'DELETE_BLOCK', blockId: id }).brief.blocks).toHaveLength(0)

    const duped = briefReducer(linked, { type: 'DUPLICATE_BLOCK', blockId: id })
    expect(duped.brief.blocks.filter((b) => b.type === 'main_product_image')).toHaveLength(2)
    expect(duped.brief.blocks.filter((b) => b.type === 'product_detail_link')).toHaveLength(2)
    expect(new Set(duped.brief.blocks.map((b) => b.groupId)).size).toBe(2)
  })

  it('edits the button wording and URL from the button block itself', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('버튼·링크'))
    const card = canvas().querySelector('.block-card') as HTMLElement

    await user.dblClick(card)
    await user.type(screen.getByLabelText('버튼 내용'), '지금 신청하기')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(within(canvas()).getByRole('button', { name: /지금 신청하기/ })).toBeTruthy()

    const live = canvas().querySelector('.block-card') as HTMLElement
    await user.click(within(live).getByRole('button', { name: '버튼 링크 연결' }))
    await user.clear(screen.getByLabelText('버튼 연결 주소'))
    await user.type(screen.getByLabelText('버튼 연결 주소'), 'https://event.example.com/apply')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(within(canvas()).getByLabelText('연결된 주소 있음')).toBeTruthy()
    })
    // Still a single card for the pair.
    expect(canvas().querySelectorAll('.block-card')).toHaveLength(1)
  })
})
