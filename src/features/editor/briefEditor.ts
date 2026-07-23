/**
 * Brief editor state — the single source of truth for the UI (WORK_PLAN §5).
 *
 * Pure and framework-free so it can be unit-tested and later ported into GODO
 * AI OS. The canonical editable data stays in one `EventBrief`; the UI never
 * keeps a duplicate block array or an edited copy of `designSummary`
 * (WORK_PLAN Phase 2 §5). Derived views come from the existing summaryBuilder.
 */

import { createBlock, createEmptyBrief } from '../../domain/factory'
import type { AiVisibility, BlockType } from '../../domain/blockTypes'
import type {
  BlockImageMeta,
  BriefBlock,
  BriefBlock as Block,
  EventBrief,
  LayoutHint,
} from '../../domain/briefSchema'
import { DEFAULT_CANVAS_HEIGHT, DEFAULT_CANVAS_WIDTH } from '../../domain/briefSchema'

/** Default title so a fresh brief still passes validation (needs a title). */
export const DEFAULT_BRIEF_TITLE = '새 기획서'

export interface EditorState {
  brief: EventBrief
  selectedBlockId: string | null
}

/**
 * Editable common fields exposed by the properties panel. Only fields that
 * already exist in the Phase 1 schema — no new domain fields are introduced
 * (WORK_PLAN §3 Properties, §5).
 */
export interface BlockPatch {
  label?: string
  content?: string
  required?: boolean
  priority?: Block['priority']
  aiVisibility?: AiVisibility
  notes?: string
  layoutHint?: Partial<LayoutHint>
  image?: Partial<BlockImageMeta>
}

export type EditorAction =
  | { type: 'ADD_BLOCK'; blockType: BlockType }
  | { type: 'SELECT_BLOCK'; blockId: string | null }
  | { type: 'DELETE_BLOCK'; blockId: string }
  | { type: 'UPDATE_BLOCK'; blockId: string; patch: BlockPatch }
  | { type: 'NEW_BRIEF' }

/** Builds the initial editor state (also used by "새로 만들기"). */
export function createInitialEditorState(): EditorState {
  return { brief: createEmptyBrief(DEFAULT_BRIEF_TITLE), selectedBlockId: null }
}

const NEW_BLOCK_WIDTH = 320
const NEW_BLOCK_HEIGHT = 96
const PLACEMENT_MARGIN = 24

/**
 * Picks a non-overlapping position for a new block by stacking it below the
 * lowest existing block. Position is only ever a *soft hint* (WORK_PLAN §3.2);
 * this just keeps freshly-created cards from landing on top of each other.
 */
export function nextBlockPosition(
  blocks: readonly BriefBlock[],
  canvasWidth = DEFAULT_CANVAS_WIDTH,
  canvasHeight = DEFAULT_CANVAS_HEIGHT,
): { x: number; y: number } {
  const x = PLACEMENT_MARGIN
  if (blocks.length === 0) return { x, y: PLACEMENT_MARGIN }

  const lowestBottom = blocks.reduce(
    (max, b) => Math.max(max, b.position.y + b.position.height),
    0,
  )
  let y = lowestBottom + PLACEMENT_MARGIN

  // Wrap back to the top if we would fall off the canvas, so the block stays
  // visible; the user re-positions later in Phase 3.
  if (y + NEW_BLOCK_HEIGHT > canvasHeight) {
    y = PLACEMENT_MARGIN
  }
  // Keep x within the canvas as a defensive clamp.
  return { x: Math.min(x, Math.max(0, canvasWidth - NEW_BLOCK_WIDTH)), y }
}

function addBlock(state: EditorState, blockType: BlockType): EditorState {
  const { brief } = state
  const position = nextBlockPosition(
    brief.blocks,
    brief.project.canvasWidth,
    brief.project.canvasHeight,
  )
  const block = createBlock(blockType, {
    position: { ...position, width: NEW_BLOCK_WIDTH, height: NEW_BLOCK_HEIGHT },
  })
  return {
    brief: { ...brief, blocks: [...brief.blocks, block] },
    selectedBlockId: block.id,
  }
}

function applyPatch(block: BriefBlock, patch: BlockPatch): BriefBlock {
  // Build a new block, only assigning fields present in the patch so the
  // result stays compatible with exactOptionalPropertyTypes.
  const next: BriefBlock = {
    ...block,
    position: { ...block.position },
    layoutHint: { ...block.layoutHint },
  }
  if (patch.label !== undefined) next.label = patch.label
  if (patch.content !== undefined) next.content = patch.content
  if (patch.required !== undefined) next.required = patch.required
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.aiVisibility !== undefined) next.aiVisibility = patch.aiVisibility
  if (patch.notes !== undefined) next.notes = patch.notes
  if (patch.layoutHint) next.layoutHint = { ...next.layoutHint, ...patch.layoutHint }
  if (patch.image) next.image = { ...next.image, ...patch.image }
  return next
}

function updateBlock(state: EditorState, blockId: string, patch: BlockPatch): EditorState {
  return {
    ...state,
    brief: {
      ...state.brief,
      blocks: state.brief.blocks.map((b) => (b.id === blockId ? applyPatch(b, patch) : b)),
    },
  }
}

function deleteBlock(state: EditorState, blockId: string): EditorState {
  return {
    brief: { ...state.brief, blocks: state.brief.blocks.filter((b) => b.id !== blockId) },
    selectedBlockId: state.selectedBlockId === blockId ? null : state.selectedBlockId,
  }
}

/** Pure reducer for all editor transitions. */
export function briefReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'ADD_BLOCK':
      return addBlock(state, action.blockType)
    case 'SELECT_BLOCK':
      return { ...state, selectedBlockId: action.blockId }
    case 'DELETE_BLOCK':
      return deleteBlock(state, action.blockId)
    case 'UPDATE_BLOCK':
      return updateBlock(state, action.blockId, action.patch)
    case 'NEW_BRIEF':
      return createInitialEditorState()
    default:
      return state
  }
}

/** Convenience selector for the currently-selected block. */
export function selectedBlock(state: EditorState): BriefBlock | null {
  if (state.selectedBlockId === null) return null
  return state.brief.blocks.find((b) => b.id === state.selectedBlockId) ?? null
}
