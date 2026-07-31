/**
 * Focused tests for 단계 작업 1-A — 문구 블록을 실제 배치 영역으로 교정.
 *
 * The point is that a text block's box must mean "this is where this wording
 * goes": no kind badge, no label line, and no card padding inside it. The kind
 * and the ⋯ menu move to a floating bar above the selected block, which is
 * screen furniture only — it must never reach the block's coordinates, the AI
 * placement data, or the delivery-status fingerprint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { clearAll, resetAssetStoreForTests, saveDocument } from '../services/assetStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyBrief } from '../domain/factory'
import { fitTextHeight, fitTextSize, MIN_FONT_PX, TEXT_PADDING_PX } from '../domain/textFit'
import { briefStatus } from '../domain/briefStatus'
import { documentFingerprint } from '../domain/documentFingerprint'
import { createWorkRequest } from '../domain/workRequest'

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

const palette = () => screen.getByRole('complementary', { name: '블록 팔레트' })
const canvas = () => screen.getByRole('region', { name: '기획 캔버스' })
const tool = (name: string) => within(palette()).getByRole('button', { name })
const cards = () => Array.from(canvas().querySelectorAll('.block-card')) as HTMLElement[]
const px = (v: string) => Number.parseFloat(v)

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
})

describe('§4.1 신규 팔레트는 3개', () => {
  it('offers 글 넣기 · 이미지 · 버튼·링크 and nothing else', () => {
    renderEditor()
    const tools = within(screen.getByRole('list', { name: '기본 블록' })).getAllByRole('button')
    expect(tools.map((b) => b.getAttribute('aria-label'))).toEqual(['글 넣기', '이미지', '버튼·링크'])
  })

  it('still opens and keeps an existing 요청 메모 block', async () => {
    const note = createBlock('revision_reference', { id: 'blk_note', content: '로고는 하단에 작게' })
    const doc = createEmptyDocument(createEmptyBrief('과거 문서').project)
    doc.pages[0]!.blocks = [note]
    await saveDocument(doc, 1)

    renderEditor()
    await waitFor(() => expect(screen.getByText('로고는 하단에 작게')).toBeTruthy())
    expect(cards()).toHaveLength(1)
  })
})

describe('§4.2 새 블록은 바로 입력 상태', () => {
  it('puts the cursor in the wording field as soon as 글 넣기 is pressed', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('글 넣기'))

    const editor = await screen.findByLabelText('문구 내용')
    expect(document.activeElement).toBe(editor)
    await user.type(editor, '여름 세일')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(screen.getByText('여름 세일')).toBeTruthy()
  })

  it('puts the cursor in the image description as soon as 이미지 is pressed', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('이미지'))

    const editor = await screen.findByLabelText('이미지 내용')
    expect(document.activeElement).toBe(editor)
  })

  it('puts the cursor in the button wording as soon as 버튼·링크 is pressed', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('버튼·링크'))

    const editor = await screen.findByLabelText('버튼 내용')
    expect(document.activeElement).toBe(editor)
  })
})

describe('§3.1 문구 블록 본체는 문구만', () => {
  it('draws no kind badge and no label line inside the block box', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('글 넣기'))
    await user.type(screen.getByLabelText('문구 내용'), '여름 특가')
    await user.keyboard('{Control>}{Enter}{/Control}')

    const card = cards()[0]!
    expect(card.querySelector('.block-card__title')).toBeNull()
    expect(card.querySelector('.block-card__visibility')).toBeNull()
    // The wording is the only thing laid out inside the box.
    expect(card.querySelector('.block-card__content')!.textContent).toBe('여름 특가')
    expect(card.classList.contains('block-card--bare')).toBe(true)
  })

  it('reserves at most 4px of padding around the wording', () => {
    const css = readFileSync('src/styles/global.css', 'utf8')
    const rule = /\.block-card--bare\s*\{[^}]*padding:\s*([0-9.]+)px/.exec(css)
    expect(rule).not.toBeNull()
    expect(Number.parseFloat(rule![1]!)).toBeLessThanOrEqual(4)
    expect(TEXT_PADDING_PX).toBeLessThanOrEqual(4)
  })

  it('sizes the wording from the block box alone, with no card chrome removed', () => {
    // 320×96 of pure text area: only the 4px padding comes off each edge.
    const fit = fitTextSize('여름 특가', 320, 96)
    const bare = fitTextSize('여름 특가', 320 - TEXT_PADDING_PX * 2, 96 - TEXT_PADDING_PX * 2, { padX: 0, padY: 0 })
    expect(fit.fontSize).toBe(bare.fontSize)
  })
})

describe('§3.2 부유 도구막대', () => {
  it('shows the kind and the ⋯ menu above the block only while it is selected', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('글 넣기'))
    await user.keyboard('{Escape}')

    const card = cards()[0]!
    await user.click(card)
    const bar = card.querySelector('.block-toolbar') as HTMLElement
    expect(bar).not.toBeNull()
    expect(bar.textContent).toContain('문구')
    expect(within(bar).getByLabelText('문구 블록 메뉴')).toBeTruthy()
    // Deleting and duplicating still live there.
    await user.click(within(bar).getByLabelText('문구 블록 메뉴'))
    expect(within(bar).getByRole('button', { name: '블록 복제' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: '삭제' })).toBeTruthy()

    // Deselecting hides it again.
    const sheet = canvas().querySelector('.canvas__sheet') as HTMLElement
    fireEvent.pointerDown(sheet, { button: 0 })
    expect(cards()[0]!.querySelector('.block-toolbar')).toBeNull()
  })

  it('never changes the block box or the content fingerprint', async () => {
    const block = createBlock('free_text', {
      id: 'blk_1',
      label: '문구',
      content: '여름 특가',
      position: { x: 40, y: 40, width: 320, height: 96 },
    })
    const doc = createEmptyDocument(createEmptyBrief('선택만 해보는 문서').project)
    doc.pages[0]!.blocks = [block]
    await saveDocument(doc, 1)

    const before = documentFingerprint(doc)
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(cards()).toHaveLength(1))
    const card = cards()[0]!
    const box = { left: card.style.left, top: card.style.top, width: card.style.width, height: card.style.height }

    await user.click(card)
    expect(cards()[0]!.querySelector('.block-toolbar')).not.toBeNull()
    const after = cards()[0]!
    expect({ left: after.style.left, top: after.style.top, width: after.style.width, height: after.style.height }).toEqual(box)
    expect(documentFingerprint(doc)).toBe(before)
  })
})

describe('§3.3 입력 후 세로 여백 정리', () => {
  it('trims the leftover height down to the wording actually drawn', async () => {
    const wording = '여름 특가 최대 50% 할인 무료배송 사은품 증정'
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('글 넣기'))
    const startHeight = px(cards()[0]!.style.height)

    await user.type(screen.getByLabelText('문구 내용'), wording)
    await user.keyboard('{Control>}{Enter}{/Control}')

    const card = cards()[0]!
    const width = px(card.style.width)
    const height = px(card.style.height)
    // The box is exactly the wording, and entering wording never grows it.
    expect(height).toBeLessThanOrEqual(startHeight)
    expect(height).toBe(fitTextHeight(wording, width, fitTextSize(wording, width, height).fontSize))
  })

  it('keeps explicit line breaks, the exact wording, and the 블록이 작아요 signal', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('글 넣기'))
    const editor = screen.getByLabelText('문구 내용') as HTMLTextAreaElement
    await user.type(editor, '첫 줄{Enter}둘째 줄')
    await user.keyboard('{Control>}{Enter}{/Control}')

    const card = cards()[0]!
    expect(card.querySelector('.block-card__content')!.textContent).toBe('첫 줄\n둘째 줄')
    // Two lines take twice the room of one.
    const width = px(card.style.width)
    const size = fitTextSize('첫 줄\n둘째 줄', width, px(card.style.height)).fontSize
    expect(fitTextHeight('첫 줄\n둘째 줄', width, size)).toBe(px(card.style.height))

    // A long text in a tiny box still says so instead of shrinking away.
    const cramped = fitTextSize('여름 특가 최대 50% 할인 무료배송 사은품 증정'.repeat(4), 200, 40)
    expect(cramped.fontSize).toBe(MIN_FONT_PX)
    expect(cramped.overflow).toBe(true)
  })

  it('still edits an existing block on double-click', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(tool('글 넣기'))
    await user.type(screen.getByLabelText('문구 내용'), '처음 문구')
    await user.keyboard('{Control>}{Enter}{/Control}')

    await user.dblClick(cards()[0]!)
    const editor = screen.getByLabelText('문구 내용') as HTMLTextAreaElement
    expect(editor.value).toBe('처음 문구')
  })
})

describe('§5 데이터 불변', () => {
  it('leaves a delivered brief 전달 완료 when it is only opened and selected', async () => {
    const block = createBlock('free_text', {
      id: 'blk_1',
      label: '문구',
      content: '전달한 문구',
      position: { x: 40, y: 40, width: 320, height: 96 },
    })
    const doc = createEmptyDocument(createEmptyBrief('전달한 기획서').project)
    doc.project.id = 'doc_1'
    doc.pages[0]!.blocks = [block]
    const request = createWorkRequest('req_1', doc, '2026-07-20T00:00:00.000Z')

    await saveDocument(doc, 1)
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(cards()).toHaveLength(1))
    await user.click(cards()[0]!)

    expect(briefStatus([request], 'doc_1', doc)).toBe('delivered')
  })
})
