import { describe, it, expect } from 'vitest'
import {
  briefReducer,
  createInitialEditorState,
  nextBlockPosition,
  primarySelectedId,
  selectedBlock,
  selectedBlocks,
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
    expect(state.selectedIds).toEqual([])
  })
})

describe('ADD_BLOCK', () => {
  it('creates a factory block with the type default visibility and auto-selects it', () => {
    const state = addBlockOf(createInitialEditorState(), 'main_headline')
    expect(state.brief.blocks).toHaveLength(1)
    const block = state.brief.blocks[0]!
    expect(block.type).toBe('main_headline')
    expect(block.aiVisibility).toBe(getBlockTypeMeta('main_headline').defaultVisibility)
    expect(block.label).toBe(getBlockTypeMeta('main_headline').label)
    expect(state.selectedIds).toEqual([block.id])
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
  it('replaces the selection by default', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    const first = state.brief.blocks[0]!.id
    state = addBlockOf(state, 'benefit')
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: first })
    expect(state.selectedIds).toEqual([first])
    expect(primarySelectedId(state)).toBe(first)
  })

  it('adds and toggles in additive mode', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    const a = state.brief.blocks[0]!.id
    state = addBlockOf(state, 'benefit')
    const b = state.brief.blocks[1]!.id

    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: a })
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: b, additive: true })
    expect(new Set(state.selectedIds)).toEqual(new Set([a, b]))

    // Toggle b off.
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: b, additive: true })
    expect(state.selectedIds).toEqual([a])
  })

  it('clears selection on null', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: null })
    expect(state.selectedIds).toEqual([])
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
    expect(block.image).toEqual({ allowTransform: true, productName: '롬프 X' })
  })
})

describe('MOVE_BLOCK', () => {
  it('moves a block and keeps it within the canvas', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    const id = state.brief.blocks[0]!.id
    state = briefReducer(state, { type: 'MOVE_BLOCK', blockId: id, x: 120, y: 300 })
    expect(state.brief.blocks[0]!.position).toMatchObject({ x: 120, y: 300 })

    // Off-canvas target is clamped.
    state = briefReducer(state, { type: 'MOVE_BLOCK', blockId: id, x: 99999, y: 99999 })
    const { x, y, width, height } = state.brief.blocks[0]!.position
    expect(x + width).toBeLessThanOrEqual(state.brief.project.canvasWidth)
    expect(y + height).toBeLessThanOrEqual(state.brief.project.canvasHeight)
  })

  it('moves every member of a group together', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_product_image')
    state = addBlockOf(state, 'sub_product_image')
    const [a, b] = state.brief.blocks
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: a!.id })
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: b!.id, additive: true })
    state = briefReducer(state, { type: 'GROUP_SELECTED' })

    const beforeB = state.brief.blocks[1]!.position
    state = briefReducer(state, { type: 'MOVE_BLOCK', blockId: a!.id, x: a!.position.x + 40, y: a!.position.y + 40 })
    // B moved by the same delta as A.
    expect(state.brief.blocks[1]!.position.x).toBe(beforeB.x + 40)
    expect(state.brief.blocks[1]!.position.y).toBe(beforeB.y + 40)
  })
})

describe('RESIZE_BLOCK', () => {
  it('applies a new rectangle', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    const id = state.brief.blocks[0]!.id
    state = briefReducer(state, { type: 'RESIZE_BLOCK', blockId: id, rect: { x: 10, y: 10, width: 200, height: 150 } })
    expect(state.brief.blocks[0]!.position).toEqual({ x: 10, y: 10, width: 200, height: 150 })
  })
})

describe('DUPLICATE_BLOCK', () => {
  it('clones the block with a new id, offsets it, and selects the clone', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    state = briefReducer(state, { type: 'UPDATE_BLOCK', blockId: state.brief.blocks[0]!.id, patch: { content: '헤드라인' } })
    const src = state.brief.blocks[0]!
    state = briefReducer(state, { type: 'DUPLICATE_BLOCK', blockId: src.id })

    expect(state.brief.blocks).toHaveLength(2)
    const clone = state.brief.blocks[1]!
    expect(clone.id).not.toBe(src.id)
    expect(clone.content).toBe('헤드라인')
    expect(clone.position.x).not.toBe(src.position.x)
    expect(state.selectedIds).toEqual([clone.id])
  })
})

describe('GROUP_SELECTED / UNGROUP_SELECTED', () => {
  it('assigns a shared groupId to 2+ selected blocks', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_product_image')
    state = addBlockOf(state, 'sub_product_image')
    const [a, b] = state.brief.blocks
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: a!.id })
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: b!.id, additive: true })
    state = briefReducer(state, { type: 'GROUP_SELECTED' })

    const g = state.brief.blocks[0]!.groupId
    expect(g).toBeDefined()
    expect(state.brief.blocks[1]!.groupId).toBe(g)

    state = briefReducer(state, { type: 'UNGROUP_SELECTED' })
    expect(state.brief.blocks[0]!.groupId).toBeUndefined()
    expect(state.brief.blocks[1]!.groupId).toBeUndefined()
  })

  it('does nothing with fewer than 2 selected', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    state = briefReducer(state, { type: 'GROUP_SELECTED' })
    expect(state.brief.blocks[0]!.groupId).toBeUndefined()
  })
})

describe('DELETE_BLOCK / DELETE_SELECTED', () => {
  it('removes a single block and drops it from the selection', () => {
    const state = addBlockOf(createInitialEditorState(), 'main_headline')
    const id = state.brief.blocks[0]!.id
    const next = briefReducer(state, { type: 'DELETE_BLOCK', blockId: id })
    expect(next.brief.blocks).toHaveLength(0)
    expect(next.selectedIds).toEqual([])
  })

  it('removes every selected block', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    state = addBlockOf(state, 'benefit')
    const [a, b] = state.brief.blocks
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: a!.id })
    state = briefReducer(state, { type: 'SELECT_BLOCK', blockId: b!.id, additive: true })
    state = briefReducer(state, { type: 'DELETE_SELECTED' })
    expect(state.brief.blocks).toHaveLength(0)
    expect(selectedBlocks(state)).toEqual([])
  })
})

describe('image assets', () => {
  const asset = {
    id: 'asset_1',
    fileName: 'logo.png',
    mimeType: 'image/png' as const,
    width: 100,
    height: 100,
    byteSize: 500,
  }

  it('ASSIGN_IMAGE attaches an asset to a block and registers it once', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_product_image')
    const id = state.brief.blocks[0]!.id
    state = briefReducer(state, { type: 'ASSIGN_IMAGE', blockId: id, asset, image: { productName: '로고' } })
    expect(state.brief.blocks[0]!.assetId).toBe('asset_1')
    expect(state.brief.blocks[0]!.image?.productName).toBe('로고')
    expect(state.brief.assets).toHaveLength(1)

    // Re-assigning the same asset id does not duplicate it.
    state = briefReducer(state, { type: 'ASSIGN_IMAGE', blockId: id, asset })
    expect(state.brief.assets).toHaveLength(1)
  })

  it('ADD_IMAGE_BLOCK creates an image block with the asset and selects it', () => {
    const state = briefReducer(createInitialEditorState(), {
      type: 'ADD_IMAGE_BLOCK',
      asset,
      position: { x: 40, y: 60 },
    })
    expect(state.brief.blocks).toHaveLength(1)
    const block = state.brief.blocks[0]!
    expect(block.type).toBe('main_product_image')
    expect(block.assetId).toBe('asset_1')
    expect(state.brief.assets).toHaveLength(1)
    expect(state.selectedIds).toEqual([block.id])
  })

  it('REMOVE_BLOCK_ASSET clears the assetId and prunes the orphaned asset', () => {
    let state = briefReducer(createInitialEditorState(), { type: 'ADD_IMAGE_BLOCK', asset })
    const id = state.brief.blocks[0]!.id
    state = briefReducer(state, { type: 'REMOVE_BLOCK_ASSET', blockId: id })
    expect(state.brief.blocks[0]!.assetId).toBeUndefined()
    expect(state.brief.assets).toHaveLength(0)
  })
})

describe('NEW_BRIEF', () => {
  it('resets to the initial state', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    state = briefReducer(state, { type: 'NEW_BRIEF' })
    expect(state.brief.blocks).toEqual([])
    expect(state.selectedIds).toEqual([])
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

describe('SET_PROJECT_TITLE', () => {
  it('updates the project title without touching blocks or selection', () => {
    let state = addBlockOf(createInitialEditorState(), 'main_headline')
    const selectedBefore = state.selectedIds
    const blocksBefore = state.brief.blocks
    state = briefReducer(state, { type: 'SET_PROJECT_TITLE', title: '여름 프로모션' })
    expect(state.brief.project.title).toBe('여름 프로모션')
    expect(state.brief.blocks).toBe(blocksBefore)
    expect(state.selectedIds).toBe(selectedBefore)
  })

  it('is a no-op (same reference) when the title is unchanged', () => {
    const state = createInitialEditorState()
    const same = briefReducer(state, { type: 'SET_PROJECT_TITLE', title: state.brief.project.title })
    expect(same).toBe(state)
  })
})

describe('nextBlockPosition', () => {
  it('starts at the top-left margin for an empty canvas', () => {
    const pos = nextBlockPosition([])
    expect(pos.x).toBeGreaterThanOrEqual(0)
    expect(pos.y).toBeGreaterThanOrEqual(0)
  })
})
