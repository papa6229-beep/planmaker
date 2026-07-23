/**
 * React binding for the pure brief editor reducer. Provides editor state and
 * a small set of typed action helpers through context so the 3-column UI can
 * read/update the single EventBrief without prop-drilling. Uses only React's
 * built-in state (WORK_PLAN §5 — no external state library at this scale).
 */

import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react'
import type { BlockType } from '../../domain/blockTypes'
import {
  briefReducer,
  createInitialEditorState,
  selectedBlock,
  type BlockPatch,
  type EditorState,
} from './briefEditor'
import type { BriefBlock } from '../../domain/briefSchema'

export interface BriefEditorApi {
  state: EditorState
  selected: BriefBlock | null
  addBlock: (blockType: BlockType) => void
  selectBlock: (blockId: string | null) => void
  deleteBlock: (blockId: string) => void
  updateBlock: (blockId: string, patch: BlockPatch) => void
  newBrief: () => void
}

const BriefEditorContext = createContext<BriefEditorApi | null>(null)

export function BriefEditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(briefReducer, undefined, createInitialEditorState)

  const api = useMemo<BriefEditorApi>(
    () => ({
      state,
      selected: selectedBlock(state),
      addBlock: (blockType) => dispatch({ type: 'ADD_BLOCK', blockType }),
      selectBlock: (blockId) => dispatch({ type: 'SELECT_BLOCK', blockId }),
      deleteBlock: (blockId) => dispatch({ type: 'DELETE_BLOCK', blockId }),
      updateBlock: (blockId, patch) => dispatch({ type: 'UPDATE_BLOCK', blockId, patch }),
      newBrief: () => dispatch({ type: 'NEW_BRIEF' }),
    }),
    [state],
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
