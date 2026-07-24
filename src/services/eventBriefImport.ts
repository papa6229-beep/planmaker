/**
 * Reads and fully validates a `.eventbrief` archive (WORK_PLAN §9, §10).
 * Returns a canonical brief plus decoded asset blobs, or throws EventBriefError.
 *
 * This never touches the editor or IndexedDB — it validates the whole archive
 * in memory first, so a corrupt file can never partially clobber the current
 * project. Applying the result (transactional swap) is the caller's job.
 */

import JSZip from 'jszip'
import { SCHEMA_VERSION, type Asset, type EventBrief } from '../domain/briefSchema'
import { validateBrief } from '../domain/validation'
import { isAcceptedMime } from '../features/assets/imageUtils'
import type { StoredAsset } from './assetStore'
import {
  BRIEF_PATH,
  EventBriefError,
  MANIFEST_PATH,
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
  parseManifest,
  type EventBriefManifest,
} from './eventBriefArchive'

const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = [SCHEMA_VERSION]

export interface ImportedBrief {
  brief: EventBrief
  assets: StoredAsset[]
  manifest: EventBriefManifest
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Shallowly narrows the untrusted brief.json to the canonical editable shape. */
function toCanonicalBrief(raw: unknown): EventBrief {
  if (
    !isRecord(raw) ||
    typeof raw.schemaVersion !== 'string' ||
    !isRecord(raw.project) ||
    !Array.isArray(raw.blocks) ||
    !Array.isArray(raw.assets)
  ) {
    throw new EventBriefError('BRIEF_INVALID', 'brief.json 구조가 올바르지 않습니다.')
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(raw.schemaVersion)) {
    throw new EventBriefError('SCHEMA_UNSUPPORTED', `지원하지 않는 schemaVersion: ${raw.schemaVersion}`)
  }
  // Drop derived views (designSummary / publishing) — they are regenerated.
  // Shape is enforced structurally by validateBrief immediately after.
  return {
    schemaVersion: raw.schemaVersion,
    project: raw.project as unknown as EventBrief['project'],
    blocks: raw.blocks as unknown as EventBrief['blocks'],
    assets: raw.assets as unknown as Asset[],
  }
}

function assertNoDuplicateIds(brief: EventBrief): void {
  const blockIds = new Set<string>()
  for (const b of brief.blocks) {
    if (blockIds.has(b.id)) throw new EventBriefError('DUPLICATE_ID', `중복된 블록 ID: ${b.id}`)
    blockIds.add(b.id)
  }
  const assetIds = new Set<string>()
  for (const a of brief.assets) {
    if (assetIds.has(a.id)) throw new EventBriefError('DUPLICATE_ID', `중복된 자산 ID: ${a.id}`)
    assetIds.add(a.id)
  }
}

async function loadZip(data: ArrayBuffer | Uint8Array | Blob): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(data)
  } catch {
    throw new EventBriefError('NOT_A_ZIP', 'ZIP(.eventbrief) 파일이 아닙니다.')
  }
}

async function readText(zip: JSZip, path: string, code: 'MANIFEST_MISSING' | 'BRIEF_MISSING'): Promise<string> {
  const entry = zip.file(path)
  if (!entry) throw new EventBriefError(code, `${path} 이(가) 없습니다.`)
  return entry.async('string')
}

/** Validates the whole archive in memory and returns the decoded result. */
export async function readEventBrief(data: ArrayBuffer | Uint8Array | Blob): Promise<ImportedBrief> {
  const zip = await loadZip(data)

  // 1. Manifest.
  const manifestText = await readText(zip, MANIFEST_PATH, 'MANIFEST_MISSING')
  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(manifestText)
  } catch {
    throw new EventBriefError('MANIFEST_INVALID', 'manifest.json 파싱 실패.')
  }
  const manifest = parseManifest(manifestRaw)

  // 2. Brief.
  const briefText = await readText(zip, BRIEF_PATH, 'BRIEF_MISSING')
  let briefRaw: unknown
  try {
    briefRaw = JSON.parse(briefText)
  } catch {
    throw new EventBriefError('BRIEF_INVALID', 'brief.json 파싱 실패.')
  }
  const brief = toCanonicalBrief(briefRaw)

  // 3. Structural integrity.
  assertNoDuplicateIds(brief)
  const result = validateBrief(brief)
  if (!result.ok) {
    throw new EventBriefError('VALIDATION_FAILED', result.errors[0]?.message ?? '검증에 실패했습니다.')
  }

  // 4. Decode every referenced asset blob (byte-identical), verifying presence,
  //    mime, and size limits.
  const entryByAssetId = new Map(manifest.assets.map((e) => [e.assetId, e]))
  const assets: StoredAsset[] = []
  let totalBytes = 0

  for (const meta of brief.assets) {
    const entry = entryByAssetId.get(meta.id)
    if (!entry) throw new EventBriefError('ASSET_BLOB_MISSING', `자산 매핑 누락: ${meta.id}`)
    if (!isAcceptedMime(meta.mimeType)) {
      throw new EventBriefError('BRIEF_INVALID', `허용되지 않는 MIME 타입: ${meta.mimeType}`)
    }
    const file = zip.file(entry.path)
    if (!file) throw new EventBriefError('ASSET_BLOB_MISSING', `이미지 파일 누락: ${entry.path}`)

    const bytes = await file.async('uint8array')
    if (bytes.byteLength > MAX_ENTRY_BYTES) {
      throw new EventBriefError('TOO_LARGE', `이미지가 너무 큽니다: ${entry.originalFileName}`)
    }
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new EventBriefError('TOO_LARGE', '전체 용량이 허용 한도를 초과했습니다.')
    }

    const stored: StoredAsset = {
      id: meta.id,
      blob: new Blob([bytes], { type: meta.mimeType }),
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      byteSize: bytes.byteLength,
    }
    if (meta.width !== undefined) stored.width = meta.width
    if (meta.height !== undefined) stored.height = meta.height
    assets.push(stored)
  }

  return { brief, assets, manifest }
}
