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
import { getBlockTypeMeta, type AiVisibility, type BlockType } from '../../domain/blockTypes'
import type {
  Asset,
  BlockImageMeta,
  BriefBlock,
  EventBrief,
  LayoutHint,
} from '../../domain/briefSchema'
import { DEFAULT_CANVAS_HEIGHT, DEFAULT_CANVAS_WIDTH } from '../../domain/briefSchema'
import {
  LINK_TYPE_FOR,
  LINK_URL_TYPE,
  NEW_IMAGE_BLOCK_HEIGHT,
  SIMPLE_BLOCK_TYPE,
  drawsBareText,
  findLinkPartner,
  textAlignOf,
  type TextAlign,
  isPairedLinkUrl,
  withLinkPartners,
} from '../../domain/simpleBlocks'
import { CARD_CHROME_Y, CARD_PADDING_X, emphasisForBlockSize, fitBlockToText, fitTextSize } from '../../domain/textFit'
import { reorderBlocks, type LayerMove } from '../../domain/layerOrder'
import { boundedDelta, clampCanvasHeight, clampPosition, freeDelta, type Rect } from './canvasGeometry'

/** Default title so a fresh brief still passes validation (needs a title). */
export const DEFAULT_BRIEF_TITLE = '새 기획서'

export interface EditorState {
  brief: EventBrief
  /** Selection order; the last id is the "primary" block shown in the inspector. */
  selectedIds: string[]
  /**
   * 블록을 캔버스 밖으로 내보낼 수 있는가 (배경 합성 1차 §3.2).
   *
   * 작업판에서만 참이다. 작성기의 캔버스는 "이 기획서가 요구하는 자리"를 그리는
   * 곳이라 밖으로 나간 좌표에 뜻이 없지만, 작업판의 캔버스는 실제로 출력되는
   * 사각형이라 밖으로 걸치는 배치가 곧 크롭이다.
   *
   * 상태에 두는 이유는 리듀서가 표면을 알 필요 없이 한 값만 읽으면 되기
   * 때문이다. 이 값 자체는 문서가 아니므로 저장되지도, 파일에 실리지도 않는다.
   */
  freePlacement?: boolean
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
  | { type: 'ADD_BLOCK'; blockType: BlockType; label?: string }
  | { type: 'ADD_BUTTON_LINK'; label: string }
  | { type: 'SET_BLOCK_LINK'; blockId: string; url: string }
  | { type: 'SELECT_BLOCK'; blockId: string | null; additive?: boolean }
  | { type: 'DELETE_BLOCK'; blockId: string }
  | { type: 'DELETE_SELECTED' }
  | { type: 'UPDATE_BLOCK'; blockId: string; patch: BlockPatch; coalesceKey?: string }
  | { type: 'COMMIT_TEXT'; blockId: string; content: string; rect?: Rect }
  | { type: 'MOVE_BLOCK'; blockId: string; x: number; y: number; coalesceKey?: string }
  | { type: 'RESIZE_BLOCK'; blockId: string; rect: Rect; coalesceKey?: string }
  | { type: 'DUPLICATE_BLOCK'; blockId: string }
  | { type: 'DUPLICATE_SELECTED' }
  | { type: 'GROUP_SELECTED' }
  | { type: 'UNGROUP_SELECTED' }
  | { type: 'ASSIGN_IMAGE'; blockId: string; asset: Asset; image?: Partial<BlockImageMeta> }
  | { type: 'ADD_IMAGE_BLOCK'; asset: Asset; position?: { x: number; y: number }; blockType?: BlockType; image?: Partial<BlockImageMeta> }
  | { type: 'REMOVE_BLOCK_ASSET'; blockId: string }
  | { type: 'SET_PROJECT_TITLE'; title: string; coalesceKey?: string }
  | { type: 'SET_CANVAS_HEIGHT'; height: number; coalesceKey?: string }
  | { type: 'SET_TEXT_ALIGN'; blockId: string; align: TextAlign }
  | { type: 'REORDER_BLOCK'; blockId: string; move: LayerMove }
  | { type: 'NEW_BRIEF' }

/** Builds the initial editor state (also used by "새로 만들기"). */
export function createInitialEditorState(freePlacement = false): EditorState {
  return {
    brief: createEmptyBrief(DEFAULT_BRIEF_TITLE),
    selectedIds: [],
    ...(freePlacement ? { freePlacement: true } : {}),
  }
}

const NEW_BLOCK_WIDTH = 320
const NEW_BLOCK_HEIGHT = 96

/**
 * A new block's box. Wording starts at the modest text height; a block that
 * will hold a picture starts tall enough to show one (1-B 마감 §1).
 */
function newBlockHeight(blockType: BlockType): number {
  return getBlockTypeMeta(blockType).requiresAsset ? NEW_IMAGE_BLOCK_HEIGHT : NEW_BLOCK_HEIGHT
}
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
  // Horizontally centred so a new block lands somewhere obvious, then stacked
  // below existing blocks so nothing is created on top of earlier work.
  const x = Math.max(0, Math.round((canvasWidth - NEW_BLOCK_WIDTH) / 2))
  if (blocks.length === 0) return { x, y: PLACEMENT_MARGIN }
  const lowestBottom = blocks.reduce((max, b) => Math.max(max, b.position.y + b.position.height), 0)
  let y = lowestBottom + PLACEMENT_MARGIN
  if (y + NEW_BLOCK_HEIGHT > canvasHeight) y = PLACEMENT_MARGIN
  return { x, y }
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

function addBlock(state: EditorState, blockType: BlockType, label?: string): EditorState {
  const { brief } = state
  const position = nextBlockPosition(brief.blocks, brief.project.canvasWidth, brief.project.canvasHeight)
  const block = createBlock(blockType, {
    position: { ...position, width: NEW_BLOCK_WIDTH, height: newBlockHeight(blockType) },
    ...(label === undefined ? {} : { label }),
  })
  return { brief: { ...brief, blocks: [...brief.blocks, block] }, selectedIds: [block.id] }
}

/**
 * Creates a 버튼·링크: one visible design `cta_button` plus its publishing
 * `button_url`, linked by a shared `groupId`. Both are created in a single
 * action so one undo removes the pair, and the URL stays in a publishing block
 * so it never reaches the image AI.
 */
function addButtonLink(state: EditorState, buttonLabel: string): EditorState {
  const { brief } = state
  const position = nextBlockPosition(brief.blocks, brief.project.canvasWidth, brief.project.canvasHeight)
  const groupId = createId('lnk')

  const button = createBlock(SIMPLE_BLOCK_TYPE.buttonLink, {
    label: buttonLabel,
    groupId,
    position: { ...position, width: NEW_BLOCK_WIDTH, height: NEW_BLOCK_HEIGHT },
  })
  // The URL block is not drawn on the canvas (the pair shows as one card), but
  // it keeps a real position so it stays valid and exports unchanged.
  const url = createBlock(LINK_URL_TYPE, {
    label: `${buttonLabel} 연결 주소`,
    groupId,
    position: { ...position, width: NEW_BLOCK_WIDTH, height: NEW_BLOCK_HEIGHT },
  })

  return {
    brief: { ...brief, blocks: [...brief.blocks, button, url] },
    selectedIds: [button.id],
  }
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
    state.brief.blocks.map((b) => (b.id === blockId ? withDerivedEmphasis(applyPatch(b, patch)) : b)),
  )
}

/**
 * Commits wording typed inside a block and sheds the empty space left under it
 * (단계 1-A §3.3).
 *
 * A block starts at a default height, so a short line would otherwise leave a
 * tall box that says nothing about where the wording sits. Trimming only ever
 * shrinks: growing is the user's call, made by dragging a corner, which is also
 * how the type size is chosen. A block already too small keeps its 블록이 작아요
 * warning rather than being trimmed around illegible text.
 */
function commitText(state: EditorState, blockId: string, content: string, rect?: Rect): EditorState {
  const target = state.brief.blocks.find((b) => b.id === blockId)
  if (!target) return state
  const written = withDerivedEmphasis(applyPatch(target, { content }))

  if (!drawsBareText(written) || content.trim().length === 0) {
    return withBlocks(state, state.brief.blocks.map((b) => (b.id === blockId ? written : b)))
  }

  // The canvas can measure the wording with the real font, so when it hands a
  // settled box over, that box wins. Without one (tests, programmatic edits)
  // the estimate settles the box as well as it can.
  const settled =
    rect !== undefined
      ? { ...written.position, width: rect.width, height: rect.height }
      : (() => {
          const { width, height } = written.position
          const fit = fitTextSize(content, width, height)
          const box = fitBlockToText(content, { width, height })
          return fit.overflow ? written.position : { ...written.position, width: box.width, height: box.height }
        })()

  const next = withDerivedEmphasis({ ...written, position: settled })
  return withBlocks(state, state.brief.blocks.map((b) => (b.id === blockId ? next : b)))
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
  const bound = state.freePlacement === true ? freeDelta : boundedDelta
  const { dx, dy } = bound(
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

/**
 * Keeps `layoutHint.emphasis` equal to the emphasis the block's size actually
 * produces on screen (§2.2). The block type is never changed — a big block is
 * emphatic wording, not a headline; deciding the role stays the AI's job.
 */
function withDerivedEmphasis(block: BriefBlock): BriefBlock {
  if (!getBlockTypeMeta(block.type).hasText) return block
  // Measured over the same area the wording is drawn in: bare for printed
  // wording, card-sized for the kinds that keep a card.
  const area = drawsBareText(block) ? {} : { padX: CARD_PADDING_X, padY: CARD_CHROME_Y }
  const emphasis = emphasisForBlockSize(block.content ?? '', block.position.width, block.position.height, area)
  if (block.layoutHint.emphasis === emphasis) return block
  return { ...block, layoutHint: { ...block.layoutHint, emphasis } }
}

function resizeBlock(state: EditorState, blockId: string, rect: Rect): EditorState {
  const pos =
    state.freePlacement === true
      ? { x: rect.x, y: rect.y }
      : clampPosition(rect, state.brief.project.canvasWidth, state.brief.project.canvasHeight)
  return withBlocks(
    state,
    state.brief.blocks.map((b) =>
      b.id === blockId
        ? withDerivedEmphasis({
            ...b,
            position: { x: pos.x, y: pos.y, width: rect.width, height: rect.height },
          })
        : b,
    ),
  )
}

/**
 * Attaches, updates, or clears the URL of a link-capable block (버튼, 이미지).
 *
 * The URL lives in a paired publishing block so it never reaches the image AI.
 * Creating the pair, editing it, and removing it are each a single action, so
 * one undo covers the whole thing.
 */
function setBlockLink(state: EditorState, blockId: string, url: string): EditorState {
  const block = state.brief.blocks.find((b) => b.id === blockId)
  if (!block) return state
  const linkType = LINK_TYPE_FOR[block.type]
  if (linkType === undefined) return state

  const partner = findLinkPartner(state.brief.blocks, block)
  const trimmed = url.trim()

  if (partner) {
    if (trimmed.length === 0) {
      // Clearing the URL removes the publishing block entirely.
      return withBlocks(state, state.brief.blocks.filter((b) => b.id !== partner.id))
    }
    return withBlocks(
      state,
      state.brief.blocks.map((b) => (b.id === partner.id ? { ...b, content: trimmed } : b)),
    )
  }

  if (trimmed.length === 0) return state

  // No partner yet: pair the block with a fresh publishing link block. If the
  // block belonged to a user-made group, it leaves that group so the pair stays
  // unambiguous; the other members keep their grouping.
  const groupId = createId('lnk')
  const link = createBlock(linkType, {
    label: `${block.label} 연결 주소`,
    groupId,
    content: trimmed,
    position: { ...block.position },
  })
  return withBlocks(
    state,
    [...state.brief.blocks.map((b) => (b.id === blockId ? { ...b, groupId } : b)), link],
  )
}

function duplicateBlock(state: EditorState, blockId: string): EditorState {
  const src = state.brief.blocks.find((b) => b.id === blockId)
  if (!src) return state

  // Duplicating one half of a 버튼·링크 must produce a whole new pair, so hand
  // off to the multi-block path (which remaps group ids).
  if (findLinkPartner(state.brief.blocks, src) !== undefined) {
    return duplicateSelected({ ...state, selectedIds: [blockId] })
  }

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

/**
 * Duplicates every selected block with fresh ids, offset from the originals.
 * Grouping among the selected set is preserved (group ids are remapped), and
 * the clones become the new selection. Used by the multi-select 복제 action.
 */
function duplicateSelected(state: EditorState): EditorState {
  // Include the URL half of any selected 버튼·링크 so the copy is a full pair.
  const ids = withLinkPartners(state.brief.blocks, new Set(state.selectedIds))
  if (ids.size === 0) return state
  const canvasW = state.brief.project.canvasWidth
  const canvasH = state.brief.project.canvasHeight
  const groupMap = new Map<string, string>()
  const clones: BriefBlock[] = []

  for (const src of state.brief.blocks) {
    if (!ids.has(src.id)) continue
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
    if (src.groupId !== undefined) {
      let g = groupMap.get(src.groupId)
      if (g === undefined) {
        g = createId('grp')
        groupMap.set(src.groupId, g)
      }
      clone.groupId = g
    } else {
      delete clone.groupId
    }
    clones.push(clone)
  }

  if (clones.length === 0) return state
  const blocks = [...state.brief.blocks, ...clones]
  // Never select the hidden URL half of a pair — it has no card to act on, and
  // selecting it would make one 버튼·링크 look like a multi-selection.
  const selectable = clones.filter((c) => !isPairedLinkUrl(blocks, c))
  return {
    brief: { ...state.brief, blocks },
    selectedIds: (selectable.length > 0 ? selectable : clones).map((c) => c.id),
  }
}

function deleteBlocks(state: EditorState, ids: Set<string>): EditorState {
  // A 버튼·링크 is one thing to the user, so deleting the visible button also
  // removes its paired URL block.
  const all = withLinkPartners(state.brief.blocks, ids)
  return {
    brief: { ...state.brief, blocks: state.brief.blocks.filter((b) => !all.has(b.id)) },
    selectedIds: state.selectedIds.filter((id) => !all.has(id)),
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

function upsertAsset(assets: Asset[], asset: Asset): Asset[] {
  const idx = assets.findIndex((a) => a.id === asset.id)
  if (idx === -1) return [...assets, asset]
  const next = assets.slice()
  next[idx] = asset
  return next
}

/** Drops an asset from the list if no block references it (keeps metadata tidy). */
function pruneOrphanAsset(assets: Asset[], blocks: BriefBlock[], assetId: string | undefined): Asset[] {
  if (assetId === undefined) return assets
  const stillUsed = blocks.some((b) => b.assetId === assetId)
  return stillUsed ? assets : assets.filter((a) => a.id !== assetId)
}

function assignImage(
  state: EditorState,
  blockId: string,
  asset: Asset,
  image: Partial<BlockImageMeta> | undefined,
): EditorState {
  const target = state.brief.blocks.find((b) => b.id === blockId)
  if (!target) return state
  const previousAssetId = target.assetId

  const blocks = state.brief.blocks.map((b) => {
    if (b.id !== blockId) return b
    const next: BriefBlock = { ...b, assetId: asset.id }
    if (image) next.image = { ...next.image, ...image }
    return next
  })

  let assets = upsertAsset(state.brief.assets, asset)
  if (previousAssetId !== undefined && previousAssetId !== asset.id) {
    assets = pruneOrphanAsset(assets, blocks, previousAssetId)
  }
  return { ...state, brief: { ...state.brief, blocks, assets } }
}

function addImageBlock(
  state: EditorState,
  asset: Asset,
  blockType: BlockType,
  position: { x: number; y: number } | undefined,
  image: Partial<BlockImageMeta> | undefined,
): EditorState {
  const { brief } = state
  const base = position ?? nextBlockPosition(brief.blocks, brief.project.canvasWidth, brief.project.canvasHeight)
  const height = newBlockHeight(blockType)
  const pos = clampPosition(
    { x: base.x, y: base.y, width: NEW_BLOCK_WIDTH, height },
    brief.project.canvasWidth,
    brief.project.canvasHeight,
  )
  const block = createBlock(blockType, {
    assetId: asset.id,
    position: { x: pos.x, y: pos.y, width: NEW_BLOCK_WIDTH, height },
  })
  if (image) block.image = { ...block.image, ...image }

  return {
    brief: { ...brief, blocks: [...brief.blocks, block], assets: upsertAsset(brief.assets, asset) },
    selectedIds: [block.id],
  }
}

/**
 * Takes the attached picture off a block, and with it everything that only
 * described *that file* (1-B 마감 §2): the id, the file's display name, and the
 * reference-capture marker. Leaving those behind would let a later reader — a
 * person or the image AI reading `imageSlots` — believe a capture is still
 * attached. What the planner wrote, where the block sits, and the link it
 * carries are untouched, and the previous state is left intact for undo.
 */
function removeBlockAsset(state: EditorState, blockId: string): EditorState {
  const target = state.brief.blocks.find((b) => b.id === blockId)
  if (!target || target.assetId === undefined) return state
  const removedId = target.assetId

  const blocks = state.brief.blocks.map((b) => {
    if (b.id !== blockId) return b
    const next = { ...b }
    delete next.assetId
    if (next.image) {
      const { productName: _name, referenceOnly: _ref, ...rest } = next.image
      // `allowTransform` is an instruction about the image that belongs here,
      // not about the file that was attached, so it stays.
      if (Object.keys(rest).length > 0) next.image = rest
      else delete next.image
    }
    return next
  })
  const assets = pruneOrphanAsset(state.brief.assets, blocks, removedId)
  return { ...state, brief: { ...state.brief, blocks, assets } }
}

/**
 * Sets how the wording sits inside its block (v1 마감 §3.2).
 *
 * The choice is written to the existing `layoutHint.alignment`, so it reaches
 * the AI through the layout hints already being sent rather than through a
 * second field meaning the same thing. Nothing about the block's position or
 * size changes — alignment says where the wording sits *within* the box the
 * planner drew.
 */
function setTextAlign(state: EditorState, blockId: string, align: TextAlign): EditorState {
  const target = state.brief.blocks.find((b) => b.id === blockId)
  if (!target || textAlignOf(target) === align) return state
  const next = { ...target, layoutHint: { ...target.layoutHint, alignment: align } }
  return withBlocks(state, state.brief.blocks.map((b) => (b.id === blockId ? next : b)))
}

/**
 * Sets how long this page is (손검수 2 §3). The width stays 840; only the page
 * the user is looking at changes, and the document's sync writes it back to
 * that page alone.
 *
 * The page never shrinks past the wording already on it: the lowest block plus
 * a margin is the floor, so nothing is left outside the canvas.
 */
function setCanvasHeight(state: EditorState, height: number): EditorState {
  // 자유 배치에서는 캔버스 아래로 내려 둔 블록이 의도한 크롭이다. 그것을 바닥으로
  // 삼으면 페이지를 다시 줄일 수 없게 된다.
  const clamped = clampCanvasHeight(height, state.freePlacement === true ? [] : state.brief.blocks)
  if (clamped === state.brief.project.canvasHeight) return state
  return { ...state, brief: { ...state.brief, project: { ...state.brief.project, canvasHeight: clamped } } }
}

/**
 * Sets the project title — the single source of truth for the name shown in the
 * top bar, the briefs list, and the gate (WORK_PLAN §7.1). Editing coalesces
 * into one undo step via the history wrapper.
 */
function setProjectTitle(state: EditorState, title: string): EditorState {
  if (state.brief.project.title === title) return state
  return { ...state, brief: { ...state.brief, project: { ...state.brief.project, title } } }
}

/**
 * 레이어 순서를 한 걸음 옮긴다 (§4).
 *
 * 옮길 것이 없으면 상태를 그대로 돌려주므로, 끝에 닿은 블록에 같은 버튼을 몇 번
 * 더 눌러도 실행취소 이력에 빈 걸음이 쌓이지 않는다.
 */
function reorderBlock(state: EditorState, blockId: string, move: LayerMove): EditorState {
  const blocks = reorderBlocks(state.brief.blocks, blockId, move)
  if (blocks === state.brief.blocks) return state
  return withBlocks(state, blocks as BriefBlock[])
}

/** Pure reducer for all single-step editor transitions. */
export function briefReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'ADD_BLOCK':
      return addBlock(state, action.blockType, action.label)
    case 'ADD_BUTTON_LINK':
      return addButtonLink(state, action.label)
    case 'SET_BLOCK_LINK':
      return setBlockLink(state, action.blockId, action.url)
    case 'SELECT_BLOCK':
      return selectBlock(state, action.blockId, action.additive ?? false)
    case 'DELETE_BLOCK':
      return deleteBlocks(state, new Set([action.blockId]))
    case 'DELETE_SELECTED':
      return state.selectedIds.length > 0 ? deleteBlocks(state, new Set(state.selectedIds)) : state
    case 'UPDATE_BLOCK':
      return updateBlock(state, action.blockId, action.patch)
    case 'COMMIT_TEXT':
      return commitText(state, action.blockId, action.content, action.rect)
    case 'MOVE_BLOCK':
      return moveBlock(state, action.blockId, action.x, action.y)
    case 'RESIZE_BLOCK':
      return resizeBlock(state, action.blockId, action.rect)
    case 'DUPLICATE_BLOCK':
      return duplicateBlock(state, action.blockId)
    case 'DUPLICATE_SELECTED':
      return duplicateSelected(state)
    case 'GROUP_SELECTED':
      return groupSelected(state)
    case 'UNGROUP_SELECTED':
      return ungroupSelected(state)
    case 'ASSIGN_IMAGE':
      return assignImage(state, action.blockId, action.asset, action.image)
    case 'ADD_IMAGE_BLOCK':
      return addImageBlock(state, action.asset, action.blockType ?? 'main_product_image', action.position, action.image)
    case 'REMOVE_BLOCK_ASSET':
      return removeBlockAsset(state, action.blockId)
    case 'SET_PROJECT_TITLE':
      return setProjectTitle(state, action.title)
    case 'SET_TEXT_ALIGN':
      return setTextAlign(state, action.blockId, action.align)
    case 'REORDER_BLOCK':
      return reorderBlock(state, action.blockId, action.move)
    case 'SET_CANVAS_HEIGHT':
      return setCanvasHeight(state, action.height)
    case 'NEW_BRIEF':
      return createInitialEditorState(state.freePlacement === true)
    default:
      return state
  }
}
