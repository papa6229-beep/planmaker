/**
 * React binding for the pure brief editor. Wraps the history reducer (undo/redo)
 * and exposes editor state plus typed action helpers through context, so the
 * 3-column UI can read/update the single EventBrief without prop-drilling. Uses
 * only React's built-in state (WORK_PLAN §5 — no external state library).
 */

import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react'
import type { BlockType } from '../../domain/blockTypes'
import type { Asset, BlockImageMeta, BriefBlock, EventBrief } from '../../domain/briefSchema'
import {
  primarySelectedId,
  selectedBlock,
  selectedBlocks,
  type BlockPatch,
  type EditorState,
} from './briefEditor'
import {
  canRedo,
  canUndo,
  createInitialHistoryState,
  historyReducer,
} from './history'
import type { Rect } from './canvasGeometry'

export interface BriefEditorApi {
  state: EditorState
  selectedIds: string[]
  primaryId: string | null
  selected: BriefBlock | null
  selectedBlocks: BriefBlock[]
  canUndo: boolean
  canRedo: boolean
  addBlock: (blockType: BlockType, label?: string) => void
  /** Creates a 버튼·링크: paired design button + publishing URL block. */
  addButtonLink: (label: string) => void
  /** Sets (or clears, when empty) the publishing URL attached to a block. */
  setBlockLink: (blockId: string, url: string) => void
  selectBlock: (blockId: string | null, additive?: boolean) => void
  deleteBlock: (blockId: string) => void
  deleteSelected: () => void
  updateBlock: (blockId: string, patch: BlockPatch, coalesceKey?: string) => void
  /**
   * Commits wording typed inside a block: stores it and trims the empty space
   * left under it, as one undo step (단계 1-A §3.3).
   */
  commitText: (blockId: string, content: string, rect?: Rect) => void
  moveBlock: (blockId: string, x: number, y: number, coalesceKey?: string) => void
  resizeBlock: (blockId: string, rect: Rect, coalesceKey?: string) => void
  duplicateBlock: (blockId: string) => void
  duplicateSelected: () => void
  groupSelected: () => void
  ungroupSelected: () => void
  assignImage: (blockId: string, asset: Asset, image?: Partial<BlockImageMeta>) => void
  addImageBlock: (asset: Asset, position?: { x: number; y: number }, image?: Partial<BlockImageMeta>) => void
  removeBlockAsset: (blockId: string) => void
  setProjectTitle: (title: string, coalesceKey?: string) => void
  /** Sets the open page's length; one drag collapses into one undo step. */
  setCanvasHeight: (height: number, coalesceKey?: string) => void
  hydrate: (brief: EventBrief) => void
  newBrief: () => void
  undo: () => void
  redo: () => void
  endInteraction: () => void
}

const BriefEditorContext = createContext<BriefEditorApi | null>(null)

export function BriefEditorProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(historyReducer, undefined, createInitialHistoryState)
  const state = history.present

  const api = useMemo<BriefEditorApi>(
    () => ({
      state,
      selectedIds: state.selectedIds,
      primaryId: primarySelectedId(state),
      selected: selectedBlock(state),
      selectedBlocks: selectedBlocks(state),
      canUndo: canUndo(history),
      canRedo: canRedo(history),
      addBlock: (blockType, label) =>
        dispatch(label === undefined ? { type: 'ADD_BLOCK', blockType } : { type: 'ADD_BLOCK', blockType, label }),
      addButtonLink: (label) => dispatch({ type: 'ADD_BUTTON_LINK', label }),
      setBlockLink: (blockId, url) => dispatch({ type: 'SET_BLOCK_LINK', blockId, url }),
      selectBlock: (blockId, additive = false) => dispatch({ type: 'SELECT_BLOCK', blockId, additive }),
      deleteBlock: (blockId) => dispatch({ type: 'DELETE_BLOCK', blockId }),
      deleteSelected: () => dispatch({ type: 'DELETE_SELECTED' }),
      updateBlock: (blockId, patch, coalesceKey) =>
        dispatch(coalesceKey === undefined
          ? { type: 'UPDATE_BLOCK', blockId, patch }
          : { type: 'UPDATE_BLOCK', blockId, patch, coalesceKey }),
      commitText: (blockId, content, rect) =>
        dispatch(rect === undefined
          ? { type: 'COMMIT_TEXT', blockId, content }
          : { type: 'COMMIT_TEXT', blockId, content, rect }),
      moveBlock: (blockId, x, y, coalesceKey) =>
        dispatch(coalesceKey === undefined
          ? { type: 'MOVE_BLOCK', blockId, x, y }
          : { type: 'MOVE_BLOCK', blockId, x, y, coalesceKey }),
      resizeBlock: (blockId, rect, coalesceKey) =>
        dispatch(coalesceKey === undefined
          ? { type: 'RESIZE_BLOCK', blockId, rect }
          : { type: 'RESIZE_BLOCK', blockId, rect, coalesceKey }),
      duplicateBlock: (blockId) => dispatch({ type: 'DUPLICATE_BLOCK', blockId }),
      duplicateSelected: () => dispatch({ type: 'DUPLICATE_SELECTED' }),
      groupSelected: () => dispatch({ type: 'GROUP_SELECTED' }),
      ungroupSelected: () => dispatch({ type: 'UNGROUP_SELECTED' }),
      assignImage: (blockId, asset, image) =>
        dispatch(image === undefined
          ? { type: 'ASSIGN_IMAGE', blockId, asset }
          : { type: 'ASSIGN_IMAGE', blockId, asset, image }),
      addImageBlock: (asset, position, image) =>
        dispatch({ type: 'ADD_IMAGE_BLOCK', asset, ...(position ? { position } : {}), ...(image ? { image } : {}) }),
      removeBlockAsset: (blockId) => dispatch({ type: 'REMOVE_BLOCK_ASSET', blockId }),
      setProjectTitle: (title, coalesceKey) =>
        dispatch(coalesceKey === undefined
          ? { type: 'SET_PROJECT_TITLE', title }
          : { type: 'SET_PROJECT_TITLE', title, coalesceKey }),
      setCanvasHeight: (height, coalesceKey) =>
        dispatch(coalesceKey === undefined
          ? { type: 'SET_CANVAS_HEIGHT', height }
          : { type: 'SET_CANVAS_HEIGHT', height, coalesceKey }),
      hydrate: (brief) => dispatch({ type: 'HYDRATE', brief }),
      newBrief: () => dispatch({ type: 'NEW_BRIEF' }),
      undo: () => dispatch({ type: 'UNDO' }),
      redo: () => dispatch({ type: 'REDO' }),
      endInteraction: () => dispatch({ type: 'END_INTERACTION' }),
    }),
    [state, history],
  )

  return <BriefEditorContext.Provider value={api}>{children}</BriefEditorContext.Provider>
}

export function useBriefEditor(): BriefEditorApi {
  const api = useContext(BriefEditorContext)
  if (api === null) {
    throw new Error('useBriefEditor must be used within a BriefEditorProvider')
  }
  return api
}
