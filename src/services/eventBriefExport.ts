/**
 * Packages the current brief into a `.eventbrief` ZIP (WORK_PLAN §6, §13).
 * Pure with respect to the DOM: it takes the canonical brief, the asset blobs,
 * and an already-rendered preview, and returns a Blob — so it is unit-testable.
 * Triggering the browser download lives in the UI layer.
 */

import JSZip from 'jszip'
import type { EventBrief } from '../domain/briefSchema'
import { buildBriefFile } from '../domain/summaryBuilder'
import type { StoredAsset } from './assetStore'
import {
  assetArchivePath,
  BRIEF_PATH,
  buildManifest,
  classifyAssetArea,
  EventBriefError,
  MANIFEST_PATH,
  PREVIEW_PATH,
  sanitizeArchiveFileName,
  type AssetArchiveEntry,
  type EventBriefManifest,
} from './eventBriefArchive'

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
