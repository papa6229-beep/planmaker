import { describe, it, expect } from 'vitest'
import {
  briefReducer,
  createInitialEditorState,
  nextBlockPosition,
  selectedBlock,
  type EditorState,
} from './briefEditor'
import { validateBrief } from '../../domain/validation'
import { buildDesignSummary } from '../../domain/summaryBuilder'
import { getBlockTypeMeta } from '../../domain/blockTypes'

function addBlockOf(state: EditorState, blockType: Parameters<typeof getBlockTypeMeta>[0]): EditorState {
  return briefReducer(state, { type: 'ADD_BLOCK', blockType })
}

describe('createInitialEditorState', () => {
  it('starts with a titled brief, no blocks, no selection', () => {
    const state = createInitialEditorState()
    expect(state.brief.project.title.length).toBeGreaterThan(0)
    expect(state.brief.blocks).toEqual([])
    expect(state.selectedBlockId).toBeNull()
  })
})

describe('ADD_BLOCK', () => {
  it('creates a factory block with the type default visibility and auto-selects it', () => {
    const state = addBlockOf(createInitialEditorState(), 'main_headline')
    expect(state.brief.blocks).toHaveLength(1)
    const block = state.brief.blocks[0]!
    expect(block.type).toBe('main_headline')
    // Default visibility comes from the catalog, not hardcoded in the UI.
    expect(block.aiVisibility).toBe(getBlockTypeMeta('main_headline').defaultVisibility)
    expect(block.label).toBe(getBlockTypeMeta('main_headline').label)
    expect(state.selectedBlockId).toBe(block.id)
    expect(selectedBlock(state)).toBe(block)
  })

  it('places consecutive blocks without vertical overlap', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    state = addBlockOf(state, 'sub_headline')
    const [a, b] = state.brief.blocks
    expect(b!.position.y).toBeGreaterThanOrEqual(a!.position.y + a!.position.height)
  })

  it('gives reference blocks a non-design visibility', () => {
    const state = addBlockOf(createInitialEditorState(), 'button_url')
    expect(state.brief.blocks[0]!.aiVisibility).toBe('publishing')
  })
})

describe('SELECT_BLOCK', () => {
  it('changes the selection', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    const first = state.brief.blocks[0]!.id
    state = addBlockOf(state, 'benefit')
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: first })
    expect(state.selectedBlockId).toBe(first)
  })
})

describe('UPDATE_BLOCK', () => {
  it('patches editable fields and merges layoutHint / image', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_product_image')
    const id = state.brief.blocks[0]!.id
    state = briefReducer(state, {
      type: 'UPDATE_BLOCK',
      blockId: id,
      patch: { required: true, layoutHint: { region: 'top' }, image: { productName: '롬프 X' } },
    })
    const block = state.brief.blocks[0]!
    expect(block.required).toBe(true)
    expect(block.layoutHint.region).toBe('top')
    // Merge keeps the factory-set allowTransform.
    expect(block.image).toEqual({ allowTransform: true, productName: '롬프 X' })
  })
})

describe('DELETE_BLOCK', () => {
  it('removes the block and clears selection when it was selected', () => {
    const state = addBlockOf(createInitialEditorState(), 'main_headline')
    const id = state.brief.blocks[0]!.id
    const next = briefReducer(state, { type: 'DELETE_BLOCK', blockId: id })
    expect(next.brief.blocks).toHaveLength(0)
    expect(next.selectedBlockId).toBeNull()
  })
})

describe('NEW_BRIEF', () => {
  it('resets to the initial state', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    state = briefReducer(state, { type: 'NEW_BRIEF' })
    expect(state.brief.blocks).toEqual([])
    expect(state.selectedBlockId).toBeNull()
  })
})

describe('validation stays green through edits', () => {
  it('passes after adding then deleting blocks (title + a design block present)', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    state = addBlockOf(state, 'benefit')
    expect(validateBrief(state.brief).ok).toBe(true)

    const secondId = state.brief.blocks[1]!.id
    state = briefReducer(state, { type: 'DELETE_BLOCK', blockId: secondId })
    expect(validateBrief(state.brief).ok).toBe(true)
  })
})

describe('publishing separation still holds through the editor', () => {
  it('keeps a publishing URL out of the design summary', () => {
    let state = addBlockOf(createInitialEditorState(), 'cta_button')
    state = addBlockOf(state, 'button_url')
    const urlBlockId = state.brief.blocks[1]!.id
    state = briefReducer(state, {
      type: 'UPDATE_BLOCK',
      blockId: urlBlockId,
      patch: { content: 'https://shop.example.com/x' },
    })
    const summary = buildDesignSummary(state.brief)
    expect(JSON.stringify(summary)).not.toContain('shop.example.com')
  })
})

describe('nextBlockPosition', () => {
  it('starts at the top-left margin for an empty canvas', () => {
    const pos = nextBlockPosition([])
    expect(pos.x).toBeGreaterThanOrEqual(0)
    expect(pos.y).toBeGreaterThanOrEqual(0)
  })
})
