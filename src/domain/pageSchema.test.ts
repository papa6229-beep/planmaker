import { describe, it, expect } from 'vitest'
import {
  createEmptyDocument,
  createPage,
  createReferenceLayer,
  DEFAULT_REFERENCE_OPACITY,
  DOCUMENT_SCHEMA_VERSION,
  PAGE_CANVAS_WIDTH,
} from './pageSchema'
import { createEmptyProject } from './factory'

describe('createReferenceLayer', () => {
  it('uses the documented defaults (overlay off, 35%, fit width)', () => {
    expect(createReferenceLayer()).toEqual({
      viewMode: 'canvas',
      opacity: DEFAULT_REFERENCE_OPACITY,
      fit: 'width',
      visible: false,
    })
    expect(DEFAULT_REFERENCE_OPACITY).toBe(0.35)
  })
})

describe('createPage', () => {
  it('defaults to a fixed 840px canvas with an empty reference layer', () => {
    const page = createPage()
    expect(page.canvasWidth).toBe(PAGE_CANVAS_WIDTH)
    expect(PAGE_CANVAS_WIDTH).toBe(840)
    expect(page.blocks).toEqual([])
    expect(page.reference.assetId).toBeUndefined()
    expect(page.id.length).toBeGreaterThan(0)
  })
})

describe('createEmptyDocument', () => {
  it('creates a single-page v2 document with a valid active page', () => {
    const doc = createEmptyDocument(createEmptyProject('테스트'))
    expect(doc.schemaVersion).toBe(DOCUMENT_SCHEMA_VERSION)
    expect(DOCUMENT_SCHEMA_VERSION).toBe('2.0.0')
    expect(doc.pages).toHaveLength(1)
    expect(doc.activePageId).toBe(doc.pages[0]!.id)
    expect(doc.assets).toEqual([])
  })
})
