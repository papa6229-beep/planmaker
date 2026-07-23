import { describe, it, expect } from 'vitest'
import { validateBrief } from './validation'
import { createBlock, createEmptyBrief } from './factory'
import type { EventBrief } from './briefSchema'
import { sampleDiscountBrief } from '../fixtures/sampleBrief'

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code)
}

describe('validateBrief — errors', () => {
  it('flags a missing project title and zero design blocks on an empty brief', () => {
    const result = validateBrief(createEmptyBrief())
    expect(result.ok).toBe(false)
    expect(codes(result.errors)).toContain('PROJECT_TITLE_MISSING')
    expect(codes(result.errors)).toContain('NO_DESIGN_BLOCK')
  })

  it('flags a required text block with no content', () => {
    const brief: EventBrief = {
      ...createEmptyBrief('행사'),
      blocks: [createBlock('main_headline', { required: true })],
    }
    expect(codes(validateBrief(brief).errors)).toContain('REQUIRED_CONTENT_MISSING')
  })

  it('flags a required image block with no asset', () => {
    const brief: EventBrief = {
      ...createEmptyBrief('행사'),
      blocks: [createBlock('main_product_image', { required: true })],
    }
    expect(codes(validateBrief(brief).errors)).toContain('IMAGE_ASSET_MISSING')
  })

  it('flags duplicate block ids', () => {
    const brief: EventBrief = {
      ...createEmptyBrief('행사'),
      blocks: [
        createBlock('main_headline', { id: 'dup', content: 'A' }),
        createBlock('sub_headline', { id: 'dup', content: 'B' }),
      ],
    }
    expect(codes(validateBrief(brief).errors)).toContain('DUPLICATE_BLOCK_ID')
  })

  it('flags a block referencing a missing asset', () => {
    const brief: EventBrief = {
      ...createEmptyBrief('행사'),
      blocks: [createBlock('main_product_image', { content: 'x', assetId: 'ghost' })],
    }
    expect(codes(validateBrief(brief).errors)).toContain('ASSET_REFERENCE_MISSING')
  })
})

describe('validateBrief — warnings', () => {
  it('warns when there is no main headline and no required product', () => {
    const brief: EventBrief = {
      ...createEmptyBrief('행사'),
      blocks: [createBlock('body_text', { content: '내용' })],
    }
    const result = validateBrief(brief)
    expect(codes(result.warnings)).toContain('NO_MAIN_HEADLINE')
    expect(codes(result.warnings)).toContain('NO_REQUIRED_PRODUCT')
  })

  it('warns when a reference block is placed in the design area', () => {
    const brief: EventBrief = {
      ...createEmptyBrief('행사'),
      blocks: [
        createBlock('main_headline', { content: 'H' }),
        createBlock('button_url', { content: 'https://x', required: false }),
      ],
    }
    // Force the publishing block onto the design surface.
    brief.blocks[1]!.aiVisibility = 'design'
    expect(codes(validateBrief(brief).warnings)).toContain('LINK_IN_DESIGN_AREA')
  })

  it('warns when an existing full image allows transform', () => {
    const brief: EventBrief = {
      ...createEmptyBrief('행사'),
      blocks: [createBlock('existing_full_image', { content: 'x', assetId: 'a' })],
      assets: [{ id: 'a', fileName: 'a.png', mimeType: 'image/png' }],
    }
    brief.blocks[0]!.image = { allowTransform: true }
    expect(codes(validateBrief(brief).warnings)).toContain('EXISTING_IMAGE_TRANSFORM_ON')
  })

  it('warns about a block outside the canvas', () => {
    const brief: EventBrief = {
      ...createEmptyBrief('행사'),
      blocks: [
        createBlock('main_headline', {
          content: 'H',
          position: { x: 800, y: 3000, width: 400, height: 200 },
        }),
      ],
    }
    expect(codes(validateBrief(brief).warnings)).toContain('BLOCK_OUTSIDE_CANVAS')
  })
})

describe('validateBrief — sample fixture', () => {
  it('passes without errors', () => {
    const result = validateBrief(sampleDiscountBrief)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})
