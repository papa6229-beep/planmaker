/**
 * Local work-request repository (WORK_PLAN §6, §13, Step 7). Persists delivered
 * requests to IndexedDB (Dexie) so the image-generation queue survives a
 * restart — there is no server in this phase. A `WorkRequest` is stored as one
 * JSON-serializable row (its documents include only asset *metadata*; the image
 * binaries stay in the shared asset store, keyed by id).
 */

import Dexie, { type Table } from 'dexie'
import type { WorkRequest } from '../domain/workRequest'
import { requestAssetIds } from '../domain/workRequest'

class RequestDB extends Dexie {
  requests!: Table<WorkRequest, string>

  constructor() {
    super('event-brief-requests')
    this.version(1).stores({ requests: 'id, status, submittedAt' })
  }
}

let dbInstance: RequestDB | null = null

function db(): RequestDB {
  dbInstance ??= new RequestDB()
  return dbInstance
}

/** All requests, newest delivery first. */
export async function listRequests(): Promise<WorkRequest[]> {
  const rows = await db().requests.toArray()
  return rows.toSorted((a, b) => (a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0))
}

export async function getRequest(id: string): Promise<WorkRequest | undefined> {
  return db().requests.get(id)
}

/** Inserts or replaces a request. */
export async function putRequest(request: WorkRequest): Promise<void> {
  await db().requests.put(request)
}

export async function deleteRequest(id: string): Promise<void> {
  await db().requests.delete(id)
}

/** Every asset id referenced by any stored request (so shared blobs are not pruned). */
export async function allRequestAssetIds(): Promise<string[]> {
  const rows = await db().requests.toArray()
  const ids = new Set<string>()
  for (const r of rows) for (const id of requestAssetIds(r)) ids.add(id)
  return [...ids]
}

/** Clears every stored request (tests, and a future "reset" action). */
export async function clearAllRequests(): Promise<void> {
  await db().requests.clear()
}

/** Test hook: drop the cached instance so a fresh (faked) IndexedDB is used. */
export function resetRequestStoreForTests(): void {
  dbInstance = null
}
