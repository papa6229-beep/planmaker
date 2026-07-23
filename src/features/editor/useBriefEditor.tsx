/**
 * React binding for the pure brief editor. Wraps the history reducer (undo/redo)
 * and exposes editor state plus typed action helpers through context, so the
 * 3-column UI can read/update the single EventBrief without prop-drilling. Uses
 * only React's built-in state (WORK_PLAN §5 — no external state library).
 */

import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react'
import type { BlockType } from '../../domain/blockTypes'
import type { BriefBlock } from '../../domain/briefSchema'
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
  addBlock: (blockType: BlockType) => void
  selectBlock: (blockId: string | null, additive?: boolean) => void
  deleteBlock: (blockId: string) => void
  deleteSelected: () => void
  updateBlock: (blockId: string, patch: BlockPatch, coalesceKey?: string) => void
  moveBlock: (blockId: string, x: number, y: number, coalesceKey?: string) => void
  resizeBlock: (blockId: string, rect: Rect, coalesceKey?: string) => void
  duplicateBlock: (blockId: string) => void
  groupSelected: () => void
  ungroupSelected: () => void
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
      addBlock: (blockType) => dispatch({ type: 'ADD_BLOCK', blockType }),
      selectBlock: (blockId, additive = false) => dispatch({ type: 'SELECT_BLOCK', blockId, additive }),
      deleteBlock: (blockId) => dispatch({ type: 'DELETE_BLOCK', blockId }),
      deleteSelected: () => dispatch({ type: 'DELETE_SELECTED' }),
      updateBlock: (blockId, patch, coalesceKey) =>
        dispatch(coalesceKey === undefined
          ? { type: 'UPDATE_BLOCK', blockId, patch }
          : { type: 'UPDATE_BLOCK', blockId, patch, coalesceKey }),
      moveBlock: (blockId, x, y, coalesceKey) =>
        dispatch(coalesceKey === undefined
          ? { type: 'MOVE_BLOCK', blockId, x, y }
          : { type: 'MOVE_BLOCK', blockId, x, y, coalesceKey }),
      resizeBlock: (blockId, rect, coalesceKey) =>
        dispatch(coalesceKey === undefined
          ? { type: 'RESIZE_BLOCK', blockId, rect }
          : { type: 'RESIZE_BLOCK', blockId, rect, coalesceKey }),
      duplicateBlock: (blockId) => dispatch({ type: 'DUPLICATE_BLOCK', blockId }),
      groupSelected: () => dispatch({ type: 'GROUP_SELECTED' }),
      ungroupSelected: () => dispatch({ type: 'UNGROUP_SELECTED' }),
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
