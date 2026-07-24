import { describe, it, expect } from 'vitest'
import {
  addPage,
  deletePage,
  duplicatePage,
  getActivePage,
  movePage,
  renamePage,
  removeReferenceImage,
  setActivePage,
  setReferenceImage,
  setReferenceOpacity,
  setReferenceViewMode,
} from './pageOps'
import { createEmptyDocument } from './pageSchema'
import { createBlock } from './factory'
import { createEmptyProject } from './factory'
import type { BriefDocument } from './pageSchema'

function docWithBlocksOnPage1(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('t'))
  const a = createBlock('main_headline', { id: 'blk_a', content: 'A', groupId: 'grp_1' })
  const b = createBlock('sub_headline', { id: 'blk_b', content: 'B', groupId: 'grp_1' })
  doc.pages[0]!.blocks = [a, b]
  return doc
}

describe('addPage', () => {
  it('appends a page and makes it active', () => {
    const doc = addPage(createEmptyDocument(createEmptyProject('t')))
    expect(doc.pages).toHaveLength(2)
    expect(doc.activePageId).toBe(doc.pages[1]!.id)
  })
})

describe('duplicatePage', () => {
  it('copies blocks with fresh unique ids and remapped groups', () => {
    const base = docWithBlocksOnPage1()
    const dup = duplicatePage(base, base.pages[0]!.id)
    expect(dup.pages).toHaveLength(2)
    const src = dup.pages[0]!
    const copy = dup.pages[1]!
    expect(dup.activePageId).toBe(copy.id)

    // Block ids differ and are unique across the document.
    const allIds = dup.pages.flatMap((p) => p.blocks.map((bl) => bl.id))
    expect(new Set(allIds).size).toBe(allIds.length)
    expect(copy.blocks.map((bl) => bl.id)).not.toEqual(src.blocks.map((bl) => bl.id))

    // Group relationship preserved but remapped to a new group id.
    const g0 = copy.blocks[0]!.groupId
    expect(g0).toBeDefined()
    expect(copy.blocks[1]!.groupId).toBe(g0)
    expect(g0).not.toBe('grp_1')

    // Content preserved.
    expect(copy.blocks[0]!.content).toBe('A')
  })
})

describe('deletePage', () => {
  it('cannot delete the last page', () => {
    const doc = createEmptyDocument(createEmptyProject('t'))
    expect(deletePage(doc, doc.pages[0]!.id)).toBe(doc)
  })

  it('removes a page and keeps activePageId valid', () => {
    let doc = addPage(createEmptyDocument(createEmptyProject('t'))) // 2 pages, active = page2
    const active = doc.activePageId
    doc = deletePage(doc, active)
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages.some((p) => p.id === doc.activePageId)).toBe(true)
    expect(doc.activePageId).not.toBe(active)
  })
})

describe('movePage / renamePage / setActivePage', () => {
  it('reorders pages within bounds', () => {
    let doc = addPage(createEmptyDocument(createEmptyProject('t')))
    const [p1, p2] = doc.pages
    doc = movePage(doc, p2!.id, -1)
    expect(doc.pages.map((p) => p.id)).toEqual([p2!.id, p1!.id])
    // Out of bounds is a no-op.
    expect(movePage(doc, p2!.id, -1).pages.map((p) => p.id)).toEqual([p2!.id, p1!.id])
  })

  it('renames and re-activates', () => {
    let doc = createEmptyDocument(createEmptyProject('t'))
    doc = renamePage(doc, doc.pages[0]!.id, '표지')
    expect(getActivePage(doc).title).toBe('표지')
    doc = addPage(doc)
    doc = setActivePage(doc, doc.pages[0]!.id)
    expect(doc.activePageId).toBe(doc.pages[0]!.id)
  })
})

describe('reference layer per page', () => {
  it('sets/clears a reference image and view settings independently per page', () => {
    let doc = addPage(docWithBlocksOnPage1()) // page1 has blocks; page2 empty
    const [p1, p2] = doc.pages

    doc = setReferenceImage(doc, p1!.id, 'asset_ref1')
    doc = setReferenceViewMode(doc, p1!.id, 'overlay')
    doc = setReferenceOpacity(doc, p1!.id, 0.7)

    // page2 untouched.
    expect(doc.pages[0]!.reference.assetId).toBe('asset_ref1')
    expect(doc.pages[0]!.reference.viewMode).toBe('overlay')
    expect(doc.pages[0]!.reference.opacity).toBe(0.7)
    expect(doc.pages[1]!.reference.assetId).toBeUndefined()

    // Clearing only page1.
    doc = removeReferenceImage(doc, p1!.id)
    expect(doc.pages[0]!.reference.assetId).toBeUndefined()
    expect(p2!.reference.assetId).toBeUndefined()
  })

  it('clamps opacity to 0..1', () => {
    let doc = createEmptyDocument(createEmptyProject('t'))
    const id = doc.pages[0]!.id
    expect(setReferenceOpacity(doc, id, 5).pages[0]!.reference.opacity).toBe(1)
    expect(setReferenceOpacity(doc, id, -2).pages[0]!.reference.opacity).toBe(0)
  })
})
