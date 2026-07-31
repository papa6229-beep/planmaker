/**
 * Multi-document repository (기획서 보관함 §6.3).
 *
 * Until now the editor had exactly two fixed rows — one legacy v1 snapshot and
 * one v2 document — so several briefs could not coexist. This module is the
 * repository boundary for per-document storage: every brief is a row keyed by
 * its `project.id`, and the UI goes through this API rather than touching
 * IndexedDB itself.
 *
 * Timestamps live on the row, not in the document, so the domain schema does
 * not grow date fields. `updatedAt` is for the list's ordering and 최근 수정일
 * only — whether a brief counts as edited since delivery is decided by
 * comparing content (see `documentFingerprint`), never by a timestamp.
 */

import Dexie, { type Table } from 'dexie'
import { createId } from '../domain/factory'
import { migrateToDocument } from '../domain/briefMigration'
import type { BriefDocument } from '../domain/pageSchema'

/** One stored brief. */
export interface DocumentRow {
  /** Matches `doc.project.id` and the `/briefs/:id` segment. */
  id: string
  doc: BriefDocument
  createdAt: number
  updatedAt: number
}

/** List entry — enough for the 보관함 without loading whole documents. */
export interface DocumentSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pageCount: number
}

/** Marks that the one-time import of the legacy single-autosave row is done. */
const MIGRATION_FLAG_KEY = 'single-autosave-migrated'

interface MetaRow {
  key: string
  value: string
}

class DocumentDB extends Dexie {
  documents!: Table<DocumentRow, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('event-brief-documents')
    this.version(1).stores({
      documents: 'id, updatedAt',
      meta: 'key',
    })
  }
}

let dbInstance: DocumentDB | null = null

function db(): DocumentDB {
  dbInstance ??= new DocumentDB()
  return dbInstance
}

/** Test seam: drops the cached handle so a fresh fake-indexeddb is picked up. */
export function resetDocumentStoreForTests(): void {
  dbInstance = null
}

export async function clearAllDocuments(): Promise<void> {
  await db().documents.clear()
  await db().meta.clear()
}

/** Stamps a document with an id, creating one when it has none yet. */
export function withDocumentId(doc: BriefDocument, id: string): BriefDocument {
  return { ...doc, project: { ...doc.project, id } }
}

/** The document's own id, or `undefined` for one written before ids existed. */
export function documentId(doc: BriefDocument): string | undefined {
  const id = doc.project.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** Mints a fresh brief id. */
export function newDocumentId(): string {
  return createId('doc')
}

function summarize(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    title: row.doc.project.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pageCount: row.doc.pages.length,
  }
}

/** All briefs, most recently edited first. */
export async function listDocuments(): Promise<DocumentSummary[]> {
  const rows = await db().documents.toArray()
  return rows.toSorted((a, b) => b.updatedAt - a.updatedAt).map(summarize)
}

/** Loads one brief, or `null` when the id is unknown. */
export async function loadDocumentById(id: string): Promise<BriefDocument | null> {
  const row = await db().documents.get(id)
  if (!row) return null
  // Normalise through the migration path so older payloads open cleanly, and
  // make sure the document carries the id it is stored under.
  return withDocumentId(migrateToDocument(row.doc), id)
}

/**
 * Writes a brief under its own id.
 *
 * The row id always wins over a mismatched `project.id`: rather than silently
 * writing over a different brief, the document is corrected to the id it is
 * being saved as. Callers that want a copy must mint a new id first.
 */
export async function saveDocumentById(id: string, doc: BriefDocument, now: number): Promise<void> {
  const existing = await db().documents.get(id)
  await db().documents.put({
    id,
    doc: withDocumentId(doc, id),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
}

/** Creates a new brief row and returns the id it was stored under. */
export async function createDocument(doc: BriefDocument, now: number): Promise<string> {
  const id = newDocumentId()
  await saveDocumentById(id, doc, now)
  return id
}

/**
 * Copies a brief into a brand-new one. The copy gets its own id and title and
 * shares nothing with the original — editing it cannot affect the source, and
 * it carries no delivery history. Image assets stay in the shared asset pool
 * and are referenced by the same ids, which is how the existing asset contract
 * already works for duplicated pages.
 */
export async function duplicateDocument(id: string, now: number): Promise<string | null> {
  const source = await loadDocumentById(id)
  if (!source) return null
  const copy: BriefDocument = JSON.parse(JSON.stringify(source)) as BriefDocument
  copy.project = { ...copy.project, title: `${copy.project.title} 복사본` }
  return createDocument(copy, now)
}

export async function deleteDocumentById(id: string): Promise<void> {
  await db().documents.delete(id)
}

/** Every asset id referenced by any stored brief (used by autosave pruning). */
export async function allDocumentAssetIds(): Promise<string[]> {
  const rows = await db().documents.toArray()
  const ids = new Set<string>()
  for (const row of rows) {
    for (const page of row.doc.pages) {
      for (const b of page.blocks) if (b.assetId !== undefined) ids.add(b.assetId)
      if (page.reference.assetId !== undefined) ids.add(page.reference.assetId)
    }
  }
  return [...ids]
}

/**
 * Moves the old single-autosave brief into the repository, exactly once.
 *
 * Runs only when the repository is still empty, so re-running it cannot create
 * duplicates, and the completion flag is written only after the row is safely
 * stored — a failure leaves the flag unset so the next start retries.
 * The legacy row itself is left in place; nothing is deleted.
 */
export async function migrateSingleAutosave(
  loadLegacy: () => Promise<BriefDocument | null>,
  now: number,
): Promise<string | null> {
  if (await db().meta.get(MIGRATION_FLAG_KEY)) return null
  if ((await db().documents.count()) > 0) {
    // Already have briefs: nothing to import, but record that we are done so
    // the legacy row is not reconsidered later.
    await db().meta.put({ key: MIGRATION_FLAG_KEY, value: new Date(now).toISOString() })
    return null
  }

  const legacy = await loadLegacy()
  if (!legacy) {
    await db().meta.put({ key: MIGRATION_FLAG_KEY, value: new Date(now).toISOString() })
    return null
  }

  const id = documentId(legacy) ?? newDocumentId()
  await saveDocumentById(id, legacy, now)
  // Only now is the migration complete; if the write above threw, the flag is
  // still unset and the next run tries again.
  await db().meta.put({ key: MIGRATION_FLAG_KEY, value: new Date(now).toISOString() })
  return id
}

/** True once the legacy import has been recorded as complete. */
export async function isSingleAutosaveMigrated(): Promise<boolean> {
  return (await db().meta.get(MIGRATION_FLAG_KEY)) !== undefined
}
