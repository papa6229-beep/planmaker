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
  brief: EventBrief
  updatedAt: number
}

const SNAPSHOT_KEY = 'current'

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

/** Atomically replaces all stored asset blobs (used by import). */
export async function replaceAssets(assets: StoredAsset[]): Promise<void> {
  await db().transaction('rw', db().assets, async () => {
    await db().assets.clear()
    if (assets.length > 0) await db().assets.bulkPut(assets)
  })
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
