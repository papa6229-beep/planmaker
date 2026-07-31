/**
 * Undo/redo wrapper around the pure brief reducer (WORK_PLAN §19 Phase 3).
 *
 * Design notes:
 *  - Only changes to the *brief* create history entries. Pure selection changes
 *    (clicking around) never pollute undo.
 *  - Continuous gestures — a drag, a resize, a run of keystrokes in one field —
 *    carry a `coalesceKey` so they collapse into a single undo step. The first
 *    action of a gesture pushes one checkpoint; the rest replace the present in
 *    place. `END_INTERACTION` (pointer up / blur) closes the gesture.
 */

import {
  briefReducer,
  createInitialEditorState,
  type EditorAction,
  type EditorState,
} from './briefEditor'
import type { EventBrief } from '../../domain/briefSchema'

const HISTORY_LIMIT = 100

export interface HistoryState {
  past: EditorState[]
  present: EditorState
  future: EditorState[]
  /** Coalescing key of the in-progress gesture, if any. */
  lastCoalesceKey: string | null
}

export type HistoryAction =
  | EditorAction
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'END_INTERACTION' }
  | { type: 'HYDRATE'; brief: EventBrief }

export function createInitialHistoryState(): HistoryState {
  return { past: [], present: createInitialEditorState(), future: [], lastCoalesceKey: null }
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0
}

function coalesceKeyOf(action: EditorAction): string | null {
  if (
    (action.type === 'MOVE_BLOCK' ||
      action.type === 'RESIZE_BLOCK' ||
      action.type === 'UPDATE_BLOCK' ||
      action.type === 'SET_PROJECT_TITLE' ||
      action.type === 'SET_CANVAS_HEIGHT') &&
    action.coalesceKey !== undefined
  ) {
    return action.coalesceKey
  }
  return null
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'UNDO': {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]!
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        lastCoalesceKey: null,
      }
    }
    case 'REDO': {
      if (state.future.length === 0) return state
      const next = state.future[0]!
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        lastCoalesceKey: null,
      }
    }
    case 'END_INTERACTION':
      return state.lastCoalesceKey === null ? state : { ...state, lastCoalesceKey: null }
    case 'HYDRATE':
      // Restoring from storage establishes a fresh baseline (no undo across it).
      return {
        past: [],
        present: { brief: action.brief, selectedIds: [] },
        future: [],
        lastCoalesceKey: null,
      }
    default: {
      const next = briefReducer(state.present, action)
      if (next === state.present) return state

      // Selection-only change: update present, don't create a history entry.
      if (next.brief === state.present.brief) {
        return { ...state, present: next, lastCoalesceKey: null }
      }

      const key = coalesceKeyOf(action)
      // Continue an in-progress gesture: replace present without a new checkpoint.
      if (key !== null && key === state.lastCoalesceKey) {
        return { ...state, present: next }
      }

      const past = [...state.past, state.present]
      return {
        past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
        present: next,
        future: [],
        lastCoalesceKey: key,
      }
    }
  }
}
