/**
 * Pure helpers for the `.eventbrief` archive format (WORK_PLAN §13, Phase 6).
 * No ZIP or DOM here — just manifest shape, safe path generation, and
 * classification. Kept dependency-free so it is trivially unit-testable.
 *
 * Archive layout:
 *   project.eventbrief (ZIP)
 *   ├─ manifest.json
 *   ├─ brief.json
 *   ├─ preview.png
 *   ├─ assets/      design images
 *   └─ references/  reference / publishing images
 */

import type { EventBrief, Manifest } from '../domain/briefSchema'

export const EVENTBRIEF_FORMAT = 'eventbrief'
export const EVENTBRIEF_VERSION = '1.0.0'
/** Multi-page archive version (Phase 7 Step 4). */
export const EVENTBRIEF_DOCUMENT_VERSION = '2.0.0'
export const SUPPORTED_VERSIONS: readonly string[] = ['1.0.0', '2.0.0']
export const GENERATOR = 'event-brief-builder'

export const MANIFEST_PATH = 'manifest.json'
export const BRIEF_PATH = 'brief.json'
export const PREVIEW_PATH = 'preview.png'
/** v2 document payload path (all pages). */
export const DOCUMENT_PATH = 'document.json'

/**
 * ZIP path for a page's preview, 1-based and zero-padded (WORK_PLAN §9.5):
 * `previews/page-01.png`, `previews/page-02.png`, …
 */
export function pagePreviewPath(index: number): string {
  return `previews/page-${String(index + 1).padStart(2, '0')}.png`
}

/** Guardrails against pathological archives (WORK_PLAN §9). */
export const MAX_ASSET_COUNT = 500
export const MAX_ENTRY_BYTES = 50 * 1024 * 1024 // 50 MB per file
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024 // 200 MB total

export type AssetArea = 'design' | 'reference'

/** Per-asset mapping stored in the manifest so import can locate each blob. */
export interface AssetArchiveEntry {
  assetId: string
  path: string
  originalFileName: string
  mimeType: string
  size: number
  area: AssetArea
}

export interface EventBriefManifest extends Manifest {
  assets: AssetArchiveEntry[]
}

/** Structured error so the UI can show a specific reason (WORK_PLAN §5, §9). */
export type EventBriefErrorCode =
  | 'NOT_A_ZIP'
  | 'MANIFEST_MISSING'
  | 'MANIFEST_INVALID'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_VERSION'
  | 'BRIEF_MISSING'
  | 'BRIEF_INVALID'
  | 'SCHEMA_UNSUPPORTED'
  | 'VALIDATION_FAILED'
  | 'ASSET_BLOB_MISSING'
  | 'DUPLICATE_ID'
  | 'UNSAFE_PATH'
  | 'TOO_LARGE'
  | 'PREVIEW_FAILED'

export class EventBriefError extends Error {
  readonly code: EventBriefErrorCode
  constructor(code: EventBriefErrorCode, message: string) {
    super(message)
    this.name = 'EventBriefError'
    this.code = code
  }
}

function stripDirectories(name: string): string {
  const idx = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  return idx >= 0 ? name.slice(idx + 1) : name
}

/** True when a code point is a control character we must strip from filenames. */
function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f
}

/**
 * Produces a filesystem/ZIP-safe filename: strips directory parts, removes
 * control and OS-problematic characters, leading dots (no `..`), caps length,
 * and falls back to a placeholder when nothing usable remains.
 */
export function sanitizeArchiveFileName(name: string): string {
  const withoutControl = Array.from(stripDirectories(name).normalize('NFC'))
    .filter((ch) => !isControlChar(ch))
    .join('')
  const cleaned = withoutControl
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
  return cleaned.length > 0 ? cleaned : 'file'
}

/** True when a ZIP entry path is safe to read/write (no traversal/absolute). */
export function isSafeArchivePath(path: string): boolean {
  if (path.length === 0) return false
  if (path.startsWith('/') || path.includes('\\')) return false
  if (/(^|\/)\.\.(\/|$)/.test(path)) return false
  if (path.split('/').some((seg) => seg.length === 0)) return false
  return true
}

/**
 * Design images go under assets/, reference & publishing images under
 * references/ (WORK_PLAN §13). An asset is "design" if any block that
 * references it is design-visible.
 */
export function classifyAssetArea(brief: EventBrief, assetId: string): AssetArea {
  const referencing = brief.blocks.filter((b) => b.assetId === assetId)
  // A capture the planner attached to show an idea belongs with the reference
  // material, however the block itself is addressed to the AI.
  const isDesignAsset = referencing.some((b) => b.aiVisibility === 'design' && b.image?.referenceOnly !== true)
  return isDesignAsset ? 'design' : 'reference'
}

/** Builds the ZIP-internal path for an asset: `{area}/{assetId}__{safeName}`. */
export function assetArchivePath(assetId: string, originalFileName: string, area: AssetArea): string {
  const folder = area === 'design' ? 'assets' : 'references'
  return `${folder}/${assetId}__${sanitizeArchiveFileName(originalFileName)}`
}

export function buildManifest(
  assets: AssetArchiveEntry[],
  createdAt: string,
  version: string = EVENTBRIEF_VERSION,
): EventBriefManifest {
  return {
    format: EVENTBRIEF_FORMAT,
    version,
    createdAt,
    generator: GENERATOR,
    assets,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Validates and narrows an untrusted manifest object. Throws EventBriefError. */
export function parseManifest(raw: unknown): EventBriefManifest {
  if (!isRecord(raw)) {
    throw new EventBriefError('MANIFEST_INVALID', 'manifest.json 형식이 올바르지 않습니다.')
  }
  if (raw.format !== EVENTBRIEF_FORMAT) {
    throw new EventBriefError('UNSUPPORTED_FORMAT', 'eventbrief 형식이 아닙니다.')
  }
  if (typeof raw.version !== 'string' || !SUPPORTED_VERSIONS.includes(raw.version)) {
    throw new EventBriefError('UNSUPPORTED_VERSION', `지원하지 않는 버전입니다: ${String(raw.version)}`)
  }
  const assets = Array.isArray(raw.assets) ? raw.assets : []
  const entries: AssetArchiveEntry[] = assets.map((a) => {
    if (
      !isRecord(a) ||
      typeof a.assetId !== 'string' ||
      typeof a.path !== 'string' ||
      typeof a.originalFileName !== 'string' ||
      typeof a.mimeType !== 'string'
    ) {
      throw new EventBriefError('MANIFEST_INVALID', 'manifest 자산 항목이 올바르지 않습니다.')
    }
    if (!isSafeArchivePath(a.path)) {
      throw new EventBriefError('UNSAFE_PATH', `안전하지 않은 경로입니다: ${a.path}`)
    }
    return {
      assetId: a.assetId,
      path: a.path,
      originalFileName: a.originalFileName,
      mimeType: a.mimeType,
      size: typeof a.size === 'number' ? a.size : 0,
      area: a.area === 'design' ? 'design' : 'reference',
    }
  })
  if (entries.length > MAX_ASSET_COUNT) {
    throw new EventBriefError('TOO_LARGE', '자산 개수가 허용 한도를 초과했습니다.')
  }
  return {
    format: EVENTBRIEF_FORMAT,
    version: raw.version,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    generator: GENERATOR,
    assets: entries,
  }
}
