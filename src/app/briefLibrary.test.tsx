/**
 * Focused tests for the 기획서 보관함 and delivery status (§10 items 10–12, 15–17).
 *
 * The status rule is the important part: it is decided by comparing content
 * against the delivered snapshot, so opening or re-saving a brief unchanged
 * must never make it read as edited, and reverting an edit must take it back to
 * 전달 완료.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, resetAssetStoreForTests } from '../services/assetStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import {
  clearAllDocuments,
  createDocument,
  listDocuments,
  loadDocumentById,
  resetDocumentStoreForTests,
} from '../services/documentStore'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createWorkRequest } from '../domain/workRequest'
import { briefStatus, lastDeliveredAt, latestDeliveryOf } from '../domain/briefStatus'
import type { BriefDocument } from '../domain/pageSchema'
import type { WorkRequest } from '../domain/workRequest'

vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

function docWith(title: string, text: string, id?: string): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject(title))
  doc.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_1', label: '문구', content: text })]
  if (id) doc.project.id = id
  return doc
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

const library = () => screen.getByRole('complementary', { name: '내 기획서' })

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
  resetDocumentStoreForTests()
  await clearAllDocuments()
})

describe('§10.10 검색·정렬·불러오기', () => {
  it('lists briefs most recently edited first and filters by title', async () => {
    const older = await createDocument(docWith('여름 기획전', 'A'), 1000)
    const newer = await createDocument(docWith('가을 기획전', 'B'), 2000)

    const user = userEvent.setup()
    renderApp(`/briefs/${older}`)

    const rows = await waitFor(() => {
      const found = within(library()).getAllByRole('button', { name: /기획전/ })
      expect(found.length).toBeGreaterThanOrEqual(2)
      return found
    })
    expect(rows[0]!.textContent).toContain('가을 기획전')

    await user.type(within(library()).getByRole('searchbox', { name: '기획서 제목 검색' }), '여름')
    await waitFor(() => {
      expect(within(library()).queryByText('가을 기획전')).toBeNull()
      expect(within(library()).getByText('여름 기획전')).toBeTruthy()
    })
    expect(newer).not.toBe(older)
  })

  it('opens another brief from the list', async () => {
    const first = await createDocument(docWith('첫 번째 기획서', '첫 번째 문구'), 1000)
    await createDocument(docWith('두 번째 기획서', '두 번째 문구'), 2000)

    const user = userEvent.setup()
    renderApp(`/briefs/${first}`)

    await waitFor(() => expect(screen.getByText('첫 번째 문구')).toBeTruthy())
    await user.click(await within(library()).findByRole('button', { name: /두 번째 기획서/ }))
    await waitFor(() => expect(screen.getByText('두 번째 문구')).toBeTruthy())
  })
})

describe('§10.11–12 전환 직전 저장 · 덮어쓰기 없음', () => {
  it('saves the open brief before switching away from it', async () => {
    const a = await createDocument(docWith('A 기획서', 'A 원본'), 1000)
    const b = await createDocument(docWith('B 기획서', 'B 원본'), 2000)

    const user = userEvent.setup()
    renderApp(`/briefs/${a}`)
    await waitFor(() => expect(screen.getByText('A 원본')).toBeTruthy())

    // Edit A on the canvas, then jump straight to B without waiting for autosave.
    const card = document.querySelector('.block-card') as HTMLElement
    await user.dblClick(card)
    await user.clear(screen.getByLabelText('문구 내용'))
    await user.type(screen.getByLabelText('문구 내용'), 'A 수정본')
    await user.keyboard('{Control>}{Enter}{/Control}')

    await user.click(await within(library()).findByRole('button', { name: /B 기획서/ }))
    await waitFor(() => expect(screen.getByText('B 원본')).toBeTruthy())

    // A kept the edit, and B was not touched by it.
    await waitFor(async () => {
      expect((await loadDocumentById(a))!.pages[0]!.blocks[0]!.content).toBe('A 수정본')
    })
    expect((await loadDocumentById(b))!.pages[0]!.blocks[0]!.content).toBe('B 원본')
  })

  it('keeps briefs apart when several are opened in quick succession', async () => {
    const a = await createDocument(docWith('A 기획서', 'A 원본'), 1000)
    const b = await createDocument(docWith('B 기획서', 'B 원본'), 2000)
    const c = await createDocument(docWith('C 기획서', 'C 원본'), 3000)

    const user = userEvent.setup()
    renderApp(`/briefs/${a}`)
    await waitFor(() => expect(screen.getByText('A 원본')).toBeTruthy())

    await user.click(await within(library()).findByRole('button', { name: /B 기획서/ }))
    await waitFor(() => expect(screen.getByText('B 원본')).toBeTruthy())
    await user.click(await within(library()).findByRole('button', { name: /C 기획서/ }))
    await waitFor(() => expect(screen.getByText('C 원본')).toBeTruthy())
    await user.click(await within(library()).findByRole('button', { name: /A 기획서/ }))
    await waitFor(() => expect(screen.getByText('A 원본')).toBeTruthy())

    // No brief has picked up another's wording.
    expect((await loadDocumentById(a))!.pages[0]!.blocks[0]!.content).toBe('A 원본')
    expect((await loadDocumentById(b))!.pages[0]!.blocks[0]!.content).toBe('B 원본')
    expect((await loadDocumentById(c))!.pages[0]!.blocks[0]!.content).toBe('C 원본')
  })
})

describe('§10.14 복제', () => {
  it('copies a brief into an independent new one from its menu', async () => {
    const source = await createDocument(docWith('원본 기획서', '원본 문구'), 1000)

    const user = userEvent.setup()
    renderApp(`/briefs/${source}`)
    await waitFor(() => expect(screen.getByText('원본 문구')).toBeTruthy())

    await user.click(await within(library()).findByLabelText('원본 기획서 메뉴'))
    await user.click(within(library()).getByRole('button', { name: '복사해서 새 기획서 만들기' }))

    await waitFor(async () => {
      expect(await listDocuments()).toHaveLength(2)
    })
    const all = await listDocuments()
    const copy = all.find((d) => d.id !== source)!
    expect(copy.title).toBe('원본 기획서 복사본')
    expect(copy.id).not.toBe(source)
  })
})

function deliver(doc: BriefDocument, at: string): WorkRequest {
  return createWorkRequest(`req_${at}`, doc, at)
}

describe('§10.15–17 상태 판정 · 전달일 · 제출본 불변', () => {

  it('reads 작성 중 with no delivery, 전달 완료 right after one', () => {
    const doc = docWith('기획서', '문구', 'doc_1')
    expect(briefStatus([], 'doc_1', doc)).toBe('draft')

    const request = deliver(doc, '2026-07-01T00:00:00.000Z')
    expect(briefStatus([request], 'doc_1', doc)).toBe('delivered')
    expect(lastDeliveredAt([request], 'doc_1')).toBe('2026-07-01T00:00:00.000Z')
  })

  it('reads 전달 후 수정 중 once the content differs, and back again when reverted', () => {
    const delivered = docWith('기획서', '원래 문구', 'doc_1')
    const request = deliver(delivered, '2026-07-01T00:00:00.000Z')

    const edited = docWith('기획서', '바뀐 문구', 'doc_1')
    expect(briefStatus([request], 'doc_1', edited)).toBe('editedAfterDelivery')

    // Reverting exactly returns it to 전달 완료.
    const reverted = docWith('기획서', '원래 문구', 'doc_1')
    expect(briefStatus([request], 'doc_1', reverted)).toBe('delivered')
  })

  it('stays 전달 완료 through an unchanged re-save', async () => {
    const doc = docWith('기획서', '문구', 'doc_1')
    const request = deliver(doc, '2026-07-01T00:00:00.000Z')

    const id = await createDocument(doc, 1000)
    const reloaded = await loadDocumentById(id)
    // The stored row carries its own id; compare against a snapshot delivered
    // from that same brief.
    const deliveredFromStored = deliver(reloaded!, '2026-07-02T00:00:00.000Z')
    expect(briefStatus([deliveredFromStored], id, reloaded!)).toBe('delivered')
    expect(request.submittedDoc.pages[0]!.blocks[0]!.content).toBe('문구')
  })

  it('uses the latest delivery and keeps every earlier snapshot immutable', () => {
    const first = docWith('기획서', '1차 문구', 'doc_1')
    const r1 = deliver(first, '2026-07-01T00:00:00.000Z')
    const second = docWith('기획서', '2차 문구', 'doc_1')
    const r2 = deliver(second, '2026-07-05T00:00:00.000Z')

    expect(latestDeliveryOf([r1, r2], 'doc_1')!.submittedAt).toBe('2026-07-05T00:00:00.000Z')
    expect(briefStatus([r1, r2], 'doc_1', second)).toBe('delivered')
    // The first snapshot still holds what was delivered then.
    expect(r1.submittedDoc.pages[0]!.blocks[0]!.content).toBe('1차 문구')
  })

  it('never links a legacy request without a documentId, even with the same title', () => {
    const doc = docWith('같은 제목', '문구', 'doc_1')
    const legacy = createWorkRequest('req_legacy', docWith('같은 제목', '다른 문구'), '2026-06-01T00:00:00.000Z')
    expect(legacy.documentId).toBeUndefined()

    // No delivery is attributed to this brief, so it is still 작성 중.
    expect(briefStatus([legacy], 'doc_1', doc)).toBe('draft')
    expect(lastDeliveredAt([legacy], 'doc_1')).toBeUndefined()
  })

  it('keeps two same-titled briefs apart in the status calculation', () => {
    const a = docWith('여름 기획전', 'A 문구', 'doc_a')
    const b = docWith('여름 기획전', 'B 문구', 'doc_b')
    const deliveredA = deliver(a, '2026-07-01T00:00:00.000Z')

    expect(briefStatus([deliveredA], 'doc_a', a)).toBe('delivered')
    expect(briefStatus([deliveredA], 'doc_b', b)).toBe('draft')
  })
})
