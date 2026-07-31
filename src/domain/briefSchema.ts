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
  /**
   * Stable identity of the brief, matching the repository row and `/briefs/:id`.
   * Optional so documents written before multi-document storage still load; the
   * repository assigns one the first time such a document is opened.
   */
  id?: string
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
  /**
   * 전체 컨셉 — how the whole page should feel, written once for the document
   * rather than placed as a block on the canvas. It is guidance for the AI and
   * the design team and is never printed into the generated image.
   */
  concept?: string
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
 * Approximate placement carried into the AI summary. These are *hints* about
 * visual weight and reading order, never pixel-exact instructions (§3.2).
 */
export interface SummaryGeometry {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A text the design must reproduce **verbatim**, with the emphasis the user
 * asked for. Every design text block with content appears here — including the
 * neutral `free_text` written with the simplified 글 넣기 tool — so no wording
 * is ever dropped from the AI input. `type` is reported as-is so an explicit
 * legacy type (`main_headline`, `price`, …) keeps its meaning while a neutral
 * `free_text` leaves the hierarchy decision to the AI.
 */
export interface SummaryTextEntry {
  blockId: string
  /** Page the text lives on, when the summary is built for a known page. */
  pageId?: string
  type: BlockType
  label: string
  /** The exact wording. Never paraphrased or reformatted. */
  content: string
  emphasis: LayoutEmphasis
  geometry: SummaryGeometry
}

/**
 * An instruction for the AI / design team that must **not** be printed into the
 * generated image (요청 메모). `renderAsText` is always `false`, which is the
 * explicit contract separating a request from copy that must appear verbatim.
 */
export interface SummaryInstruction {
  /**
   * `document` for 전체 컨셉, which applies to the whole brief and has no
   * position; `block` for a memo placed on the canvas.
   */
  scope: 'document' | 'block'
  /** Absent for a document-wide instruction. */
  blockId?: string
  pageId?: string
  label: string
  /** The exact memo text. */
  content: string
  /** Absent for a document-wide instruction. */
  geometry?: SummaryGeometry
  /** Always false — this text is guidance, never rendered into the image. */
  renderAsText: false
}

/**
 * AI-facing design summary (WORK_PLAN §13, §15). Rule-based, no AI calls in the
 * MVP (§15). Crucially never contains publishing links (§34 Phase 5 gate).
 */
export interface DesignSummary {
  mainHeadline?: string
  subHeadlines: string[]
  /**
   * Every design text with content, verbatim, with emphasis and approximate
   * geometry. Superset of the role-specific fields below — the AI should read
   * this to be sure no wording is missed.
   */
  texts: SummaryTextEntry[]
  /**
   * Non-printing requests (요청 메모). Separated from `texts` so guidance is
   * never mistaken for copy to render.
   */
  instructions: SummaryInstruction[]
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
