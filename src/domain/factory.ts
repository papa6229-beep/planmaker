/**
 * Factory helpers for constructing well-formed domain objects with sensible
 * defaults. Kept in the domain layer so both the UI and tests build blocks the
 * same way.
 */

import { getBlockTypeMeta, isImageBlock, type BlockType } from './blockTypes'
import {
  NEW_PAGE_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  SCHEMA_VERSION,
  type BriefBlock,
  type EventBrief,
  type LayoutHint,
  type Project,
} from './briefSchema'

let idCounter = 0

/**
 * Generates a locally-unique id. Uses `crypto.randomUUID` when available and
 * falls back to a deterministic counter (e.g. in older environments / SSR).
 */
export function createId(prefix = 'blk'): string {
  const globalCrypto = (globalThis as { crypto?: Crypto }).crypto
  if (globalCrypto?.randomUUID) {
    return `${prefix}_${globalCrypto.randomUUID()}`
  }
  idCounter += 1
  return `${prefix}_${idCounter.toString(36)}`
}

export interface CreateBlockOptions {
  id?: string
  label?: string
  content?: string
  required?: boolean
  priority?: BriefBlock['priority']
  position?: Partial<BriefBlock['position']>
  layoutHint?: LayoutHint
  assetId?: string
  groupId?: string
  notes?: string
}

/**
 * Builds a new block for a given type, applying the type's default label and
 * AI visibility (WORK_PLAN §7, §8). Optional fields are only set when provided
 * so the object stays compatible with `exactOptionalPropertyTypes`.
 */
export function createBlock(type: BlockType, options: CreateBlockOptions = {}): BriefBlock {
  const meta = getBlockTypeMeta(type)

  const block: BriefBlock = {
    id: options.id ?? createId(),
    type,
    label: options.label ?? meta.label,
    required: options.required ?? false,
    priority: options.priority ?? 3,
    aiVisibility: meta.defaultVisibility,
    position: {
      x: options.position?.x ?? 0,
      y: options.position?.y ?? 0,
      width: options.position?.width ?? 300,
      height: options.position?.height ?? 100,
    },
    layoutHint: options.layoutHint ?? {},
  }

  if (options.content !== undefined) block.content = options.content
  if (options.assetId !== undefined) block.assetId = options.assetId
  if (options.groupId !== undefined) block.groupId = options.groupId
  if (options.notes !== undefined) block.notes = options.notes
  if (isImageBlock(type)) block.image = { allowTransform: type !== 'existing_full_image' }

  return block
}

/** Creates an empty project with default canvas geometry (WORK_PLAN §10, §12). */
export function createEmptyProject(title = ''): Project {
  return {
    title,
    outputType: 'event_page',
    canvasWidth: DEFAULT_CANVAS_WIDTH,
    // A brief starts one page long at the new-page length; every page carries
    // its own length from there (손검수 2 §3). `DEFAULT_CANVAS_HEIGHT` stays the
    // height a v1 document is migrated with.
    canvasHeight: NEW_PAGE_HEIGHT,
  }
}

/** Creates an empty brief ready for editing. */
export function createEmptyBrief(title = ''): EventBrief {
  return {
    schemaVersion: SCHEMA_VERSION,
    project: createEmptyProject(title),
    blocks: [],
    assets: [],
  }
}
