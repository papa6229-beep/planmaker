/**
 * Focused tests for the multi-document repository (§10 items 9, 12, 13, 14).
 *
 * The point is that several briefs can coexist without leaking into each other,
 * that the one-time import of the old single autosave cannot duplicate itself,
 * and that a copy is genuinely independent of its source.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  allDocumentAssetIds,
  clearAllDocuments,
  createDocument,
  duplicateDocument,
  isSingleAutosaveMigrated,
  listDocuments,
  loadDocumentById,
  migrateSingleAutosave,
  resetDocumentStoreForTests,
  saveDocumentById,
} from './documentStore'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import type { BriefDocument } from '../domain/pageSchema'

function docWith(title: string, text: string): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject(title))
  doc.pages[0]!.blocks = [createBlock('free_text', { content: text })]
  return doc
}

beforeEach(async () => {
  resetDocumentStoreForTests()
  await clearAllDocuments()
})

describe('여러 기획서 독립 저장 (§10.9)', () => {
  it('keeps two briefs with the same title apart', async () => {
    const a = await createDocument(docWith('여름 기획전', 'A의 문구'), 1)
    const b = await createDocument(docWith('여름 기획전', 'B의 문구'), 2)
    expect(a).not.toBe(b)

    const loadedA = await loadDocumentById(a)
    const loadedB = await loadDocumentById(b)
    expect(loadedA!.pages[0]!.blocks[0]!.content).toBe('A의 문구')
    expect(loadedB!.pages[0]!.blocks[0]!.content).toBe('B의 문구')
    expect(loadedA!.project.id).toBe(a)
    expect(loadedB!.project.id).toBe(b)
  })

  it('writing one brief never overwrites another', async () => {
    const a = await createDocument(docWith('첫 번째', '원래 A'), 1)
    const b = await createDocument(docWith('두 번째', '원래 B'), 2)

    await saveDocumentById(a, docWith('첫 번째', '수정된 A'), 3)
    expect((await loadDocumentById(a))!.pages[0]!.blocks[0]!.content).toBe('수정된 A')
    expect((await loadDocumentById(b))!.pages[0]!.blocks[0]!.content).toBe('원래 B')
  })

  it('corrects a mismatched project id instead of writing over another brief', async () => {
    const a = await createDocument(docWith('A', 'A 내용'), 1)
    const b = await createDocument(docWith('B', 'B 내용'), 2)

    // A document still carrying A's id is saved under B's row.
    const strayed = await loadDocumentById(a)
    await saveDocumentById(b, strayed!, 3)

    // B now holds that content but under its own id; A is untouched.
    expect((await loadDocumentById(b))!.project.id).toBe(b)
    expect((await loadDocumentById(a))!.pages[0]!.blocks[0]!.content).toBe('A 내용')
  })

  it('lists briefs most recently edited first', async () => {
    const older = await createDocument(docWith('오래된', 'x'), 1000)
    const newer = await createDocument(docWith('최근', 'y'), 2000)
    expect((await listDocuments()).map((d) => d.id)).toEqual([newer, older])

    await saveDocumentById(older, docWith('오래된', 'x2'), 3000)
    expect((await listDocuments()).map((d) => d.id)).toEqual([older, newer])
  })
})

describe('기획서 복제 (§10.14)', () => {
  it('creates an independent copy with a new id and a 복사본 title', async () => {
    const source = await createDocument(docWith('가을 기획전', '원본 문구'), 1)
    const copyId = (await duplicateDocument(source, 2))!

    expect(copyId).not.toBe(source)
    const copy = await loadDocumentById(copyId)
    expect(copy!.project.id).toBe(copyId)
    expect(copy!.project.title).toBe('가을 기획전 복사본')
    expect(copy!.pages[0]!.blocks[0]!.content).toBe('원본 문구')

    // Editing the copy leaves the original alone.
    await saveDocumentById(copyId, docWith('가을 기획전 복사본', '복사본에서 수정'), 3)
    expect((await loadDocumentById(source))!.pages[0]!.blocks[0]!.content).toBe('원본 문구')
  })
})

describe('단일 자동저장 이관 (§10.13)', () => {
  it('imports the legacy brief once and never duplicates it on re-runs', async () => {
    const legacy = docWith('예전 기획서', '예전 문구')
    const load = async () => legacy

    const first = await migrateSingleAutosave(load, 1)
    expect(first).not.toBeNull()
    expect(await isSingleAutosaveMigrated()).toBe(true)
    expect(await listDocuments()).toHaveLength(1)

    // Running it again — a reload, a second tab — must not add another copy.
    expect(await migrateSingleAutosave(load, 2)).toBeNull()
    expect(await migrateSingleAutosave(load, 3)).toBeNull()
    expect(await listDocuments()).toHaveLength(1)

    const imported = await loadDocumentById(first!)
    expect(imported!.project.title).toBe('예전 기획서')
    expect(imported!.pages[0]!.blocks[0]!.content).toBe('예전 문구')
  })

  it('does not import when briefs already exist', async () => {
    await createDocument(docWith('이미 있는 기획서', 'x'), 1)
    expect(await migrateSingleAutosave(async () => docWith('예전', 'y'), 2)).toBeNull()
    expect(await listDocuments()).toHaveLength(1)
  })

  it('retries on the next run when the import write fails', async () => {
    // A loader that throws stands in for a failed read/write; the completion
    // flag must not be set, so the next start tries again.
    await expect(
      migrateSingleAutosave(async () => {
        throw new Error('boom')
      }, 1),
    ).rejects.toThrow()
    expect(await isSingleAutosaveMigrated()).toBe(false)

    const id = await migrateSingleAutosave(async () => docWith('복구된 기획서', 'z'), 2)
    expect(id).not.toBeNull()
    expect(await listDocuments()).toHaveLength(1)
  })

  it('records completion when there is no legacy brief to import', async () => {
    expect(await migrateSingleAutosave(async () => null, 1)).toBeNull()
    expect(await isSingleAutosaveMigrated()).toBe(true)
    expect(await listDocuments()).toHaveLength(0)
  })
})

describe('자산 참조 집계', () => {
  it('reports assets referenced by every stored brief so pruning keeps them', async () => {
    const withImage = createEmptyDocument(createEmptyProject('이미지 기획서'))
    withImage.pages[0]!.blocks = [createBlock('main_product_image', { assetId: 'asset_a' })]
    withImage.pages[0]!.reference = { ...withImage.pages[0]!.reference, assetId: 'asset_ref' }
    await createDocument(withImage, 1)

    const other = createEmptyDocument(createEmptyProject('다른 기획서'))
    other.pages[0]!.blocks = [createBlock('main_product_image', { assetId: 'asset_b' })]
    await createDocument(other, 2)

    expect((await allDocumentAssetIds()).toSorted()).toEqual(['asset_a', 'asset_b', 'asset_ref'])
  })
})
