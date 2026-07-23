/**
 * Brief editor state — the single source of truth for the UI (WORK_PLAN §5).
 *
 * Pure and framework-free so it can be unit-tested and later ported into GODO
 * AI OS. The canonical editable data stays in one `EventBrief`; the UI never
 * keeps a duplicate block array or an edited copy of `designSummary`. Derived
 * views come from the existing summaryBuilder.
 *
 * Phase 3 adds canvas editing: multi-selection, move (group-aware), resize,
 * duplicate, and grouping. Undo/redo lives in the history wrapper (history.ts);
 * this reducer stays a pure single-step transition.
 */

import { createBlock, createEmptyBrief, createId } from '../../domain/factory'
import type { AiVisibility, BlockType } from '../../domain/blockTypes'
import type {
  BlockImageMeta,
  BriefBlock,
  EventBrief,
  LayoutHint,
} from '../../domain/briefSchema'
import { DEFAULT_CANVAS_HEIGHT, DEFAULT_CANVAS_WIDTH } from '../../domain/briefSchema'
import { boundedDelta, clampPosition, type Rect } from './canvasGeometry'

/** Default title so a fresh brief still passes validation (needs a title). */
export const DEFAULT_BRIEF_TITLE = '새 기획서'

export interface EditorState {
  brief: EventBrief
  /** Selection order; the last id is the "primary" block shown in the inspector. */
  selectedIds: string[]
}

/**
 * Editable common fields exposed by the properties panel. Only fields that
 * already exist in the Phase 1 schema — no new domain fields are introduced.
 */
export interface BlockPatch {
  label?: string
  content?: string
  required?: boolean
  priority?: BriefBlock['priority']
  aiVisibility?: AiVisibility
  notes?: string
  layoutHint?: Partial<LayoutHint>
  image?: Partial<BlockImageMeta>
}

export type EditorAction =
  | { type: 'ADD_BLOCK'; blockType: BlockType }
  | { type: 'SELECT_BLOCK'; blockId: string | null; additive?: boolean }
  | { type: 'DELETE_BLOCK'; blockId: string }
  | { type: 'DELETE_SELECTED' }
  | { type: 'UPDATE_BLOCK'; blockId: string; patch: BlockPatch; coalesceKey?: string }
  | { type: 'MOVE_BLOCK'; blockId: string; x: number; y: number; coalesceKey?: string }
  | { type: 'RESIZE_BLOCK'; blockId: string; rect: Rect; coalesceKey?: string }
  | { type: 'DUPLICATE_BLOCK'; blockId: string }
  | { type: 'GROUP_SELECTED' }
  | { type: 'UNGROUP_SELECTED' }
  | { type: 'NEW_BRIEF' }

/** Builds the initial editor state (also used by "새로 만들기"). */
export function createInitialEditorState(): EditorState {
  return { brief: createEmptyBrief(DEFAULT_BRIEF_TITLE), selectedIds: [] }
}

const NEW_BLOCK_WIDTH = 320
const NEW_BLOCK_HEIGHT = 96
const PLACEMENT_MARGIN = 24
const DUPLICATE_OFFSET = 24

/**
 * Picks a non-overlapping position for a new block by stacking it below the
 * lowest existing block. Position is only ever a *soft hint* (WORK_PLAN §3.2).
 */
export function nextBlockPosition(
  blocks: readonly BriefBlock[],
  canvasWidth = DEFAULT_CANVAS_WIDTH,
  canvasHeight = DEFAULT_CANVAS_HEIGHT,
): { x: number; y: number } {
  const x = PLACEMENT_MARGIN
  if (blocks.length === 0) return { x, y: PLACEMENT_MARGIN }
  const lowestBottom = blocks.reduce((max, b) => Math.max(max, b.position.y + b.position.height), 0)
  let y = lowestBottom + PLACEMENT_MARGIN
  if (y + NEW_BLOCK_HEIGHT > canvasHeight) y = PLACEMENT_MARGIN
  return { x: Math.min(x, Math.max(0, canvasWidth - NEW_BLOCK_WIDTH)), y }
}

// ── Selection helpers ────────────────────────────────────────────────────────

/** The primary (last-selected) block id, or null. */
export function primarySelectedId(state: EditorState): string | null {
  return state.selectedIds.length > 0 ? state.selectedIds[state.selectedIds.length - 1]! : null
}

/** The primary selected block, or null. */
export function selectedBlock(state: EditorState): BriefBlock | null {
  const id = primarySelectedId(state)
  if (id === null) return null
  return state.brief.blocks.find((b) => b.id === id) ?? null
}

/** All selected blocks, in canvas order. */
export function selectedBlocks(state: EditorState): BriefBlock[] {
  const set = new Set(state.selectedIds)
  return state.brief.blocks.filter((b) => set.has(b.id))
}

// ── Action handlers ──────────────────────────────────────────────────────────

function withBlocks(state: EditorState, blocks: BriefBlock[]): EditorState {
  return { ...state, brief: { ...state.brief, blocks } }
}

function addBlock(state: EditorState, blockType: BlockType): EditorState {
  const { brief } = state
  const position = nextBlockPosition(brief.blocks, brief.project.canvasWidth, brief.project.canvasHeight)
  const block = createBlock(blockType, {
    position: { ...position, width: NEW_BLOCK_WIDTH, height: NEW_BLOCK_HEIGHT },
  })
  return { brief: { ...brief, blocks: [...brief.blocks, block] }, selectedIds: [block.id] }
}

function selectBlock(state: EditorState, blockId: string | null, additive: boolean): EditorState {
  if (blockId === null) return { ...state, selectedIds: [] }
  if (!additive) return { ...state, selectedIds: [blockId] }
  // Toggle in additive mode; re-adding moves it to primary (end of list).
  const without = state.selectedIds.filter((id) => id !== blockId)
  return {
    ...state,
    selectedIds: without.length === state.selectedIds.length ? [...without, blockId] : without,
  }
}

function applyPatch(block: BriefBlock, patch: BlockPatch): BriefBlock {
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
  return withBlocks(
    state,
    state.brief.blocks.map((b) => (b.id === blockId ? applyPatch(b, patch) : b)),
  )
}

function moveBlock(state: EditorState, blockId: string, x: number, y: number): EditorState {
  const target = state.brief.blocks.find((b) => b.id === blockId)
  if (!target) return state

  // Move the whole group together when the block is grouped (WORK_PLAN §10).
  const members =
    target.groupId !== undefined
      ? state.brief.blocks.filter((b) => b.groupId === target.groupId)
      : [target]
  const memberIds = new Set(members.map((b) => b.id))

  const desiredDx = x - target.position.x
  const desiredDy = y - target.position.y
  const { dx, dy } = boundedDelta(
    members.map((b) => b.position),
    desiredDx,
    desiredDy,
    state.brief.project.canvasWidth,
    state.brief.project.canvasHeight,
  )
  if (dx === 0 && dy === 0) return state

  return withBlocks(
    state,
    state.brief.blocks.map((b) =>
      memberIds.has(b.id)
        ? { ...b, position: { ...b.position, x: b.position.x + dx, y: b.position.y + dy } }
        : b,
    ),
  )
}

function resizeBlock(state: EditorState, blockId: string, rect: Rect): EditorState {
  const pos = clampPosition(rect, state.brief.project.canvasWidth, state.brief.project.canvasHeight)
  return withBlocks(
    state,
    state.brief.blocks.map((b) =>
      b.id === blockId
        ? { ...b, position: { x: pos.x, y: pos.y, width: rect.width, height: rect.height } }
        : b,
    ),
  )
}

function duplicateBlock(state: EditorState, blockId: string): EditorState {
  const src = state.brief.blocks.find((b) => b.id === blockId)
  if (!src) return state

  const canvasW = state.brief.project.canvasWidth
  const canvasH = state.brief.project.canvasHeight
  const offset = clampPosition(
    { ...src.position, x: src.position.x + DUPLICATE_OFFSET, y: src.position.y + DUPLICATE_OFFSET },
    canvasW,
    canvasH,
  )

  const clone: BriefBlock = {
    ...src,
    id: createId(),
    position: { ...src.position, x: offset.x, y: offset.y },
    layoutHint: { ...src.layoutHint },
  }
  if (src.image) clone.image = { ...src.image }
  // A duplicate starts ungrouped so it doesn't silently join the source's group.
  delete clone.groupId

  return { brief: { ...state.brief, blocks: [...state.brief.blocks, clone] }, selectedIds: [clone.id] }
}

function deleteBlocks(state: EditorState, ids: Set<string>): EditorState {
  return {
    brief: { ...state.brief, blocks: state.brief.blocks.filter((b) => !ids.has(b.id)) },
    selectedIds: state.selectedIds.filter((id) => !ids.has(id)),
  }
}

function groupSelected(state: EditorState): EditorState {
  if (state.selectedIds.length < 2) return state
  const groupId = createId('grp')
  const selected = new Set(state.selectedIds)
  return withBlocks(
    state,
    state.brief.blocks.map((b) => (selected.has(b.id) ? { ...b, groupId } : b)),
  )
}

function ungroupSelected(state: EditorState): EditorState {
  const groupIds = new Set(
    selectedBlocks(state)
      .map((b) => b.groupId)
      .filter((g): g is string => g !== undefined),
  )
  if (groupIds.size === 0) return state
  return withBlocks(
    state,
    state.brief.blocks.map((b) => {
      if (b.groupId !== undefined && groupIds.has(b.groupId)) {
        const next = { ...b }
        delete next.groupId
        return next
      }
      return b
    }),
  )
}

/** Pure reducer for all single-step editor transitions. */
export function briefReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'ADD_BLOCK':
      return addBlock(state, action.blockType)
    case 'SELECT_BLOCK':
      return selectBlock(state, action.blockId, action.additive ?? false)
    case 'DELETE_BLOCK':
      return deleteBlocks(state, new Set([action.blockId]))
    case 'DELETE_SELECTED':
      return state.selectedIds.length > 0 ? deleteBlocks(state, new Set(state.selectedIds)) : state
    case 'UPDATE_BLOCK':
      return updateBlock(state, action.blockId, action.patch)
    case 'MOVE_BLOCK':
      return moveBlock(state, action.blockId, action.x, action.y)
    case 'RESIZE_BLOCK':
      return resizeBlock(state, action.blockId, action.rect)
    case 'DUPLICATE_BLOCK':
      return duplicateBlock(state, action.blockId)
    case 'GROUP_SELECTED':
      return groupSelected(state)
    case 'UNGROUP_SELECTED':
      return ungroupSelected(state)
    case 'NEW_BRIEF':
      return createInitialEditorState()
    default:
      return state
  }
}
