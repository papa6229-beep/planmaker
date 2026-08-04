/**
 * 두 종류의 메모 (첫 사용 흐름 §6, §11 메모).
 *
 * 컨셉은 "어떤 느낌인가"이고, 이 둘은 "사람에게 부탁하는 말"과 "AI에게 부탁하는
 * 말"이다. 셋은 서로 다른 값이며, 어느 것도 이미지에 인쇄될 문구가 아니다.
 *
 *  - 디자인팀에게 전달할 말 — 기획서를 쓴 사람이 남긴다. 파일을 따라 디자인팀
 *    작업판까지 원문 그대로 도착해야 한다.
 *  - AI에게 추가로 전달할 말 — 작업판에서 작업자가 남긴다. 작성자의 메모를
 *    덮어쓰지 않고, 제작 요청에는 별도의 지시로 실린다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { AppSurfaceProvider } from './AppSurfaceContext'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { clearAll, resetAssetStoreForTests } from '../services/assetStore'
import {
  clearAllDocuments,
  createDocument,
  loadDocumentById,
  resetDocumentStoreForTests,
  saveDocumentById,
  duplicateDocument,
} from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { buildDesignSummary } from '../domain/summaryBuilder'
import { documentFingerprint } from '../domain/documentFingerprint'
import { pageAsEventBrief } from '../domain/briefMigration'
import { packageEventDocument } from '../services/eventBriefExport'
import { readEventDocument } from '../services/eventBriefImport'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

const DESIGNER_NOTE = '이 문구는 반드시 강조해 주세요.'
const AI_NOTE = '하단에는 그라데이션을 꼭 넣어 주세요.'

function docWithNote(): BriefDocument {
  const project = createEmptyProject('메모 시험')
  project.concept = '단정하게'
  project.designerNote = DESIGNER_NOTE
  const doc = createEmptyDocument(project)
  doc.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_text', content: '가을 신상 예약판매' })]
  return doc
}

async function briefFile(doc: BriefDocument): Promise<File> {
  const pkg = await packageEventDocument({
    doc,
    assets: [],
    previews: doc.pages.map(() => new Blob([new Uint8Array([1])], { type: 'image/png' })),
    createdAt: new Date(0).toISOString(),
  })
  return new File([pkg.blob], 'note.eventbrief', { type: 'application/zip' })
}

beforeEach(async () => {
  resetAssetStoreForTests()
  resetDocumentStoreForTests()
  resetRequestStoreForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
})

describe('§6-1 디자인팀에게 전달할 말', () => {
  it('autosaves, survives a duplicate, and rides the .eventbrief onward', async () => {
    const id = await createDocument(createEmptyDocument(createEmptyProject('메모 시험')), 1)
    render(
      <MemoryRouter initialEntries={[`/briefs/${id}`]}>
        <AppSurfaceProvider surface="brief-writer">
          <DocumentsProvider>
            <AppShell binding={{ load: () => loadDocumentById(id), save: (d) => saveDocumentById(id, d, Date.now()) }} />
          </DocumentsProvider>
        </AppSurfaceProvider>
      </MemoryRouter>,
    )
    // 저장된 기획서가 실제로 열린 뒤에 적는다. 복원이 끝나기 전에 적으면 복원이
    // 그 위를 덮으므로, 검사가 사람보다 빨라서 나는 실패다.
    await waitFor(() => {
      expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('메모 시험')
    }, { timeout: 5000 })
    const field = await screen.findByLabelText('디자인팀에게 전달할 말')
    fireEvent.change(field, { target: { value: DESIGNER_NOTE } })

    await waitFor(async () => {
      expect((await loadDocumentById(id))?.project.designerNote).toBe(DESIGNER_NOTE)
    }, { timeout: 6000 })

    // 복제본도 그대로 가져간다.
    const copyId = await duplicateDocument(id, 2)
    expect((await loadDocumentById(copyId!))?.project.designerNote).toBe(DESIGNER_NOTE)

    // 파일 왕복에서도 원문 그대로.
    const roundTripped = await readEventDocument(await briefFile(docWithNote()))
    expect(roundTripped.doc.project.designerNote).toBe(DESIGNER_NOTE)
    // 자동저장 대기(3초)가 포함된 검사라 기본 5초 제한으로는 부족하다.
  }, 20000)

  it('loads an older file with no note as an empty one', async () => {
    const older = createEmptyDocument(createEmptyProject('구자료'))
    const imported = await readEventDocument(await briefFile(older))
    expect(imported.doc.project.designerNote).toBeUndefined()
    expect(imported.doc.project.title).toBe('구자료')
  })

  it('is guidance, never wording to print', () => {
    const doc = docWithNote()
    const summary = buildDesignSummary(pageAsEventBrief(doc, doc.pages[0]!))
    expect(summary.texts.some((t) => t.content.includes('강조해 주세요'))).toBe(false)
    const note = summary.instructions.find((i) => i.label === '디자인팀에게 전달할 말')
    expect(note?.content).toBe(DESIGNER_NOTE)
    expect(note?.renderAsText).toBe(false)
  })
})

describe('§6-2 작성기에는 AI 메모 자리가 없다', () => {
  it('offers only the design-team note, never an AI one', async () => {
    const id = await createDocument(createEmptyDocument(createEmptyProject('작성기')), 1)
    render(
      <MemoryRouter initialEntries={[`/briefs/${id}`]}>
        <AppSurfaceProvider surface="brief-writer">
          <DocumentsProvider>
            <AppShell binding={{ load: () => loadDocumentById(id), save: async () => {} }} />
          </DocumentsProvider>
        </AppSurfaceProvider>
      </MemoryRouter>,
    )
    await screen.findByLabelText('디자인팀에게 전달할 말')
    expect(screen.queryByLabelText('AI에게 추가로 전달할 말')).toBeNull()
  })

  it('does not make the writer brief look edited, while the writer note does', () => {
    const base = docWithNote()
    const withAi: BriefDocument = { ...base, project: { ...base.project, aiNote: AI_NOTE } }
    const withOtherNote: BriefDocument = { ...base, project: { ...base.project, designerNote: '다른 부탁' } }

    // 작업자의 AI 지시는 기획서 원본의 내용이 아니다.
    expect(documentFingerprint(withAi)).toBe(documentFingerprint(base))
    // 작성자의 전달 메모는 기획서의 내용이다.
    expect(documentFingerprint(withOtherNote)).not.toBe(documentFingerprint(base))
  })
})
