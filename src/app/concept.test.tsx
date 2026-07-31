/**
 * Focused tests for 전체 컨셉 (§10.8) and the content fingerprint the delivery
 * status is decided by (판정 §2).
 *
 * 전체 컨셉 is document-wide direction, not a block on the canvas, and it must
 * reach the AI as a non-printing instruction — never as copy to render.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
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
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { buildDesignSummary, buildPublishingInfo } from '../domain/summaryBuilder'
import { pageAsEventBrief } from '../domain/briefMigration'
import { documentFingerprint, sameDocumentContent } from '../domain/documentFingerprint'
import { packageEventDocument } from '../services/eventBriefExport'
import { readEventDocument } from '../services/eventBriefImport'
import { createWorkRequest } from '../domain/workRequest'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

function docWith(title: string, text: string): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject(title))
  doc.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_1', content: text })]
  return doc
}

function summarize(doc: BriefDocument) {
  const page = doc.pages[0]!
  const brief = pageAsEventBrief(doc, page)
  return { design: buildDesignSummary(brief, { pageId: page.id }), publishing: buildPublishingInfo(brief) }
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
  resetDocumentStoreForTests()
  await clearAllDocuments()
})

describe('§10.8 전체 컨셉', () => {
  it('is entered above the canvas, not as a block, and survives a save/reload', async () => {
    const id = await createDocument(docWith('여름 기획전', '여름 세일'), 1)
    const binding = {
      load: () => loadDocumentById(id),
      save: (doc: BriefDocument) => saveDocumentById(id, doc, Date.now()),
    }
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/briefs/x']}>
        <RequestsProvider>
            <DocumentsProvider>
            <AppShell binding={binding} />
          </DocumentsProvider>
        </RequestsProvider>
      </MemoryRouter>,
    )

    const concept = await screen.findByRole('region', { name: '전체 컨셉' })
    await user.click(within(concept).getByRole('button'))
    await user.type(document.getElementById('concept-input') as HTMLTextAreaElement, '여름 바다처럼 시원하고 밝게')

    // It never becomes a canvas block.
    const canvas = screen.getByRole('region', { name: '기획 캔버스' })
    expect(canvas.querySelectorAll('.block-card')).toHaveLength(1)

    await waitFor(async () => {
      const saved = await loadDocumentById(id)
      expect(saved!.project.concept).toBe('여름 바다처럼 시원하고 밝게')
    }, { timeout: 5000 })
  })

  it('shows up in the AI 요약 as soon as it is typed, without a reload', async () => {
    const id = await createDocument(docWith('여름 기획전', '여름 세일'), 1)
    const binding = {
      load: () => loadDocumentById(id),
      save: (doc: BriefDocument) => saveDocumentById(id, doc, Date.now()),
    }
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/briefs/x']}>
        <RequestsProvider>
          <DocumentsProvider>
            <AppShell binding={binding} />
          </DocumentsProvider>
        </RequestsProvider>
      </MemoryRouter>,
    )

    const region = await screen.findByRole('region', { name: '전체 컨셉' })
    await user.click(within(region).getByRole('button'))
    await user.type(document.getElementById('concept-input') as HTMLTextAreaElement, '시원하고 밝게')

    await user.click(screen.getByRole('button', { name: 'AI 요약' }))
    const dialog = screen.getByRole('dialog', { name: 'AI 요약 미리보기' })
    const instructions = within(dialog).getByLabelText('요청 메모')
    expect(instructions.textContent).toContain('시원하고 밝게')
    expect(instructions.textContent).toContain('인쇄하지 않음')
    // And it is still not copy to print.
    expect(within(dialog).getByLabelText('그대로 넣을 문구').textContent).not.toContain('시원하고 밝게')
  })

  it('reaches the AI as a document-wide, non-printing instruction', () => {
    const doc = docWith('여름 기획전', '여름 세일')
    doc.project.concept = '여름 바다처럼 시원하고 밝게'

    const { design, publishing } = summarize(doc)
    const concept = design.instructions.find((i) => i.scope === 'document')
    expect(concept).toBeDefined()
    expect(concept!.content).toBe('여름 바다처럼 시원하고 밝게')
    expect(concept!.renderAsText).toBe(false)
    expect(concept!.blockId).toBeUndefined()
    expect(concept!.geometry).toBeUndefined()

    // Not copy to print, and not publishing information.
    expect(design.texts.some((t) => t.content.includes('시원하고 밝게'))).toBe(false)
    expect(JSON.stringify(publishing)).not.toContain('시원하고 밝게')
  })

  it('is preserved through an .eventbrief round-trip and a delivery snapshot', async () => {
    const doc = docWith('여름 기획전', '여름 세일')
    doc.project.concept = '고급스럽되 무겁지 않게'

    const pkg = await packageEventDocument({ doc, assets: [], previews: [], createdAt: 't' })
    const reopened = (await readEventDocument(pkg.blob)).doc
    expect(reopened.project.concept).toBe('고급스럽되 무겁지 않게')

    const request = createWorkRequest('req_1', doc, '2026-07-30T00:00:00.000Z')
    expect(request.submittedDoc.project.concept).toBe('고급스럽되 무겁지 않게')
  })

  it('leaves an existing revision_reference block alone', () => {
    const doc = docWith('과거 문서', '문구')
    doc.pages[0]!.blocks.push(
      createBlock('revision_reference', { id: 'blk_note', content: '기존 요청 메모' }),
    )
    doc.project.concept = '새 전체 컨셉'

    const { design } = summarize(doc)
    // Both are instructions, distinguished by scope; neither rewrites the other.
    expect(design.instructions.map((i) => i.scope)).toEqual(['document', 'block'])
    expect(doc.pages[0]!.blocks[1]!.type).toBe('revision_reference')
    expect(doc.pages[0]!.blocks[1]!.content).toBe('기존 요청 메모')
  })
})

describe('판정 §2 — 내용 기반 비교', () => {
  it('treats an untouched brief as unchanged even after re-saving it', async () => {
    const doc = docWith('기획서', '문구')
    const id = await createDocument(doc, 1000)

    const first = await loadDocumentById(id)
    await saveDocumentById(id, first!, 9999) // a no-op autosave, much later
    const second = await loadDocumentById(id)

    // The row's updatedAt moved, but the work did not.
    expect(sameDocumentContent(first!, second!)).toBe(true)
  })

  it('notices a change to wording, position, size, link, or concept', () => {
    const base = docWith('기획서', '문구')
    const fingerprint = documentFingerprint(base)

    const reworded = docWith('기획서', '다른 문구')
    expect(documentFingerprint(reworded)).not.toBe(fingerprint)

    const moved = docWith('기획서', '문구')
    moved.pages[0]!.blocks[0]!.position = { ...moved.pages[0]!.blocks[0]!.position, x: 500 }
    expect(documentFingerprint(moved)).not.toBe(fingerprint)

    const resized = docWith('기획서', '문구')
    resized.pages[0]!.blocks[0]!.position = { ...resized.pages[0]!.blocks[0]!.position, width: 700 }
    expect(documentFingerprint(resized)).not.toBe(fingerprint)

    const linked = docWith('기획서', '문구')
    linked.pages[0]!.blocks.push(createBlock('button_url', { id: 'blk_url', content: 'https://a.example' }))
    expect(documentFingerprint(linked)).not.toBe(fingerprint)

    const concepted = docWith('기획서', '문구')
    concepted.project.concept = '시원하게'
    expect(documentFingerprint(concepted)).not.toBe(fingerprint)
  })

  it('ignores the emphasis hint the editor derives from wording and size', () => {
    const delivered = docWith('기획서', '문구')
    const edited = docWith('기획서', '문구')
    // Editing writes the derived hint; the words and the box are unchanged.
    edited.pages[0]!.blocks[0]!.layoutHint = { emphasis: 'high' }
    expect(sameDocumentContent(delivered, edited)).toBe(true)

    // A real size change is still a change.
    const bigger = docWith('기획서', '문구')
    bigger.pages[0]!.blocks[0]!.position = { ...bigger.pages[0]!.blocks[0]!.position, height: 400 }
    expect(sameDocumentContent(delivered, bigger)).toBe(false)
  })

  it('ignores which page is on screen and how the reference is being viewed', () => {
    const a = docWith('기획서', '문구')
    const b = docWith('기획서', '문구')

    b.activePageId = 'some-other-page'
    b.pages[0]!.reference = { ...b.pages[0]!.reference, viewMode: 'overlay', visible: true, opacity: 0.7 }

    expect(sameDocumentContent(a, b)).toBe(true)
  })

  it('treats a copy as a different brief even with identical content', async () => {
    const source = await createDocument(docWith('기획서', '문구'), 1)
    const original = await loadDocumentById(source)
    const copyDoc = { ...original!, project: { ...original!.project, id: 'doc_copy' } }
    expect(sameDocumentContent(original!, copyDoc)).toBe(false)
  })

  it('returns to unchanged when an edit is reverted exactly', () => {
    const delivered = docWith('기획서', '원래 문구')
    const edited = docWith('기획서', '바뀐 문구')
    expect(sameDocumentContent(delivered, edited)).toBe(false)

    const revertedBack = docWith('기획서', '원래 문구')
    expect(sameDocumentContent(delivered, revertedBack)).toBe(true)
  })
})
