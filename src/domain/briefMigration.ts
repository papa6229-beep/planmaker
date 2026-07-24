/**
 * Migration between the single-page v1 brief and the multi-page v2 document
 * (WORK_PLAN Phase 7 §9.4).
 *
 *   v1  EventBrief { schemaVersion, project, blocks, assets }
 *   v2  BriefDocument { schemaVersion, project, pages[], activePageId, assets }
 *
 * A v1 brief migrates to a document with a single page (`pages[0]`) whose
 * blocks are the original blocks — ids, coordinates, groups, and asset metadata
 * are preserved by reference. `.eventbrief` v1 files therefore keep loading:
 * the existing importer yields an `EventBrief`, and `migrateToDocument` lifts it
 * into a document.
 */

import { SCHEMA_VERSION, type Asset, type EventBrief } from './briefSchema'
import {
  createPage,
  createReferenceLayer,
  DOCUMENT_SCHEMA_VERSION,
  PAGE_CANVAS_WIDTH,
  type BriefDocument,
  type BriefPage,
} from './pageSchema'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** True when the value is already a multi-page document (has a `pages` array). */
export function isBriefDocument(value: unknown): value is BriefDocument {
  return isRecord(value) && Array.isArray((value as { pages?: unknown }).pages)
}

/** True when the value looks like a single-page v1 brief (has a `blocks` array). */
export function isSinglePageBrief(value: unknown): value is EventBrief {
  return isRecord(value) && Array.isArray((value as { blocks?: unknown }).blocks) && !isBriefDocument(value)
}

/** Wraps a single-page brief into a one-page document, preserving everything. */
export function briefToDocument(brief: EventBrief): BriefDocument {
  const page = createPage({
    title: '1페이지',
    blocks: brief.blocks,
    canvasWidth: brief.project.canvasWidth ?? PAGE_CANVAS_WIDTH,
    canvasHeight: brief.project.canvasHeight,
    reference: createReferenceLayer(),
  })
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    project: brief.project,
    pages: [page],
    activePageId: page.id,
    assets: brief.assets,
  }
}

/**
 * Normalizes an untrusted document-shaped value, ensuring at least one page and
 * a valid `activePageId`. Page-level fields are filled with defaults when
 * absent so older/partial documents still load.
 */
function normalizeDocument(raw: BriefDocument): BriefDocument {
  const pages: BriefPage[] =
    raw.pages.length > 0
      ? raw.pages.map((p) =>
          createPage({
            id: p.id,
            title: p.title,
            blocks: p.blocks ?? [],
            canvasWidth: p.canvasWidth ?? PAGE_CANVAS_WIDTH,
            canvasHeight: p.canvasHeight,
            reference: p.reference ?? createReferenceLayer(),
          }),
        )
      : [createPage({ title: '1페이지' })]

  const activePageId = pages.some((p) => p.id === raw.activePageId) ? raw.activePageId : pages[0]!.id

  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    project: raw.project,
    pages,
    activePageId,
    assets: Array.isArray(raw.assets) ? (raw.assets as Asset[]) : [],
  }
}

/**
 * Converts any supported brief shape (v1 single-page, v2 document, or an
 * already-loaded object) into a normalized `BriefDocument`.
 */
export function migrateToDocument(input: unknown): BriefDocument {
  if (isBriefDocument(input)) return normalizeDocument(input)
  if (isSinglePageBrief(input)) return briefToDocument(input)
  throw new Error('지원하지 않는 기획서 형식입니다.')
}

/** Serializes a document to JSON (the on-disk multi-page brief form). */
export function serializeDocument(doc: BriefDocument): string {
  return JSON.stringify(doc)
}

/** Parses JSON (v1 or v2) and migrates to a normalized document. */
export function deserializeDocument(json: string): BriefDocument {
  return migrateToDocument(JSON.parse(json))
}

/**
 * Projects a single page to the legacy `EventBrief` shape so the existing
 * validation / summary / export logic (Phase 1–6) can run per page unchanged.
 * The page's canvas dimensions override the project's.
 */
export function pageAsEventBrief(doc: BriefDocument, page: BriefPage): EventBrief {
  return {
    schemaVersion: SCHEMA_VERSION,
    project: { ...doc.project, canvasWidth: page.canvasWidth, canvasHeight: page.canvasHeight },
    blocks: page.blocks,
    assets: doc.assets,
  }
}
