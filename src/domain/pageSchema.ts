/**
 * Multi-page document schema (WORK_PLAN Phase 7 §9).
 *
 * `BriefDocument` is the new canonical multi-page container. It is added
 * alongside the existing single-page `EventBrief` (Phase 0–6), which remains in
 * use as the per-page content projection consumed by the current validation /
 * summary / export logic (see `pageAsEventBrief` in briefMigration.ts). The
 * editor is wired onto pages in later Phase 7 steps; Step 1 only lays the
 * domain foundation and migration.
 *
 * Design rules:
 *  - Each page is a FIXED 840px logical work surface. Canvas width/height are
 *    per page (WORK_PLAN §9.3); width defaults to 840 and is never treated as
 *    responsive — screen zoom is a *view* concern only (see canvasView.ts).
 *  - Reference images are page-level auxiliary layers, never design/AI output
 *    (WORK_PLAN §8.4).
 *  - The document owns the shared asset pool; pages reference assets by id.
 */

import { createId } from './factory'
import {
  DEFAULT_CANVAS_WIDTH,
  NEW_PAGE_HEIGHT,
  type Asset,
  type BriefBlock,
  type Project,
} from './briefSchema'

/** New multi-page format version (distinct from the single-page `SCHEMA_VERSION`). */
export const DOCUMENT_SCHEMA_VERSION = '2.0.0'

/** Fixed logical canvas width for every page (WORK_PLAN §9, §21⑤). */
export const PAGE_CANVAS_WIDTH = DEFAULT_CANVAS_WIDTH // 840

export type ReferenceViewMode = 'canvas' | 'side' | 'overlay'
export type ReferenceFit = 'width' | 'original' | 'center'

/** Default overlay opacity (WORK_PLAN §8.3: 35%). Stored 0..1. */
export const DEFAULT_REFERENCE_OPACITY = 0.35

/**
 * Page-level reference image layer (WORK_PLAN §8). Aligned to the 840px canvas
 * coordinate space. Excluded from AI/design output and preview by default.
 */
export interface ReferenceLayer {
  /** Asset id into the document asset pool; undefined when no reference set. */
  assetId?: string
  viewMode: ReferenceViewMode
  /** Overlay opacity, 0..1. */
  opacity: number
  fit: ReferenceFit
  /** Whether the overlay is shown on the canvas. */
  visible: boolean
}

/** A single planning page (WORK_PLAN §9.3). */
export interface BriefPage {
  id: string
  title: string
  blocks: BriefBlock[]
  /** Fixed 840 logical width. */
  canvasWidth: number
  canvasHeight: number
  reference: ReferenceLayer
}

/**
 * The multi-page brief document. `activePageId` always points at a page in
 * `pages` (invariant maintained by the page operations). `assets` is the shared
 * pool referenced by block `assetId` and by each page's `reference.assetId`.
 */
export interface BriefDocument {
  schemaVersion: string
  project: Project
  pages: BriefPage[]
  activePageId: string
  assets: Asset[]
}

/** A fresh reference layer with the documented defaults. */
/** Name the one page of a brand-new brief starts with. */
export const FIRST_PAGE_TITLE = '1페이지'

export function createReferenceLayer(): ReferenceLayer {
  return { viewMode: 'canvas', opacity: DEFAULT_REFERENCE_OPACITY, fit: 'width', visible: false }
}

export interface CreatePageOptions {
  id?: string
  title?: string
  blocks?: BriefBlock[]
  canvasWidth?: number
  canvasHeight?: number
  reference?: ReferenceLayer
}

/** Creates an empty page (fixed 840 width by default). */
export function createPage(options: CreatePageOptions = {}): BriefPage {
  return {
    id: options.id ?? createId('page'),
    title: options.title ?? FIRST_PAGE_TITLE,
    blocks: options.blocks ?? [],
    canvasWidth: options.canvasWidth ?? PAGE_CANVAS_WIDTH,
    canvasHeight: options.canvasHeight ?? NEW_PAGE_HEIGHT,
    reference: options.reference ?? createReferenceLayer(),
  }
}

/** Creates an empty single-page document ready for editing. */
export function createEmptyDocument(project: Project): BriefDocument {
  const page = createPage({ title: FIRST_PAGE_TITLE })
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    project,
    pages: [page],
    activePageId: page.id,
    assets: [],
  }
}
