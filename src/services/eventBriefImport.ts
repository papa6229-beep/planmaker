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
import { briefToDocument, migrateToDocument } from '../domain/briefMigration'
import type { BriefDocument } from '../domain/pageSchema'
import type { StoredAsset } from './assetStore'
import {
  BRIEF_PATH,
  DOCUMENT_PATH,
  EVENTBRIEF_STUDIO_VERSION,
  EventBriefError,
  MANIFEST_PATH,
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
  parseManifest,
  STUDIO_PATH,
  type EventBriefManifest,
} from './eventBriefArchive'
import { parseStudioFileState, studioFileAssetIds, type StudioFileState } from '../domain/studioFile'

const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = [SCHEMA_VERSION]

/**
 * Errors that actually stop a file from being opened: the archive is damaged or
 * self-contradictory. What a brief *contains* — whether it has a title, a
 * design block, or a filled-in required block — is authoring guidance, not a
 * condition for reading a file back (자유 저장 §2.2). A brief that was saved as
 * only a sentence of direction must open again as exactly that.
 */
const STRUCTURAL_ERROR_CODES: ReadonlySet<string> = new Set([
  'DUPLICATE_BLOCK_ID',
  'ASSET_REFERENCE_MISSING',
])

/** Throws only when the archive is structurally broken; content is left alone. */
function assertStructurallySound(brief: EventBrief): void {
  const blocking = validateBrief(brief).errors.filter((e) => STRUCTURAL_ERROR_CODES.has(e.code))
  if (blocking.length > 0) {
    throw new EventBriefError('VALIDATION_FAILED', blocking[0]!.message)
  }
}

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
  assertStructurallySound(brief)

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

// ── Multi-page document import (Phase 7 Step 4, WORK_PLAN §9) ─────────────────

export interface ImportedDocument {
  doc: BriefDocument
  /**
   * Every blob the file carries: the document's own assets and, for a Studio
   * file, the product image originals its links point at.
   */
  assets: StoredAsset[]
  manifest: EventBriefManifest
  /** Studio 작업 상태. 이 상태가 없는 보통 기획서 파일에서는 없다. */
  studio?: StudioFileState
}

/** Narrows an untrusted document.json to a BriefDocument (migrateToDocument normalizes). */
function toCanonicalDocument(raw: unknown): BriefDocument {
  if (!isRecord(raw) || !Array.isArray(raw.pages)) {
    throw new EventBriefError('BRIEF_INVALID', 'document.json 구조가 올바르지 않습니다.')
  }
  return migrateToDocument(raw)
}

/** Block ids (and asset ids) must be unique across the whole document. */
function assertNoDuplicateDocumentIds(doc: BriefDocument): void {
  const blockIds = new Set<string>()
  for (const page of doc.pages) {
    for (const b of page.blocks) {
      if (blockIds.has(b.id)) throw new EventBriefError('DUPLICATE_ID', `중복된 블록 ID: ${b.id}`)
      blockIds.add(b.id)
    }
  }
  const assetIds = new Set<string>()
  for (const a of doc.assets) {
    if (assetIds.has(a.id)) throw new EventBriefError('DUPLICATE_ID', `중복된 자산 ID: ${a.id}`)
    assetIds.add(a.id)
  }
}

/**
 * 파일 하나가 풀어놓을 수 있는 용량 (Studio 파일 안전 경계 §3).
 *
 * 기획서 이미지와 제품 이미지는 서로 다른 폴더에 있지만 열리는 곳은 같은 한 대의
 * 기기다. 각자 한도를 따로 세면, 둘 다 한도 아래인데 합치면 한도를 훨씬 넘는
 * 파일이 그대로 통과한다. 그래서 눈금은 하나다 — 여기를 지나가는 모든 바이트가
 * 같은 눈금에 쌓인다.
 */
interface SizeLimits {
  maxEntryBytes: number
  maxTotalBytes: number
}

interface ByteBudget {
  limits: SizeLimits
  used: number
}

function newBudget(limits?: Partial<SizeLimits>): ByteBudget {
  return {
    limits: {
      maxEntryBytes: limits?.maxEntryBytes ?? MAX_ENTRY_BYTES,
      maxTotalBytes: limits?.maxTotalBytes ?? MAX_TOTAL_BYTES,
    },
    used: 0,
  }
}

/** 바이트를 눈금에 올린다. 낱장이 크거나 합이 한도를 넘으면 거기서 멈춘다. */
function charge(budget: ByteBudget, byteLength: number, label: string): void {
  if (byteLength > budget.limits.maxEntryBytes) {
    throw new EventBriefError('TOO_LARGE', `이미지가 너무 큽니다: ${label}`)
  }
  budget.used += byteLength
  if (budget.used > budget.limits.maxTotalBytes) {
    throw new EventBriefError('TOO_LARGE', '전체 용량이 허용 한도를 초과했습니다.')
  }
}

/** Decodes every referenced asset blob byte-for-byte (presence, mime, size limits). */
async function decodeAssets(
  zip: JSZip,
  manifest: EventBriefManifest,
  metas: readonly Asset[],
  budget: ByteBudget,
): Promise<StoredAsset[]> {
  const entryByAssetId = new Map(manifest.assets.map((e) => [e.assetId, e]))
  const assets: StoredAsset[] = []

  for (const meta of metas) {
    const entry = entryByAssetId.get(meta.id)
    if (!entry) throw new EventBriefError('ASSET_BLOB_MISSING', `자산 매핑 누락: ${meta.id}`)
    if (!isAcceptedMime(meta.mimeType)) {
      throw new EventBriefError('BRIEF_INVALID', `허용되지 않는 MIME 타입: ${meta.mimeType}`)
    }
    const file = zip.file(entry.path)
    if (!file) throw new EventBriefError('ASSET_BLOB_MISSING', `이미지 파일 누락: ${entry.path}`)

    const bytes = await file.async('uint8array')
    charge(budget, bytes.byteLength, entry.originalFileName)

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
  return assets
}

/**
 * Reads the product image originals a Studio file carries.
 *
 * These have no entry in `doc.assets` on purpose — they are not part of the
 * brief — so their metadata comes from the manifest. A link that points at a
 * picture the file does not carry is a broken file, and says so rather than
 * opening with the connection quietly gone.
 */
async function decodeProductAssets(
  zip: JSZip,
  manifest: EventBriefManifest,
  studio: StudioFileState,
  already: ReadonlySet<string>,
  budget: ByteBudget,
): Promise<StoredAsset[]> {
  const entryByAssetId = new Map(manifest.assets.map((e) => [e.assetId, e]))
  const assets: StoredAsset[] = []

  for (const assetId of studioFileAssetIds(studio)) {
    if (already.has(assetId)) continue
    const entry = entryByAssetId.get(assetId)
    if (!entry) {
      throw new EventBriefError('ASSET_BLOB_MISSING', `제품 이미지 매핑이 누락되었습니다: ${assetId}`)
    }
    if (!isAcceptedMime(entry.mimeType)) {
      throw new EventBriefError('BRIEF_INVALID', `허용되지 않는 MIME 타입: ${entry.mimeType}`)
    }
    const file = zip.file(entry.path)
    if (!file) {
      throw new EventBriefError('ASSET_BLOB_MISSING', `제품 이미지 파일이 누락되었습니다: ${entry.path}`)
    }
    const bytes = await file.async('uint8array')
    charge(budget, bytes.byteLength, entry.originalFileName)
    assets.push({
      id: assetId,
      blob: new Blob([bytes], { type: entry.mimeType }),
      fileName: entry.originalFileName,
      mimeType: entry.mimeType,
      byteSize: bytes.byteLength,
    })
  }
  return assets
}

/**
 * Reads a `.eventbrief` archive as a multi-page document. Handles both the v2
 * document format (document.json) and legacy v1 single-page files (brief.json),
 * which migrate to a one-page document. Validates the whole archive in memory
 * before returning, so a corrupt file never clobbers current work.
 *
 * `limits`는 검사에서 한도 경계를 실제로 넘겨보기 위한 것이다 — 비워 두면 제품이
 * 쓰는 한도 그대로다.
 */
export async function readEventDocument(
  data: ArrayBuffer | Uint8Array | Blob,
  limits?: Partial<SizeLimits>,
): Promise<ImportedDocument> {
  const zip = await loadZip(data)
  const budget = newBudget(limits)

  const manifestText = await readText(zip, MANIFEST_PATH, 'MANIFEST_MISSING')
  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(manifestText)
  } catch {
    throw new EventBriefError('MANIFEST_INVALID', 'manifest.json 파싱 실패.')
  }
  const manifest = parseManifest(manifestRaw)

  let doc: BriefDocument
  if (manifest.version === '2.0.0' || manifest.version === '2.1.0') {
    const docText = await readText(zip, DOCUMENT_PATH, 'BRIEF_MISSING')
    let docRaw: unknown
    try {
      docRaw = JSON.parse(docText)
    } catch {
      throw new EventBriefError('BRIEF_INVALID', 'document.json 파싱 실패.')
    }
    doc = toCanonicalDocument(docRaw)
  } else {
    // v1: read the single brief and lift it into a one-page document.
    const briefText = await readText(zip, BRIEF_PATH, 'BRIEF_MISSING')
    let briefRaw: unknown
    try {
      briefRaw = JSON.parse(briefText)
    } catch {
      throw new EventBriefError('BRIEF_INVALID', 'brief.json 파싱 실패.')
    }
    doc = briefToDocument(toCanonicalBrief(briefRaw))
  }

  // Structural integrity only: unique ids across the document, and blocks that
  // point at assets the archive actually carries. A file opens as whatever it
  // was saved as — a page of wording, a single line of direction, or nothing
  // at all (자유 저장 §2.2).
  assertNoDuplicateDocumentIds(doc)
  assertStructurallySound({
    schemaVersion: SCHEMA_VERSION,
    project: doc.project,
    blocks: doc.pages.flatMap((p) => p.blocks),
    assets: doc.assets,
  })
  // A page's 참고 이미지 is not a block, so it needs its own check. A file that
  // points at an image it does not carry is broken, and says so rather than
  // opening quietly with the reference gone (v1 마감 §8).
  const known = new Set(doc.assets.map((a) => a.id))
  for (const page of doc.pages) {
    const id = page.reference.assetId
    if (id !== undefined && !known.has(id)) {
      throw new EventBriefError('ASSET_BLOB_MISSING', `참고 이미지 파일이 누락되었습니다: ${page.title}`)
    }
  }

  const assets = await decodeAssets(zip, manifest, doc.assets, budget)

  // Studio 상태는 있을 때만 읽는다. 있는데 읽을 수 없으면 반쪽짜리로 열지 않는다.
  //
  // 2.1 파일은 그 상태를 지니고 있다고 스스로 적은 파일이다. 그런데 없으면 그건
  // 손상이지 "Studio 없는 보통 기획서"가 아니다. 조용히 열면 제품 이미지 연결만
  // 사라진 채로 열리고, 사용자는 그 사실을 저장해 버린 뒤에야 안다.
  const studioFile = zip.file(STUDIO_PATH)
  if (!studioFile) {
    if (manifest.version === EVENTBRIEF_STUDIO_VERSION) {
      throw new EventBriefError('STUDIO_STATE_INVALID', 'studio.json 이(가) 없습니다.')
    }
    return { doc, assets, manifest }
  }

  let studioRaw: unknown
  try {
    studioRaw = JSON.parse(await studioFile.async('string'))
  } catch {
    throw new EventBriefError('STUDIO_STATE_INVALID', 'studio.json 파싱 실패.')
  }
  const studio = parseStudioFileState(studioRaw)
  if (studio === null) {
    throw new EventBriefError('STUDIO_STATE_INVALID', 'studio.json 형식이 올바르지 않습니다.')
  }

  const products = await decodeProductAssets(zip, manifest, studio, new Set(assets.map((a) => a.id)), budget)
  return { doc, assets: [...assets, ...products], manifest, studio }
}
