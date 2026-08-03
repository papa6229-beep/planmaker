/**
 * Packages the current brief into a `.eventbrief` ZIP (WORK_PLAN §6, §13).
 * Pure with respect to the DOM: it takes the canonical brief, the asset blobs,
 * and an already-rendered preview, and returns a Blob — so it is unit-testable.
 * Triggering the browser download lives in the UI layer.
 */

import JSZip from 'jszip'
import type { BriefBlock, EventBrief } from '../domain/briefSchema'
import { buildBriefFile } from '../domain/summaryBuilder'
import { serializeDocument } from '../domain/briefMigration'
import type { BriefDocument } from '../domain/pageSchema'
import type { StoredAsset } from './assetStore'
import {
  assetArchivePath,
  BRIEF_PATH,
  buildManifest,
  classifyAssetArea,
  DOCUMENT_PATH,
  EVENTBRIEF_DOCUMENT_VERSION,
  EVENTBRIEF_STUDIO_VERSION,
  EventBriefError,
  MANIFEST_PATH,
  pagePreviewPath,
  PREVIEW_PATH,
  sanitizeArchiveFileName,
  STUDIO_PATH,
  type AssetArchiveEntry,
  type EventBriefManifest,
} from './eventBriefArchive'
import { studioFileAssetIds, type StudioFileState } from '../domain/studioFile'

export interface PackagedBrief {
  blob: Blob
  fileName: string
  manifest: EventBriefManifest
}

export interface PackageArgs {
  brief: EventBrief
  assets: StoredAsset[]
  /** Rendered preview PNG. Required by the UI flow; may be null in tests. */
  preview: Blob | null
  createdAt: string
}

function briefFileName(brief: EventBrief): string {
  const base = sanitizeArchiveFileName(brief.project.title.trim() || 'event-brief')
  return `${base}.eventbrief`
}

/** Builds the ZIP archive as a Blob plus the manifest actually written. */
export async function packageEventBrief({ brief, assets, preview, createdAt }: PackageArgs): Promise<PackagedBrief> {
  const zip = new JSZip()
  const assetById = new Map(assets.map((a) => [a.id, a]))

  const entries: AssetArchiveEntry[] = []
  for (const meta of brief.assets) {
    const stored = assetById.get(meta.id)
    if (!stored) {
      throw new EventBriefError('ASSET_BLOB_MISSING', `이미지 데이터를 찾을 수 없습니다: ${meta.fileName}`)
    }
    const area = classifyAssetArea(brief, meta.id)
    const path = assetArchivePath(meta.id, stored.fileName, area)
    entries.push({
      assetId: meta.id,
      path,
      originalFileName: stored.fileName,
      mimeType: stored.mimeType,
      size: stored.byteSize ?? stored.blob.size,
      area,
    })
    zip.file(path, stored.blob)
  }

  const manifest = buildManifest(entries, createdAt)
  zip.file(MANIFEST_PATH, JSON.stringify(manifest, null, 2))

  // brief.json is the canonical snapshot; designSummary/publishing are derived
  // (convenience only — import regenerates them). Publishing URLs never enter
  // designSummary (guaranteed by summaryBuilder).
  const briefFile = buildBriefFile(brief)
  zip.file(BRIEF_PATH, JSON.stringify(briefFile, null, 2))

  if (preview) {
    zip.file(PREVIEW_PATH, preview)
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return { blob, fileName: briefFileName(brief), manifest }
}

// ── Multi-page document packaging (Phase 7 Step 4, WORK_PLAN §9) ──────────────

export interface PackageDocumentArgs {
  doc: BriefDocument
  /**
   * Blobs available to write. Must contain every asset the document references
   * *and* every product image the Studio state links, or packaging fails.
   */
  assets: StoredAsset[]
  /** One preview PNG per page, in page order. May be empty in tests. */
  previews: Blob[]
  createdAt: string
  /**
   * Studio 작업 상태. 있으면 `studio.json`과 `products/`가 함께 쓰이고 파일
   * 버전이 2.1.0이 된다. 없으면 지금까지의 2.0.0 파일 그대로다 (Studio 파일 §4.2).
   */
  studio?: StudioFileState
}

function documentFileName(doc: BriefDocument): string {
  const base = sanitizeArchiveFileName(doc.project.title.trim() || 'event-brief')
  return `${base}.eventbrief`
}

/** All blocks across every page — used to classify a shared asset's area. */
function allBlocks(doc: BriefDocument): BriefBlock[] {
  return doc.pages.flatMap((p) => p.blocks)
}

/**
 * Packages a whole multi-page document into a v2 `.eventbrief` ZIP:
 *   manifest.json · document.json (all pages) · previews/page-01.png… ·
 *   assets/ · references/ — and, for a Studio job, studio.json · products/.
 *
 * The shared asset pool is written once; each page references assets by id. The
 * product images a Studio job links are *not* in that pool (they are deliberately
 * outside the brief), so they are gathered from the Studio state and written
 * alongside — once per image, however many blocks point at it.
 */
export async function packageEventDocument({
  doc,
  assets,
  previews,
  createdAt,
  studio,
}: PackageDocumentArgs): Promise<PackagedBrief> {
  const zip = new JSZip()
  const assetById = new Map(assets.map((a) => [a.id, a]))
  // Classify against every page's blocks (design if any design-visible block uses it).
  const flat: EventBrief = {
    schemaVersion: '1.0.0',
    project: doc.project,
    blocks: allBlocks(doc),
    assets: doc.assets,
  }

  const entries: AssetArchiveEntry[] = []
  for (const meta of doc.assets) {
    const stored = assetById.get(meta.id)
    if (!stored) {
      throw new EventBriefError('ASSET_BLOB_MISSING', `이미지 데이터를 찾을 수 없습니다: ${meta.fileName}`)
    }
    const area = classifyAssetArea(flat, meta.id)
    const path = assetArchivePath(meta.id, stored.fileName, area)
    entries.push({
      assetId: meta.id,
      path,
      originalFileName: stored.fileName,
      mimeType: stored.mimeType,
      size: stored.byteSize ?? stored.blob.size,
      area,
    })
    zip.file(path, stored.blob)
  }

  // 디자인팀이 연결한 실제 제품 이미지. 기획서 자산 풀 밖에 있으므로 여기서
  // 따로 모은다. 같은 이미지가 여러 블록에 연결됐어도 바이너리는 한 번만 쓴다.
  if (studio) {
    const written = new Set(entries.map((e) => e.assetId))
    for (const assetId of studioFileAssetIds(studio)) {
      if (written.has(assetId)) continue
      const stored = assetById.get(assetId)
      if (!stored) {
        // 연결정보가 가리키는 그림이 없으면 손상된 파일을 만들지 않는다.
        throw new EventBriefError(
          'ASSET_BLOB_MISSING',
          `연결된 제품 이미지의 원본을 찾을 수 없어 저장할 수 없습니다: ${assetId}`,
        )
      }
      const path = assetArchivePath(assetId, stored.fileName, 'product')
      entries.push({
        assetId,
        path,
        originalFileName: stored.fileName,
        mimeType: stored.mimeType,
        size: stored.byteSize ?? stored.blob.size,
        area: 'product',
      })
      zip.file(path, stored.blob)
      written.add(assetId)
    }
  }

  const manifest = buildManifest(
    entries,
    createdAt,
    studio ? EVENTBRIEF_STUDIO_VERSION : EVENTBRIEF_DOCUMENT_VERSION,
  )
  zip.file(MANIFEST_PATH, JSON.stringify(manifest, null, 2))

  // document.json is the canonical multi-page snapshot (pages, order, activePageId).
  zip.file(DOCUMENT_PATH, serializeDocument(doc))
  if (studio) zip.file(STUDIO_PATH, JSON.stringify(studio, null, 2))

  previews.forEach((preview, i) => {
    if (preview) zip.file(pagePreviewPath(i), preview)
  })

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return { blob, fileName: documentFileName(doc), manifest }
}
