/**
 * Local persistence (WORK_PLAN §16). The MVP runs without a server:
 *  - the brief snapshot (project + blocks + asset metadata) is stored as one
 *    JSON record,
 *  - image binaries are stored as Blobs, keyed by asset id, so transparency
 *    and original bytes are preserved.
 *
 * Uses Dexie (IndexedDB) per WORK_PLAN §17. Blobs never enter the editor's
 * reducer state — only their metadata does — so the editable state stays
 * serializable and pure.
 */

import Dexie, { type Table } from 'dexie'
import type { EventBrief } from '../domain/briefSchema'
import type { BriefDocument } from '../domain/pageSchema'
import { migrateToDocument } from '../domain/briefMigration'

/** A stored image binary plus the metadata needed to rehydrate its Asset. */
export interface StoredAsset {
  id: string
  blob: Blob
  fileName: string
  mimeType: string
  width?: number
  height?: number
  byteSize?: number
}

interface BriefSnapshotRow {
  key: string
  brief?: EventBrief
  /** Multi-page document snapshot (Phase 7 Step 4). */
  doc?: BriefDocument
  updatedAt: number
}

const SNAPSHOT_KEY = 'current'
const DOCUMENT_KEY = 'document'

class EventBriefDB extends Dexie {
  briefs!: Table<BriefSnapshotRow, string>
  assets!: Table<StoredAsset, string>

  constructor() {
    super('event-brief-builder')
    this.version(1).stores({
      briefs: 'key',
      assets: 'id',
    })
  }
}

let dbInstance: EventBriefDB | null = null

function db(): EventBriefDB {
  dbInstance ??= new EventBriefDB()
  return dbInstance
}

/** Persists the current brief snapshot (overwrites the single row). */
export async function saveBrief(brief: EventBrief, now: number): Promise<void> {
  await db().briefs.put({ key: SNAPSHOT_KEY, brief, updatedAt: now })
}

/** Loads the saved brief snapshot, or null if none exists yet. */
export async function loadBrief(): Promise<EventBrief | null> {
  const row = await db().briefs.get(SNAPSHOT_KEY)
  return row?.brief ?? null
}

/** Persists the current multi-page document snapshot (Phase 7 Step 4). */
export async function saveDocument(doc: BriefDocument, now: number): Promise<void> {
  await db().briefs.put({ key: DOCUMENT_KEY, doc, updatedAt: now })
}

/**
 * Loads the saved document snapshot. Falls back to a legacy single-page brief
 * row and migrates it, so autosaved Phase 0–6 / Step 1–3 data still opens.
 * Returns null when nothing is stored yet.
 */
export async function loadDocument(): Promise<BriefDocument | null> {
  const docRow = await db().briefs.get(DOCUMENT_KEY)
  if (docRow?.doc) return migrateToDocument(docRow.doc)
  const legacy = await db().briefs.get(SNAPSHOT_KEY)
  if (legacy?.brief) return migrateToDocument(legacy.brief)
  return null
}

/** Stores (or replaces) an image asset binary. */
export async function putAsset(asset: StoredAsset): Promise<void> {
  await db().assets.put(asset)
}

/** Returns every stored asset binary. */
export async function getAllAssets(): Promise<StoredAsset[]> {
  return db().assets.toArray()
}

/** Deletes a stored asset binary. */
export async function deleteAsset(id: string): Promise<void> {
  await db().assets.delete(id)
}

/** Removes any stored assets whose ids are not referenced by the brief. */
export async function pruneAssets(referencedIds: Iterable<string>): Promise<void> {
  const keep = new Set(referencedIds)
  const all = await db().assets.toArray()
  const orphans = all.filter((a) => !keep.has(a.id)).map((a) => a.id)
  if (orphans.length > 0) await db().assets.bulkDelete(orphans)
}

/** One stored asset, or undefined. */
export async function getAsset(id: string): Promise<StoredAsset | undefined> {
  return db().assets.get(id)
}

/**
 * Adds assets to the shared pool, leaving everything already there alone.
 *
 * This is what an import uses. The pool is shared by every brief and by every
 * delivered snapshot, so opening a file may only ever *add* to it — the old
 * clear-then-write took other briefs' images with it (v1 동결 §3).
 */
export async function putAssets(assets: readonly StoredAsset[]): Promise<void> {
  if (assets.length === 0) return
  await db().assets.bulkPut([...assets])
}

/** Deletes exactly these assets — used to roll back a failed import. */
export async function deleteAssets(ids: readonly string[]): Promise<void> {
  if (ids.length > 0) await db().assets.bulkDelete([...ids])
}

/**
 * Atomically replaces all stored asset blobs.
 *
 * @deprecated Never use this for import: it empties the pool every brief and
 * every delivered snapshot shares. Kept for a future explicit "reset".
 */
export async function replaceAssets(assets: StoredAsset[]): Promise<void> {
  await db().transaction('rw', db().assets, async () => {
    await db().assets.clear()
    if (assets.length > 0) await db().assets.bulkPut(assets)
  })
}

/**
 * Empties the legacy single-brief snapshot rows, leaving image blobs alone.
 *
 * The old autosave row is imported into the library exactly once; a reset that
 * left it in place would hand that one brief back on the next start.
 */
export async function clearBriefSnapshots(): Promise<void> {
  await db().briefs.clear()
}

/** Clears everything (used by tests and a future "reset" action). */
export async function clearAll(): Promise<void> {
  await db().transaction('rw', db().briefs, db().assets, async () => {
    await db().briefs.clear()
    await db().assets.clear()
  })
}

/** Test hook: drops the cached instance so a fresh (faked) IndexedDB is used. */
export function resetAssetStoreForTests(): void {
  dbInstance = null
}
