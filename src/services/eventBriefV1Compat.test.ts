import { describe, it, expect } from 'vitest'
import { packageEventBrief } from './eventBriefExport'
import { readEventBrief } from './eventBriefImport'
import { migrateToDocument } from '../domain/briefMigration'
import { createBlock, createEmptyBrief } from '../domain/factory'
import type { EventBrief } from '../domain/briefSchema'
import type { StoredAsset } from './assetStore'

/**
 * A v1 `.eventbrief` file must keep loading (WORK_PLAN §9.4): the existing
 * importer yields an EventBrief, which migrates into a one-page document with
 * ids / coordinates / groups / assets preserved.
 */
describe('v1 .eventbrief → document compatibility', () => {
  it('imports a v1 archive and migrates it to a single-page document', async () => {
    const headline = createBlock('main_headline', { id: 'blk_h', content: '헤드라인', required: true, position: { x: 12, y: 24, width: 300, height: 90 } })
    const img = createBlock('main_product_image', { id: 'blk_i', assetId: 'asset_1', groupId: 'grp_1', position: { x: 40, y: 160, width: 300, height: 300 } })
    const brief: EventBrief = {
      ...createEmptyBrief('기존 v1 기획서'),
      blocks: [headline, img],
      assets: [{ id: 'asset_1', fileName: 'p.png', mimeType: 'image/png', byteSize: 4 }],
    }
    const stored: StoredAsset[] = [
      { id: 'asset_1', blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), fileName: 'p.png', mimeType: 'image/png', byteSize: 4 },
    ]

    const pkg = await packageEventBrief({ brief, assets: stored, preview: null, createdAt: 't' })
    const imported = await readEventBrief(pkg.blob)

    // Existing importer still yields a single-page EventBrief.
    expect(imported.brief.blocks.map((b) => b.id)).toEqual(['blk_h', 'blk_i'])

    // Migration lifts it to a one-page document, preserving everything.
    const doc = migrateToDocument(imported.brief)
    expect(doc.pages).toHaveLength(1)
    const page = doc.pages[0]!
    expect(page.blocks.map((b) => b.id)).toEqual(['blk_h', 'blk_i'])
    expect(page.blocks[0]!.position).toEqual({ x: 12, y: 24, width: 300, height: 90 })
    expect(page.blocks[1]!.groupId).toBe('grp_1')
    expect(page.blocks[1]!.assetId).toBe('asset_1')
    expect(doc.assets.map((a) => a.id)).toEqual(['asset_1'])
    expect(page.canvasWidth).toBe(840)
  })
})
