/**
 * Phase 7 Step 6 — edit UX simplification (WORK_PLAN §10–§12). Covers the
 * required tests: 행사정보 blocks hidden from the new palette but still rendered
 * from files; importance / AI-visibility / layout-hint controls removed from the
 * right panel; in-canvas inline text editing; drag disabled while editing; and
 * an inline edit collapsing into one undo step. Plus palette search and the
 * separate 퍼블리싱 정보 section.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { clearAll, resetAssetStoreForTests, saveDocument } from '../services/assetStore'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyBrief } from '../domain/factory'

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <RequestsProvider>
        <AppShell />
      </RequestsProvider>
    </MemoryRouter>,
  )
}

const palette = () => screen.getByRole('complementary', { name: '블록 팔레트' })
const canvas = () => screen.getByRole('region', { name: '기획 캔버스' })
const inspector = () => screen.getByRole('complementary', { name: '선택 블록 설정' })

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
})

describe('palette simplification (1차 단순화 §2.2)', () => {
  it('offers exactly the four authoring tools and nothing else', () => {
    renderShell()
    const tools = within(screen.getByRole('list', { name: '기본 블록' })).getAllByRole('button')
    expect(tools.map((b) => b.querySelector('.simple-tool__label')?.textContent)).toEqual([
      '글 넣기',
      '이미지 자리',
      '버튼·링크',
      '요청 메모',
    ])
    expect(tools).toHaveLength(4)
  })

  it('no longer lists the granular typed blocks or a publishing section', () => {
    renderShell()
    for (const label of ['혜택', '구매 조건', '사은품', '메인 문구', 'CTA 버튼', '버튼 연결 URL']) {
      expect(within(palette()).queryByRole('button', { name: label })).toBeNull()
    }
    expect(screen.queryByRole('region', { name: '퍼블리싱 정보' })).toBeNull()
  })

  it('renders an existing 행사정보 block loaded from a file', async () => {
    const benefit = createBlock('benefit', { id: 'blk_b', content: '1+1 혜택', position: { x: 40, y: 40, width: 300, height: 90 } })
    const doc = createEmptyDocument(createEmptyBrief('테스트').project)
    doc.pages[0]!.blocks = [benefit]
    await saveDocument(doc, 1)

    renderShell()
    await waitFor(() => {
      expect(within(canvas()).getByRole('button', { name: /혜택/ })).toBeTruthy()
    })
  })
})

describe('right panel simplification (§11)', () => {
  it('does not expose importance, AI-visibility, layout-hint, or a delete button', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(within(palette()).getByRole('button', { name: '글 넣기' }))

    const insp = inspector()
    expect(within(insp).queryByText('중요도')).toBeNull()
    expect(within(insp).queryByText('AI 전달 여부')).toBeNull()
    expect(within(insp).queryByText('위치 힌트 (소프트)')).toBeNull()
    expect(within(insp).queryByRole('button', { name: '블록 삭제' })).toBeNull()
    // 글 넣기 asks for the wording and how strongly to emphasise it — nothing else.
    expect(within(insp).getByLabelText('문구')).toBeTruthy()
    expect(within(insp).getByRole('radiogroup', { name: '강조 정도' })).toBeTruthy()
  })
})

describe('inline text editing (§12)', () => {
  it('edits a text block directly on the canvas', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(within(palette()).getByRole('button', { name: '글 넣기' }))

    const card = within(canvas()).getByRole('button', { name: /문구/ })
    await user.dblClick(card)
    const editor = screen.getByLabelText('문구 내용')
    await user.type(editor, '여름 세일 시작')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(within(canvas()).getByRole('button', { name: /여름 세일 시작/ })).toBeTruthy()
  })

  it('disables dragging while inline-editing', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    await user.click(within(palette()).getByRole('button', { name: '글 넣기' }))

    const card = container.querySelector('.block-card') as HTMLElement
    const left0 = card.style.left
    await user.dblClick(card)

    // Attempt a drag on the card: startDrag must no-op while editing.
    fireEvent.pointerDown(card, { button: 0, clientX: 60, clientY: 60 })
    fireEvent.pointerMove(window, { clientX: 240, clientY: 240 })
    fireEvent.pointerUp(window)
    expect(card.style.left).toBe(left0)
  })

  it('collapses an inline edit into a single undo step', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(within(palette()).getByRole('button', { name: '글 넣기' }))

    const card = within(canvas()).getByRole('button', { name: /문구/ })
    await user.dblClick(card)
    await user.type(screen.getByLabelText('문구 내용'), '한 번에 병합')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(within(canvas()).getByRole('button', { name: /한 번에 병합/ })).toBeTruthy()

    // One undo reverts the whole edit; the block itself remains.
    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    expect(within(canvas()).queryByRole('button', { name: /한 번에 병합/ })).toBeNull()
    expect(within(canvas()).getByRole('button', { name: /문구/ })).toBeTruthy()
  })
})
