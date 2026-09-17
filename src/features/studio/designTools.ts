/**
 * 디자인 도구의 화면 상태 (도구 막대 Patch, 2026-09-17).
 *
 * 저장하지 않는 것들만 여기 있다 — 지금 든 도구, 문구에서 고른 글자, "이 블록을
 * 고치기 시작하라"는 부탁. 도구 막대·기획서 캔버스·완성본이 서로 다른 나무에
 * 있어서, 작은 저장소 하나로 잇는다.
 */

import { useSyncExternalStore } from 'react'
import type { ShapeKind } from '../../domain/shapeLook'
import { clampEraser, DEFAULT_ERASER, type EraserSettings } from '../../domain/eraseMask'

/**
 * `shadow`: 그림자만 남는 도형 (그림자 레이어 Patch).
 * `zoom`: 돋보기 — 캔버스를 누르면 확대, Alt+누르면 축소 (돋보기 도구 Patch). 무엇도 만들지 않는다.
 * `eraser`: 지우개 — 완성본에서 고른 조각을 문질러 지운다 (지우개 Patch). 무엇도 만들지 않는다.
 */
export type DesignTool = 'select' | 'text' | ShapeKind | 'shadow' | 'zoom' | 'eraser'
/** 끌어서 무언가를 만드는 도구. */
export type CreateTool = Exclude<DesignTool, 'select' | 'zoom' | 'eraser'>

/** 무언가를 만드는 도구인가 (돋보기·지우개·선택은 아니다). */
export function isCreateTool(tool: DesignTool): tool is CreateTool {
  return tool !== 'select' && tool !== 'zoom' && tool !== 'eraser'
}

interface ToolState {
  tool: DesignTool
  /** 마지막으로 든 도형 — `U` 단축키가 이것을 다시 든다. */
  lastShape: Exclude<ShapeKind, 'line'> | 'shadow'
  /** 문구에서 고른 글자 (글자 차례, `start` 이상 `end` 미만). */
  selection: { blockId: string; start: number; end: number } | null
  /** 이 블록의 글 고치기를 열어 달라는 부탁. 한 번 읽으면 비운다. */
  editRequest: string | null
  /** 마지막으로 고른 글꼴 — 새 문구가 이어받는다. */
  lastFamily: string | null
  /** 이벤트 페이지 배경의 크기·자리를 캔버스에서 조절하는 중인가 (배경 크기 Patch). */
  backgroundEdit: boolean
  /** 지우개 붓 (지우개 Patch). 저장하지 않는다 — 이 화면의 손버릇이다. */
  eraser: EraserSettings
}

let state: ToolState = {
  tool: 'select',
  lastShape: 'rect',
  selection: null,
  editRequest: null,
  lastFamily: null,
  backgroundEdit: false,
  eraser: DEFAULT_ERASER,
}
const listeners = new Set<() => void>()

function set(patch: Partial<ToolState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useDesignTools(): ToolState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

export function setTool(tool: DesignTool): void {
  set(
    tool !== 'select' && tool !== 'text' && tool !== 'line' && tool !== 'zoom' && tool !== 'eraser'
      ? { tool, lastShape: tool }
      : { tool },
  )
}

export function setTextSelection(selection: ToolState['selection']): void {
  const same =
    selection === state.selection ||
    (selection !== null &&
      state.selection !== null &&
      selection.blockId === state.selection.blockId &&
      selection.start === state.selection.start &&
      selection.end === state.selection.end)
  if (!same) set({ selection })
}

export function requestEdit(blockId: string | null): void {
  set({ editRequest: blockId })
}

export function rememberFamily(family: string): void {
  if (state.lastFamily !== family) set({ lastFamily: family })
}

export function setEraser(patch: Partial<EraserSettings>): void {
  set({ eraser: clampEraser(patch, state.eraser) })
}

export function eraserSettings(): EraserSettings {
  return state.eraser
}

export function setBackgroundEdit(on: boolean): void {
  if (state.backgroundEdit !== on) set({ backgroundEdit: on })
}

export function lastFamily(): string | null {
  return state.lastFamily
}

/** 검사마다 처음 상태로. */
export function resetDesignToolsForTests(): void {
  state = { tool: 'select', lastShape: 'rect', selection: null, editRequest: null, lastFamily: null, backgroundEdit: false, eraser: DEFAULT_ERASER }
  for (const l of listeners) l()
}

/** 글상자의 UTF-16 자리를 글자 차례로 — 한글·이모지를 한 칸으로 센다. */
export function charIndexAt(text: string, utf16: number): number {
  return Array.from(text.slice(0, Math.max(0, utf16))).length
}
