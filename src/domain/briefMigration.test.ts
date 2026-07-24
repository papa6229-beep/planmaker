import { describe, it, expect } from 'vitest'
import {
  briefToDocument,
  deserializeDocument,
  isBriefDocument,
  isSinglePageBrief,
  migrateToDocument,
  pageAsEventBrief,
  serializeDocument,
} from './briefMigration'
import { addPage, setReferenceImage } from './pageOps'
import { createEmptyDocument } from './pageSchema'
import { createBlock, createEmptyBrief, createEmptyProject } from './factory'
import { validateBrief } from './validation'
import type { EventBrief } from './briefSchema'
import type { BriefDocument } from './pageSchema'

function v1Brief(): EventBrief {
  const headline = createBlock('main_headline', { id: 'blk_h', content: '헤드라인', required: true, position: { x: 10, y: 20, width: 300, height: 90 } })
  const img = createBlock('main_product_image', { id: 'blk_i', assetId: 'asset_1', groupId: 'grp_x', position: { x: 40, y: 160, width: 300, height: 300 } })
  return {
    ...createEmptyBrief('8월 무료체험단'),
    blocks: [headline, img],
    assets: [{ id: 'asset_1', fileName: 'p.png', mimeType: 'image/png', byteSize: 4 }],
  }
}

describe('detection', () => {
  it('distinguishes single-page brief from document', () => {
    expect(isSinglePageBrief(v1Brief())).toBe(true)
    expect(isBriefDocument(v1Brief())).toBe(false)
    const doc = createEmptyDocument(createEmptyProject('t'))
    expect(isBriefDocument(doc)).toBe(true)
    expect(isSinglePageBrief(doc)).toBe(false)
  })
})

describe('v1 → document migration', () => {
  it('wraps blocks into pages[0], preserving ids, coordinates, groups and assets', () => {
    const brief = v1Brief()
    const doc = briefToDocument(brief)
    expect(doc.schemaVersion).toBe('2.0.0')
    expect(doc.pages).toHaveLength(1)
    const page = doc.pages[0]!
    expect(doc.activePageId).toBe(page.id)

    // Exact block preservation.
    expect(page.blocks.map((b) => b.id)).toEqual(['blk_h', 'blk_i'])
    expect(page.blocks[0]!.position).toEqual({ x: 10, y: 20, width: 300, height: 90 })
    expect(page.blocks[1]!.groupId).toBe('grp_x')
    expect(page.blocks[1]!.assetId).toBe('asset_1')

    // Assets carried at document level; canvas width fixed 840.
    expect(doc.assets).toEqual(brief.assets)
    expect(page.canvasWidth).toBe(840)
  })

  it('migrateToDocument routes both shapes', () => {
    expect(migrateToDocument(v1Brief()).pages).toHaveLength(1)
    const doc = addPage(createEmptyDocument(createEmptyProject('t')))
    expect(migrateToDocument(doc).pages).toHaveLength(2)
  })

  it('throws on unsupported shapes', () => {
    expect(() => migrateToDocument({ foo: 'bar' })).toThrow()
  })
})

function twoPageDoc(): BriefDocument {
  let doc = createEmptyDocument(createEmptyProject('멀티'))
  doc.pages[0]!.blocks = [createBlock('main_headline', { id: 'p1_a', content: '1페이지' })]
  doc = addPage(doc, '2페이지')
  doc.pages[1]!.blocks = [createBlock('body_text', { id: 'p2_a', content: '2페이지' })]
  doc = setReferenceImage(doc, doc.pages[1]!.id, 'asset_ref')
  doc.assets = [{ id: 'asset_ref', fileName: 'ref.png', mimeType: 'image/png', byteSize: 3 }]
  return doc
}

describe('multi-page round-trip', () => {
  it('serializes and deserializes to an identical document', () => {
    const doc = twoPageDoc()
    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored).toEqual(doc)
  })

  it('keeps blocks and reference assets independent per page', () => {
    const doc = twoPageDoc()
    expect(doc.pages[0]!.blocks.map((b) => b.id)).toEqual(['p1_a'])
    expect(doc.pages[1]!.blocks.map((b) => b.id)).toEqual(['p2_a'])
    expect(doc.pages[0]!.reference.assetId).toBeUndefined()
    expect(doc.pages[1]!.reference.assetId).toBe('asset_ref')
  })

  it('never stores a zoom value in the serialized document (view-state only)', () => {
    const json = serializeDocument(twoPageDoc())
    expect(json).not.toContain('zoom')
  })
})

describe('pageAsEventBrief projection', () => {
  it('projects a page to the legacy EventBrief so existing validation runs per page', () => {
    const doc = briefToDocument(v1Brief())
    const projected = pageAsEventBrief(doc, doc.pages[0]!)
    expect(projected.blocks).toBe(doc.pages[0]!.blocks)
    expect(projected.assets).toBe(doc.assets)
    expect(projected.project.canvasWidth).toBe(840)
    // The projected page validates with the unchanged Phase 1 rules.
    expect(validateBrief(projected).ok).toBe(true)
  })
})
