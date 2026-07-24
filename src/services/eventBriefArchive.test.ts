import { describe, it, expect } from 'vitest'
import {
  assetArchivePath,
  buildManifest,
  classifyAssetArea,
  EventBriefError,
  isSafeArchivePath,
  parseManifest,
  sanitizeArchiveFileName,
} from './eventBriefArchive'
import { createBlock, createEmptyBrief } from '../domain/factory'
import type { EventBrief } from '../domain/briefSchema'

describe('sanitizeArchiveFileName', () => {
  it('strips directory parts and traversal', () => {
    expect(sanitizeArchiveFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeArchiveFileName('C:\\evil\\logo.png')).toBe('logo.png')
  })
  it('replaces OS-problematic characters and leading dots', () => {
    expect(sanitizeArchiveFileName('a<b>c:"d.png')).toBe('a_b_c__d.png')
    expect(sanitizeArchiveFileName('...hidden.png')).toBe('hidden.png')
  })
  it('falls back for empty results', () => {
    expect(sanitizeArchiveFileName('')).toBe('file')
    expect(sanitizeArchiveFileName('///')).toBe('file')
  })
  it('preserves unicode (Korean) names', () => {
    expect(sanitizeArchiveFileName('제품-01.png')).toBe('제품-01.png')
  })
})

describe('isSafeArchivePath', () => {
  it('accepts normal paths', () => {
    expect(isSafeArchivePath('assets/a__logo.png')).toBe(true)
  })
  it('rejects traversal, absolute, backslash, empty segments', () => {
    expect(isSafeArchivePath('../secret')).toBe(false)
    expect(isSafeArchivePath('/abs/path')).toBe(false)
    expect(isSafeArchivePath('a\\b')).toBe(false)
    expect(isSafeArchivePath('assets//x')).toBe(false)
    expect(isSafeArchivePath('')).toBe(false)
  })
})

function briefWith(visibility: 'design' | 'reference' | 'publishing'): EventBrief {
  const block = createBlock('main_product_image', { assetId: 'asset_1' })
  block.aiVisibility = visibility
  return { ...createEmptyBrief('t'), blocks: [block] }
}

describe('classifyAssetArea / assetArchivePath', () => {
  it('puts design images under assets/ and others under references/', () => {
    expect(classifyAssetArea(briefWith('design'), 'asset_1')).toBe('design')
    expect(classifyAssetArea(briefWith('reference'), 'asset_1')).toBe('reference')
    expect(classifyAssetArea(briefWith('publishing'), 'asset_1')).toBe('reference')
  })

  it('builds assetId-based paths that avoid filename collisions', () => {
    const p1 = assetArchivePath('id1', 'logo.png', 'design')
    const p2 = assetArchivePath('id2', 'logo.png', 'design')
    expect(p1).toBe('assets/id1__logo.png')
    expect(p2).toBe('assets/id2__logo.png')
    expect(p1).not.toBe(p2) // same original name, different archive path
    expect(assetArchivePath('id3', 'bg.png', 'reference')).toBe('references/id3__bg.png')
  })
})

describe('manifest', () => {
  it('round-trips a valid manifest', () => {
    const m = buildManifest(
      [{ assetId: 'a', path: 'assets/a__x.png', originalFileName: 'x.png', mimeType: 'image/png', size: 3, area: 'design' }],
      '2026-07-24T00:00:00Z',
    )
    const parsed = parseManifest(JSON.parse(JSON.stringify(m)))
    expect(parsed.format).toBe('eventbrief')
    expect(parsed.version).toBe('1.0.0')
    expect(parsed.assets[0]!.originalFileName).toBe('x.png')
  })

  it('rejects a non-eventbrief format', () => {
    expect(() => parseManifest({ format: 'other', version: '1.0.0' })).toThrow(EventBriefError)
  })

  it('rejects an unsupported version', () => {
    expect(() => parseManifest({ format: 'eventbrief', version: '9.9.9' })).toThrow(/버전/)
  })

  it('rejects unsafe asset paths', () => {
    expect(() =>
      parseManifest({
        format: 'eventbrief',
        version: '1.0.0',
        assets: [{ assetId: 'a', path: '../evil.png', originalFileName: 'e.png', mimeType: 'image/png' }],
      }),
    ).toThrow(/안전하지 않은/)
  })
})
