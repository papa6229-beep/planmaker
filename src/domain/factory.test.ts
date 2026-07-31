import { describe, it, expect } from 'vitest'
import { createBlock, createEmptyBrief, createId } from './factory'
import { NEW_PAGE_HEIGHT, DEFAULT_CANVAS_WIDTH, SCHEMA_VERSION } from './briefSchema'

describe('createId', () => {
  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createId()))
    expect(ids.size).toBe(100)
  })

  it('applies the given prefix', () => {
    expect(createId('asset').startsWith('asset_')).toBe(true)
  })
})

describe('createBlock', () => {
  it('applies the block type default label and visibility', () => {
    const block = createBlock('main_headline')
    expect(block.label).toBe('메인 문구')
    expect(block.aiVisibility).toBe('design')
    expect(block.required).toBe(false)
    expect(block.priority).toBe(3)
  })

  it('attaches image metadata to image blocks and disallows transform on existing full images', () => {
    const product = createBlock('main_product_image')
    expect(product.image).toEqual({ allowTransform: true })

    const existing = createBlock('existing_full_image')
    expect(existing.image).toEqual({ allowTransform: false })

    const text = createBlock('body_text')
    expect(text.image).toBeUndefined()
  })

  it('omits optional fields when not provided (exactOptionalPropertyTypes-safe)', () => {
    const block = createBlock('body_text')
    expect('content' in block).toBe(false)
    expect('assetId' in block).toBe(false)
    expect('groupId' in block).toBe(false)
  })

  it('honors overrides', () => {
    const block = createBlock('sub_headline', {
      id: 'blk_x',
      content: '한정 수량',
      required: true,
      priority: 1,
      position: { x: 10, y: 20 },
      groupId: 'grp_1',
    })
    expect(block.id).toBe('blk_x')
    expect(block.content).toBe('한정 수량')
    expect(block.required).toBe(true)
    expect(block.priority).toBe(1)
    expect(block.position).toEqual({ x: 10, y: 20, width: 300, height: 100 })
    expect(block.groupId).toBe('grp_1')
  })
})

describe('createEmptyBrief', () => {
  it('creates a valid empty shell', () => {
    const brief = createEmptyBrief('테스트')
    expect(brief.schemaVersion).toBe(SCHEMA_VERSION)
    expect(brief.project.title).toBe('테스트')
    expect(brief.project.canvasWidth).toBe(DEFAULT_CANVAS_WIDTH)
    // A new brief is one page long at the new-page length; DEFAULT_CANVAS_HEIGHT
    // is what a v1 document is migrated with.
    expect(brief.project.canvasHeight).toBe(NEW_PAGE_HEIGHT)
    expect(brief.blocks).toEqual([])
    expect(brief.assets).toEqual([])
  })
})
