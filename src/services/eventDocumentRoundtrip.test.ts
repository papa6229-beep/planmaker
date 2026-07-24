/**
 * Multi-page `.eventbrief` (v2) export → import round-trip (WORK_PLAN Phase 7
 * §9, Step 4). Verifies every page — order, titles, activePageId, per-page
 * blocks/groups/canvas height/reference layer — plus byte-identical shared
 * assets and per-page previews, and that legacy v1 files still load as one page.
 */

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { packageEventDocument, packageEventBrief } from './eventBriefExport'
import { readEventDocument } from './eventBriefImport'
import { createBlock, createEmptyBrief } from '../domain/factory'
import { createEmptyDocument, type BriefDocument } from '../domain/pageSchema'
import { addPage } from '../domain/pageOps'
import type { Asset, EventBrief, ImageMimeType } from '../domain/briefSchema'
import type { StoredAsset } from './assetStore'

function bytes(seed: number, len = 12): Uint8Array {
  return new Uint8Array(Array.from({ length: len }, (_, i) => (seed * 31 + i) % 256))
}

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

/** A 3-page document: text page, image+group page, reference-layer page. */
function buildSampleDocument(): { doc: BriefDocument; assets: StoredAsset[] } {
  let doc = createEmptyDocument(createEmptyBrief('여름 캠페인').project)

  // Page 1 — text only.
  const p1Head = createBlock('main_headline', { id: 'blk_h1', content: '여름 세일', required: true, position: { x: 40, y: 40, width: 300, height: 90 } })
  doc = { ...doc, pages: [{ ...doc.pages[0]!, title: '표지', blocks: [p1Head], canvasHeight: 900 }] }

  // Page 2 — two grouped product images sharing a group id.
  doc = addPage(doc, '상품')
  const prodA = createBlock('main_product_image', { id: 'blk_pa', assetId: 'asset_1', groupId: 'grp_x', position: { x: 40, y: 40, width: 300, height: 300 } })
  const prodB = createBlock('sub_product_image', { id: 'blk_pb', assetId: 'asset_2', groupId: 'grp_x', position: { x: 360, y: 40, width: 300, height: 300 } })
  doc = { ...doc, pages: doc.pages.map((p) => (p.id === doc.activePageId ? { ...p, blocks: [prodA, prodB], canvasHeight: 1200 } : p)) }

  // Page 3 — a reference-layer image (excluded from AI output).
  doc = addPage(doc, '참고')
  doc = {
    ...doc,
    pages: doc.pages.map((p) =>
      p.id === doc.activePageId ? { ...p, blocks: [], reference: { ...p.reference, assetId: 'asset_3', opacity: 0.5, visible: true } } : p,
    ),
  }

  // Make page 1 active again (activePageId must survive the round-trip).
  doc = { ...doc, activePageId: doc.pages[0]!.id, assets: [assetMeta('asset_1', 'a.png', 'image/png'), assetMeta('asset_2', 'b.png', 'image/png'), assetMeta('asset_3', 'ref.png', 'image/png')] }

  const assets = [
    storedAsset('asset_1', 'a.png', 'image/png', 1),
    storedAsset('asset_2', 'b.png', 'image/png', 2),
    storedAsset('asset_3', 'ref.png', 'image/png', 3),
  ]
  return { doc, assets }
}

describe('eventbrief v2 document round-trip', () => {
  it('preserves pages, order, titles, activePageId, blocks, groups, canvas height and reference layers', async () => {
    const { doc, assets } = buildSampleDocument()
    const previews = doc.pages.map((_, i) => new Blob([bytes(50 + i, 20)], { type: 'image/png' }))
    const pkg = await packageEventDocument({ doc, assets, previews, createdAt: '2026-07-24T00:00:00Z' })
    expect(pkg.fileName).toBe('여름 캠페인.eventbrief')
    expect(pkg.manifest.version).toBe('2.0.0')

    const r = (await readEventDocument(pkg.blob)).doc
    expect(r.pages.map((p) => p.title)).toEqual(['표지', '상품', '참고'])
    expect(r.activePageId).toBe(doc.activePageId)
    expect(r.project.title).toBe('여름 캠페인')

    // Page 1: canvas height + block.
    expect(r.pages[0]!.canvasHeight).toBe(900)
    expect(r.pages[0]!.blocks.map((b) => b.id)).toEqual(['blk_h1'])

    // Page 2: grouped images kept together, height preserved.
    expect(r.pages[1]!.canvasHeight).toBe(1200)
    expect(r.pages[1]!.blocks.find((b) => b.id === 'blk_pa')!.groupId).toBe('grp_x')
    expect(r.pages[1]!.blocks.find((b) => b.id === 'blk_pb')!.groupId).toBe('grp_x')

    // Page 3: reference layer restored (image + opacity + visibility).
    expect(r.pages[2]!.reference.assetId).toBe('asset_3')
    expect(r.pages[2]!.reference.opacity).toBe(0.5)
    expect(r.pages[2]!.reference.visible).toBe(true)
  })

  it('writes one preview per page as previews/page-01.png, page-02.png…', async () => {
    const { doc, assets } = buildSampleDocument()
    const previews = doc.pages.map((_, i) => new Blob([bytes(i)], { type: 'image/png' }))
    const pkg = await packageEventDocument({ doc, assets, previews, createdAt: 't' })
    const zip = await JSZip.loadAsync(pkg.blob)
    expect(zip.file('manifest.json')).toBeTruthy()
    expect(zip.file('document.json')).toBeTruthy()
    expect(zip.file('previews/page-01.png')).toBeTruthy()
    expect(zip.file('previews/page-02.png')).toBeTruthy()
    expect(zip.file('previews/page-03.png')).toBeTruthy()
  })

  it('restores shared image blobs byte-for-byte across pages', async () => {
    const { doc, assets } = buildSampleDocument()
    const pkg = await packageEventDocument({ doc, assets, previews: [], createdAt: 't' })
    const imported = await readEventDocument(pkg.blob)
    for (const original of assets) {
      const restored = imported.assets.find((a) => a.id === original.id)!
      expect(restored.fileName).toBe(original.fileName)
      const a = await readBytes(original.blob)
      const b = await readBytes(restored.blob)
      expect(Array.from(b)).toEqual(Array.from(a))
    }
  })

  it('loads a legacy v1 .eventbrief as a single-page document', async () => {
    const head = createBlock('main_headline', { id: 'blk_v1', content: '구형 파일', required: true, position: { x: 10, y: 10, width: 200, height: 80 } })
    const brief: EventBrief = { ...createEmptyBrief('구형 기획서'), blocks: [head] }
    const v1 = await packageEventBrief({ brief, assets: [], preview: null, createdAt: 't' })

    const imported = await readEventDocument(v1.blob)
    expect(imported.doc.pages).toHaveLength(1)
    expect(imported.doc.pages[0]!.blocks.map((b) => b.id)).toEqual(['blk_v1'])
    expect(imported.doc.project.title).toBe('구형 기획서')
  })

  it('rejects a document with duplicate block ids across pages', async () => {
    let doc = createEmptyDocument(createEmptyBrief('중복').project)
    const dup = createBlock('main_headline', { id: 'same', content: 'A' })
    doc = { ...doc, pages: [{ ...doc.pages[0]!, blocks: [dup] }] }
    doc = addPage(doc, '2')
    doc = { ...doc, pages: doc.pages.map((p, i) => (i === 1 ? { ...p, blocks: [{ ...dup }] } : p)) }

    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ format: 'eventbrief', version: '2.0.0', assets: [] }))
    zip.file('document.json', JSON.stringify(doc))
    const blob = await zip.generateAsync({ type: 'blob' })
    await expect(readEventDocument(blob)).rejects.toMatchObject({ code: 'DUPLICATE_ID' })
  })
})
