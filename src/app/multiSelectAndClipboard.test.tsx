/**
 * 여러 개를 한 번에 (작성기 요청 1·2).
 *
 * 작성기를 쓰는 팀에서 온 말은 짧았다. "위치를 한번 바꿀때 하나하나 다 움직여야
 * 되더라구요." 고를 수는 있었지만 — Shift+클릭이 이미 있었다 — 골라 놓고 끌면
 * **잡은 것 하나만** 움직였다. 골라 둔 것이 아무 의미가 없었던 셈이다.
 *
 * 그래서 셋을 붙든다.
 *
 *  - 빈 자리를 끌면 **범위로** 고른다. 하나씩 Shift+클릭하지 않아도 되게.
 *  - 골라 둔 것을 끌면 **전부** 따라온다. 그것도 서로의 간격을 지킨 채로.
 *  - `Ctrl+C` / `Ctrl+V`로 다른 페이지에도 옮긴다.
 *
 * 간격이 요점이다. 하나씩 벽에 재면 벽에 닿은 것만 멈춰 배치가 무너진다 —
 * 열 개를 한 번에 옮기고 나서 배치를 다시 잡아야 한다면 하나씩 옮기는 것과
 * 다를 바가 없다.
 */

import { describe, it, expect } from 'vitest'
import { blocksInRect, marqueeRect } from '../features/editor/canvasGeometry'
import { briefReducer, createInitialEditorState, type EditorState } from '../features/editor/briefEditor'
import { createBlock } from '../domain/factory'
import type { BriefBlock } from '../domain/briefSchema'

function at(id: string, x: number, y: number, width = 100, height = 60): BriefBlock {
  return createBlock('free_text', { id, content: id, position: { x, y, width, height } })
}

/** 셋이 나란히 놓인 페이지. */
function seeded(): EditorState {
  const base = createInitialEditorState()
  return {
    ...base,
    brief: { ...base.brief, blocks: [at('a', 20, 20), at('b', 200, 20), at('c', 400, 300)] },
  }
}

const posOf = (state: EditorState, id: string) => state.brief.blocks.find((b) => b.id === id)!.position

describe('§28-1 범위로 고른다', () => {
  it('어느 방향으로 끌어도 같은 사각형이다', () => {
    // 오른쪽 아래로만 끌게 하면 위쪽에 있는 것을 고를 때 손이 한 번 더 간다.
    const down = marqueeRect({ x: 10, y: 10 }, { x: 110, y: 60 })
    const up = marqueeRect({ x: 110, y: 60 }, { x: 10, y: 10 })
    expect(down).toEqual({ x: 10, y: 10, width: 100, height: 50 })
    expect(up).toEqual(down)
  })

  it('스치기만 해도 고른다 — 통째로 품을 필요가 없다', () => {
    // 완전히 품은 것만 고르면, 화면을 꽉 채운 배경 블록은 고를 자리가 없다.
    const blocks = [at('a', 20, 20), at('b', 200, 20)]
    expect(blocksInRect(blocks, { x: 0, y: 0, width: 30, height: 30 })).toEqual(['a'])
    expect(blocksInRect(blocks, { x: 0, y: 0, width: 400, height: 400 })).toEqual(['a', 'b'])
    // 닿지 않으면 고르지 않는다.
    expect(blocksInRect(blocks, { x: 600, y: 600, width: 50, height: 50 })).toEqual([])
  })

  it('범위에 든 것으로 선택이 통째로 바뀐다', () => {
    const next = briefReducer(seeded(), { type: 'SELECT_MANY', blockIds: ['a', 'b'] })
    expect(next.selectedIds).toEqual(['a', 'b'])
    // 다시 고르면 앞의 선택은 남지 않는다 — 범위 선택은 더하기가 아니다.
    expect(briefReducer(next, { type: 'SELECT_MANY', blockIds: ['c'] }).selectedIds).toEqual(['c'])
  })
})

describe('§28-2 고른 것이 함께 움직인다', () => {
  it('셋을 골라 옮기면 셋 다 같은 만큼 간다', () => {
    let state = briefReducer(seeded(), { type: 'SELECT_MANY', blockIds: ['a', 'b', 'c'] })
    state = briefReducer(state, { type: 'MOVE_SELECTED', dx: 30, dy: 40 })
    expect(posOf(state, 'a')).toMatchObject({ x: 50, y: 60 })
    expect(posOf(state, 'b')).toMatchObject({ x: 230, y: 60 })
    expect(posOf(state, 'c')).toMatchObject({ x: 430, y: 340 })
  })

  it('벽에 닿으면 **묶음 전체가** 멈춘다 — 간격이 무너지지 않는다', () => {
    // 하나씩 재면 벽에 닿은 것만 서고 나머지는 계속 가, 열 개를 옮긴 뒤 배치를
    // 다시 잡아야 한다. 그러면 한 번에 옮기는 뜻이 없다.
    let state = briefReducer(seeded(), { type: 'SELECT_MANY', blockIds: ['a', 'b'] })
    const gap = posOf(state, 'b').x - posOf(state, 'a').x
    state = briefReducer(state, { type: 'MOVE_SELECTED', dx: -9999, dy: 0 })
    expect(posOf(state, 'b').x - posOf(state, 'a').x).toBe(gap)
    expect(posOf(state, 'a').x).toBeGreaterThanOrEqual(0)
  })

  it('고른 것이 없으면 아무 일도 없다', () => {
    const state = seeded()
    expect(briefReducer(state, { type: 'MOVE_SELECTED', dx: 10, dy: 10 })).toBe(state)
  })
})

describe('§28-3 복사해서 붙여넣는다', () => {
  it('붙여넣은 것은 새 번호를 받고, 원본은 그대로다', () => {
    const state = seeded()
    const source = state.brief.blocks.filter((b) => b.id === 'a')
    const next = briefReducer(state, { type: 'PASTE_BLOCKS', blocks: source })

    expect(next.brief.blocks).toHaveLength(4)
    // 같은 번호가 둘이면 한쪽을 고칠 때 다른 쪽이 함께 바뀐다.
    const ids = next.brief.blocks.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(posOf(next, 'a')).toEqual(posOf(state, 'a'))
  })

  it('붙여넣은 것이 바로 골라져 있고, 겹치지 않게 비켜 놓인다', () => {
    const state = seeded()
    const next = briefReducer(state, { type: 'PASTE_BLOCKS', blocks: [state.brief.blocks[0]!] })
    const pasted = next.brief.blocks.at(-1)!
    expect(next.selectedIds).toEqual([pasted.id])
    // 정확히 겹쳐 놓으면 붙었는지 사람이 알 수 없다.
    expect(pasted.position.x).toBeGreaterThan(20)
    expect(pasted.position.y).toBeGreaterThan(20)
  })

  it('내용은 그대로 따라온다', () => {
    const state = seeded()
    const next = briefReducer(state, { type: 'PASTE_BLOCKS', blocks: [state.brief.blocks[1]!] })
    expect(next.brief.blocks.at(-1)!.content).toBe('b')
  })

  it('빈 복사판은 아무것도 하지 않는다', () => {
    const state = seeded()
    expect(briefReducer(state, { type: 'PASTE_BLOCKS', blocks: [] })).toBe(state)
  })

  it('복제와 붙여넣기가 같은 길을 지난다', () => {
    // 둘은 출처만 다르다. 나누어 적으면 언젠가 한쪽에만 고쳐진다.
    const state = briefReducer(seeded(), { type: 'SELECT_MANY', blockIds: ['a'] })
    const cloned = briefReducer(state, { type: 'DUPLICATE_SELECTED' })
    const pasted = briefReducer(state, { type: 'PASTE_BLOCKS', blocks: [state.brief.blocks[0]!] })
    expect(pasted.brief.blocks.at(-1)!.position).toEqual(cloned.brief.blocks.at(-1)!.position)
  })
})
