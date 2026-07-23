/**
 * Canonical data model for an event brief.
 *
 * `brief.json` is the single source of truth (WORK_PLAN §13). The in-memory
 * `EventBrief` holds the editable state (project + blocks + assets). The
 * exported `BriefFile` additionally carries *derived* views (`designSummary`,
 * `publishing`) produced by the summary builder — those are never edited
 * directly.
 *
 * Coordinates are stored in 840px-canvas space but are only ever *soft hints*
 * to the downstream image generator (WORK_PLAN §3.2, §8).
 */

import type { AiVisibility, BlockType } from './blockTypes'

export const SCHEMA_VERSION = '1.0.0'

/** Default canvas geometry (WORK_PLAN §10). */
export const DEFAULT_CANVAS_WIDTH = 840
export const DEFAULT_CANVAS_HEIGHT = 1800

// ── Project ────────────────────────────────────────────────────────────────

export type OutputType = 'event_page' | 'popup' | 'banner' | 'sns_image' | 'etc'

/**
 * Top-level project metadata (WORK_PLAN §12).
 * `eventType` is metadata only and never forces a layout template (§12, §22).
 */
export interface Project {
  title: string
  requestTeam?: string
  author?: string
  /** ISO date string, e.g. "2026-07-23". */
  createdAt?: string
  /** Free-form event type label; metadata only. */
  eventType?: string
  outputType: OutputType
  canvasWidth: number
  canvasHeight: number
  conceptNote?: string
}

// ── Layout hints & position ──────────────────────────────────────────────────

export type LayoutRegion = 'top' | 'middle' | 'bottom' | 'free'
export type LayoutAlignment = 'left' | 'center' | 'right' | 'free'
export type LayoutEmphasis = 'low' | 'normal' | 'high' | 'very_high'

export interface BlockPosition {
  x: number
  y: number
  width: number
  height: number
}

/** Soft placement hints. The generator may freely re-compose these (§3.2). */
export interface LayoutHint {
  region?: LayoutRegion
  alignment?: LayoutAlignment
  emphasis?: LayoutEmphasis
  order?: number
}

/**
 * Image-specific attributes captured at registration time (WORK_PLAN §11).
 * Present only on image blocks.
 */
export interface BlockImageMeta {
  /** Product name associated with the image, if any. */
  productName?: string
  /**
   * Whether the AI is allowed to transform the image. For "기존 통이미지"
   * (existing full images) this should be `false` (§9, §14 warning).
   */
  allowTransform?: boolean
}

/**
 * A single brief block. Extends WORK_PLAN §8's `BriefBlock` with the optional
 * `image` metadata required by §11.
 */
export interface BriefBlock {
  id: string
  type: BlockType
  label: string
  content?: string
  required: boolean
  priority: 1 | 2 | 3 | 4 | 5
  aiVisibility: AiVisibility
  position: BlockPosition
  layoutHint: LayoutHint
  notes?: string
  assetId?: string
  groupId?: string
  image?: BlockImageMeta
}

// ── Assets ───────────────────────────────────────────────────────────────────

export type ImageMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'

/**
 * An uploaded image asset. Binary data lives in IndexedDB at runtime
 * (WORK_PLAN §16); the domain model references assets by id. Fixtures and
 * tests may inline a `dataUrl`.
 */
export interface Asset {
  id: string
  /** Original filename, preserved verbatim (§11). */
  fileName: string
  mimeType: ImageMimeType
  width?: number
  height?: number
  byteSize?: number
  /** Optional inline data URL (used by fixtures / preview, not required). */
  dataUrl?: string
}

// ── Canonical in-memory brief ────────────────────────────────────────────────

/** The editable, single-source-of-truth state. */
export interface EventBrief {
  schemaVersion: string
  project: Project
  blocks: BriefBlock[]
  assets: Asset[]
}

// ── Derived views (generated, not edited) ────────────────────────────────────

export interface SummaryText {
  blockId: string
  type: BlockType
  label: string
  content: string
  emphasis: LayoutEmphasis
  priority: number
}

export interface SummaryProduct {
  blockId: string
  productName: string
  assetId?: string
  allowTransform: boolean
  required: boolean
  groupId?: string
}

export interface SummaryItem {
  blockId: string
  type: BlockType
  label: string
  content: string
}

export interface SummaryCta {
  blockId: string
  text: string
  /**
   * Whether a publishing link exists for this CTA. Deliberately a boolean, not
   * the URL itself — the summary is AI-facing and must never carry publishing
   * URLs (WORK_PLAN §34 Phase 5 gate). The URL lives only in `PublishingInfo`.
   */
  hasLink: boolean
}

export interface SummaryImage {
  blockId: string
  assetId?: string
  productName?: string
  /** "그대로 삽입" — insert without modification. */
  verbatim: boolean
}

export interface SummaryLayoutHint {
  blockId: string
  region: LayoutRegion
  alignment: LayoutAlignment
  emphasis: LayoutEmphasis
  order: number
}

/**
 * AI-facing design summary (WORK_PLAN §13, §15). Rule-based, no AI calls in the
 * MVP (§15). Crucially never contains publishing links (§34 Phase 5 gate).
 */
export interface DesignSummary {
  mainHeadline?: string
  subHeadlines: string[]
  requiredTexts: SummaryText[]
  requiredProducts: SummaryProduct[]
  requiredBenefits: SummaryItem[]
  period?: string
  price?: string
  discountRate?: string
  cautions: string[]
  ctaButtons: SummaryCta[]
  /** Images to insert as-is, e.g. existing full images. */
  verbatimImages: SummaryImage[]
  layoutHints: SummaryLayoutHint[]
}

export interface PublishingLink {
  blockId: string
  label: string
  url: string
  /** Purpose, e.g. "CTA 버튼 연결". */
  purpose?: string
}

export interface PublishingNote {
  blockId: string
  label: string
  content: string
}

/** Publishing-only information the image AI ignores (WORK_PLAN §13). */
export interface PublishingInfo {
  links: PublishingLink[]
  notes: PublishingNote[]
}

/**
 * The full `brief.json` payload written into a `.eventbrief` archive. Combines
 * the canonical state with the derived summary/publishing views.
 */
export interface BriefFile extends EventBrief {
  designSummary: DesignSummary
  publishing: PublishingInfo
}

/** Archive-level metadata written to `manifest.json` (WORK_PLAN §13). */
export interface Manifest {
  format: 'eventbrief'
  version: string
  createdAt: string
  generator: 'event-brief-builder'
}
