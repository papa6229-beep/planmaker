import { describe, it, expect } from 'vitest'
import {
  BLOCK_TYPE_LIST,
  BLOCK_TYPES,
  getBlockTypeMeta,
  isImageBlock,
  isReferenceBlock,
} from './blockTypes'

describe('block type catalog', () => {
  it('has unique type identifiers', () => {
    const types = BLOCK_TYPE_LIST.map((m) => m.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it('exposes a lookup table covering every list entry', () => {
    for (const meta of BLOCK_TYPE_LIST) {
      expect(BLOCK_TYPES[meta.type]).toBe(meta)
      expect(getBlockTypeMeta(meta.type)).toEqual(meta)
    }
  })

  it('marks image blocks as requiring an asset', () => {
    for (const meta of BLOCK_TYPE_LIST) {
      if (meta.category === 'image') {
        expect(meta.requiresAsset).toBe(true)
        expect(isImageBlock(meta.type)).toBe(true)
      } else {
        expect(meta.requiresAsset).toBe(false)
      }
    }
  })

  it('defaults reference blocks away from the design surface', () => {
    for (const meta of BLOCK_TYPE_LIST) {
      if (meta.category === 'reference') {
        expect(isReferenceBlock(meta.type)).toBe(true)
        expect(meta.defaultVisibility).not.toBe('design')
      }
    }
  })

  it('gives every block type a non-empty Korean label', () => {
    for (const meta of BLOCK_TYPE_LIST) {
      expect(meta.label.trim().length).toBeGreaterThan(0)
    }
  })
})
