import { describe, it, expect } from 'vitest'
import {
  canRedo,
  canUndo,
  createInitialHistoryState,
  historyReducer,
  type HistoryState,
} from './history'

function addBlock(state: HistoryState, blockType: 'main_headline' | 'sub_headline' | 'benefit'): HistoryState {
  return historyReducer(state, { type: 'ADD_BLOCK', blockType })
}

describe('history — basic undo/redo', () => {
  it('undoes and redoes a block creation', () => {
    let h = createInitialHistoryState()
    expect(canUndo(h)).toBe(false)

    h = addBlock(h, 'main_headline')
    expect(h.present.brief.blocks).toHaveLength(1)
    expect(canUndo(h)).toBe(true)

    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.brief.blocks).toHaveLength(0)
    expect(canRedo(h)).toBe(true)

    h = historyReducer(h, { type: 'REDO' })
    expect(h.present.brief.blocks).toHaveLength(1)
  })
})

describe('history — selection is not undoable', () => {
  it('does not create a checkpoint for pure selection changes', () => {
    let h = addBlock(createInitialHistoryState(), 'main_headline')
    const depth = h.past.length
    const id = h.present.brief.blocks[0]!.id
    h = historyReducer(h, { type: 'SELECT_BLOCK', blockId: null })
    h = historyReducer(h, { type: 'SELECT_BLOCK', blockId: id })
    expect(h.past.length).toBe(depth)
  })
})

describe('history — gesture coalescing', () => {
  it('collapses a drag (same coalesceKey) into one undo step', () => {
    let h = addBlock(createInitialHistoryState(), 'main_headline')
    const id = h.present.brief.blocks[0]!.id
    const depthBefore = h.past.length

    const key = `move:${id}`
    for (let i = 1; i <= 5; i++) {
      h = historyReducer(h, { type: 'MOVE_BLOCK', blockId: id, x: 40 + i * 10, y: 40, coalesceKey: key })
    }
    // Only one checkpoint was created for the whole gesture.
    expect(h.past.length).toBe(depthBefore + 1)

    // One undo reverts the entire drag.
    const movedX = h.present.brief.blocks[0]!.position.x
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.brief.blocks[0]!.position.x).not.toBe(movedX)
  })

  it('starts a new undo step after END_INTERACTION', () => {
    let h = addBlock(createInitialHistoryState(), 'main_headline')
    const id = h.present.brief.blocks[0]!.id
    const key = `move:${id}`

    h = historyReducer(h, { type: 'MOVE_BLOCK', blockId: id, x: 100, y: 100, coalesceKey: key })
    const afterFirstGesture = h.past.length
    h = historyReducer(h, { type: 'END_INTERACTION' })
    h = historyReducer(h, { type: 'MOVE_BLOCK', blockId: id, x: 200, y: 200, coalesceKey: key })
    expect(h.past.length).toBe(afterFirstGesture + 1)
  })
})

describe('history — a new action clears the redo stack', () => {
  it('drops future states when a fresh edit happens after undo', () => {
    let h = addBlock(createInitialHistoryState(), 'main_headline')
    h = addBlock(h, 'benefit')
    h = historyReducer(h, { type: 'UNDO' })
    expect(canRedo(h)).toBe(true)
    h = addBlock(h, 'sub_headline')
    expect(canRedo(h)).toBe(false)
  })
})
