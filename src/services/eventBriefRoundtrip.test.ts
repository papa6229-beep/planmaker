import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { packageEventBrief } from './eventBriefExport'
import { readEventBrief } from './eventBriefImport'
import { EventBriefError } from './eventBriefArchive'
import { createBlock, createEmptyBrief } from '../domain/factory'
import type { Asset, EventBrief, ImageMimeType } from '../domain/briefSchema'
import type { StoredAsset } from './assetStore'

const PUBLISHING_URL = 'https://shop.example.com/buy'

function bytes(seed: number, len = 12): Uint8Array {
  return new Uint8Array(Array.from({ length: len }, (_, i) => (seed * 31 + i) % 256))
}

// jsdom's Blob does not implement arrayBuffer(); read via FileReader.
function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((b) => new Uint8Array(b))
  }
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.addEventListener('load', () => resolve(new Uint8Array(fr.result as ArrayBuffer)), { once: true })
    fr.addEventListener('error', () => reject(fr.error), { once: true })
    fr.readAsArrayBuffer(blob)
  })
}

function assetMeta(id: string, fileName: string, mimeType: ImageMimeType): Asset {
  return { id, fileName, mimeType, width: 10, height: 10, byteSize: 12 }
}

function storedAsset(id: string, fileName: string, mimeType: ImageMimeType, seed: number): StoredAsset {
  return { id, blob: new Blob([bytes(seed)], { type: mimeType }), fileName, mimeType, width: 10, height: 10, byteSize: 12 }
}

/** A brief with design + reference images (same filename), a group, and a publishing URL. */
function buildSample(): { brief: EventBrief; assets: StoredAsset[] } {
  const main = createBlock('main_headline', { id: 'blk_main', content: '롬프 1+1', required: true, position: { x: 40, y: 40, width: 300, height: 90 } })
  const prod = createBlock('main_product_image', { id: 'blk_prod', assetId: 'asset_1', groupId: 'grp_1', position: { x: 40, y: 160, width: 300, height: 300 } })
  const prod2 = createBlock('sub_product_image', { id: 'blk_prod2', assetId: 'asset_3', groupId: 'grp_1', position: { x: 360, y: 160, width: 300, height: 300 } })
  const bg = createBlock('background_reference_image', { id: 'blk_bg', assetId: 'asset_2', position: { x: 40, y: 500, width: 300, height: 200 } })
  bg.aiVisibility = 'reference'
  const cta = createBlock('cta_button', { id: 'blk_cta', content: '지금 구매', position: { x: 40, y: 720, width: 200, height: 80 } })
  const url = createBlock('button_url', { id: 'blk_url', content: PUBLISHING_URL, position: { x: 0, y: 0, width: 200, height: 60 } })

  const brief: EventBrief = {
    ...createEmptyBrief('롬프 1+1'),
    blocks: [main, prod, prod2, bg, cta, url],
    assets: [
      assetMeta('asset_1', 'logo.png', 'image/png'),
      assetMeta('asset_3', 'logo.png', 'image/png'), // same filename, different id
      assetMeta('asset_2', 'bg.gif', 'image/gif'),
    ],
  }
  const assets = [
    storedAsset('asset_1', 'logo.png', 'image/png', 1),
    storedAsset('asset_3', 'logo.png', 'image/png', 2),
    storedAsset('asset_2', 'bg.gif', 'image/gif', 3),
  ]
  return { brief, assets }
}

describe('eventbrief export → import round-trip', () => {
  it('preserves blocks, ids, coordinates, groups, visibility and assets', async () => {
    const { brief, assets } = buildSample()
    const preview = new Blob([bytes(9, 20)], { type: 'image/png' })
    const pkg = await packageEventBrief({ brief, assets, preview, createdAt: '2026-07-24T00:00:00Z' })
    expect(pkg.fileName).toBe('롬프 1+1.eventbrief')

    const imported = await readEventBrief(pkg.blob)
    const r = imported.brief
    expect(r.project.title).toBe('롬프 1+1')
    expect(r.blocks.map((b) => b.id)).toEqual(brief.blocks.map((b) => b.id))
    expect(r.blocks.map((b) => b.position)).toEqual(brief.blocks.map((b) => b.position))
    expect(r.blocks.map((b) => b.aiVisibility)).toEqual(brief.blocks.map((b) => b.aiVisibility))
    // Group relationship survives.
    expect(r.blocks.find((b) => b.id === 'blk_prod')!.groupId).toBe('grp_1')
    expect(r.blocks.find((b) => b.id === 'blk_prod2')!.groupId).toBe('grp_1')
  })

  it('required archive files are present, split into assets/ and references/', async () => {
    const { brief, assets } = buildSample()
    const pkg = await packageEventBrief({ brief, assets, preview: new Blob([bytes(1)], { type: 'image/png' }), createdAt: 't' })
    const zip = await JSZip.loadAsync(pkg.blob)
    expect(zip.file('manifest.json')).toBeTruthy()
    expect(zip.file('brief.json')).toBeTruthy()
    expect(zip.file('preview.png')).toBeTruthy()
    // Design image under assets/, reference image under references/.
    expect(pkg.manifest.assets.find((a) => a.assetId === 'asset_1')!.path.startsWith('assets/')).toBe(true)
    expect(pkg.manifest.assets.find((a) => a.assetId === 'asset_2')!.path.startsWith('references/')).toBe(true)
  })

  it('restores image blobs byte-for-byte, keeping original filename and mime', async () => {
    const { brief, assets } = buildSample()
    const pkg = await packageEventBrief({ brief, assets, preview: null, createdAt: 't' })
    const imported = await readEventBrief(pkg.blob)

    for (const original of assets) {
      const restored = imported.assets.find((a) => a.id === original.id)!
      expect(restored.fileName).toBe(original.fileName)
      expect(restored.mimeType).toBe(original.mimeType)
      const a = await readBytes(original.blob)
      const b = await readBytes(restored.blob)
      expect(Array.from(b)).toEqual(Array.from(a))
    }
    // Two assets share the filename logo.png but neither overwrote the other.
    const logos = imported.assets.filter((a) => a.fileName === 'logo.png')
    expect(logos).toHaveLength(2)
    const [c1, c2] = await Promise.all(logos.map(async (l) => Array.from(await readBytes(l.blob))))
    expect(c1).not.toEqual(c2)
  })

  it('keeps the publishing URL out of brief.json designSummary', async () => {
    const { brief, assets } = buildSample()
    const pkg = await packageEventBrief({ brief, assets, preview: null, createdAt: 't' })
    const zip = await JSZip.loadAsync(pkg.blob)
    const briefJson = JSON.parse(await zip.file('brief.json')!.async('string'))
    expect(JSON.stringify(briefJson.designSummary)).not.toContain('shop.example.com')
    expect(JSON.stringify(briefJson.publishing)).toContain('shop.example.com')
  })
})

async function zipOf(files: Record<string, string | Uint8Array>): Promise<Blob> {
  const zip = new JSZip()
  for (const [k, v] of Object.entries(files)) zip.file(k, v)
  return zip.generateAsync({ type: 'blob' })
}

describe('eventbrief import — rejections (never mutate current state)', () => {
  it('rejects a non-zip file', async () => {
    await expect(readEventBrief(new Uint8Array([1, 2, 3]).buffer)).rejects.toBeInstanceOf(EventBriefError)
  })

  it('rejects a missing manifest', async () => {
    const blob = await zipOf({ 'brief.json': '{}' })
    await expect(readEventBrief(blob)).rejects.toMatchObject({ code: 'MANIFEST_MISSING' })
  })

  it('rejects a corrupt brief.json', async () => {
    const blob = await zipOf({
      'manifest.json': JSON.stringify({ format: 'eventbrief', version: '1.0.0', assets: [] }),
      'brief.json': '{ not json',
    })
    await expect(readEventBrief(blob)).rejects.toMatchObject({ code: 'BRIEF_INVALID' })
  })

  it('rejects when a referenced asset blob is missing', async () => {
    const { brief } = buildSample()
    const manifest = {
      format: 'eventbrief',
      version: '1.0.0',
      assets: [{ assetId: 'asset_1', path: 'assets/asset_1__logo.png', originalFileName: 'logo.png', mimeType: 'image/png', size: 12, area: 'design' }],
    }
    const blob = await zipOf({
      'manifest.json': JSON.stringify(manifest),
      'brief.json': JSON.stringify({ schemaVersion: brief.schemaVersion, project: brief.project, blocks: brief.blocks, assets: brief.assets }),
      // note: no asset files written
    })
    await expect(readEventBrief(blob)).rejects.toMatchObject({ code: 'ASSET_BLOB_MISSING' })
  })

  it('rejects duplicate block ids', async () => {
    const dupBlock = createBlock('main_headline', { id: 'dup', content: 'A' })
    const brief: EventBrief = { ...createEmptyBrief('t'), blocks: [dupBlock, { ...dupBlock }] }
    const blob = await zipOf({
      'manifest.json': JSON.stringify({ format: 'eventbrief', version: '1.0.0', assets: [] }),
      'brief.json': JSON.stringify(brief),
    })
    await expect(readEventBrief(blob)).rejects.toMatchObject({ code: 'DUPLICATE_ID' })
  })
})
