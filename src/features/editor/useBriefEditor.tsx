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
import { isPairedLinkUrl, withLinkPartners, type TextAlign } from '../../domain/simpleBlocks'
import type { ImageFit } from '../../domain/imageLayout'
import type { LayerMove } from '../../domain/layerOrder'
import type { Rect } from './canvasGeometry'

/**
 * 복사판 (복사·붙여넣기 Patch).
 *
 * 화면 밖의 모듈 하나에 둔다. 편집기는 페이지를 옮길 때마다 새로 만들어지므로,
 * 이것이 편집기 안에 있으면 페이지를 옮기는 순간 비워진다 — 그런데 "다른 페이지에
 * 붙여넣기"가 이 기능의 절반이다.
 */
let clipboard: BriefBlock[] = []


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
  /** 범위로 골라 한 번에 여럿을 고른다 (범위 선택 Patch). */
  selectMany: (blockIds: readonly string[]) => void
  /** 고른 것 전부를 같은 만큼 옮긴다 (여러 개 한 번에 Patch). */
  moveSelected: (dx: number, dy: number, coalesceKey?: string) => void
  resizeBlock: (blockId: string, rect: Rect, coalesceKey?: string) => void
  duplicateBlock: (blockId: string) => void
  duplicateSelected: () => void
  /**
   * 고른 것을 복사판에 담는다 (복사·붙여넣기 Patch).
   *
   * 담는 자리는 화면 밖의 모듈 하나다. 편집기는 페이지를 옮길 때마다 새로
   * 만들어지므로, 복사판이 편집기 안에 있으면 페이지를 옮기는 순간 비워진다 —
   * "다른 페이지에 붙여넣기"가 이 기능의 절반이다.
   */
  copySelected: () => number
  /** 복사판에 담긴 것을 이 페이지에 놓는다. 놓은 개수를 돌려준다. */
  pasteCopied: () => number
  /** 복사판에 담긴 것이 있는가. */
  hasCopied: () => boolean
  groupSelected: () => void
  ungroupSelected: () => void
  assignImage: (blockId: string, asset: Asset, image?: Partial<BlockImageMeta>) => void
  addImageBlock: (asset: Asset, position?: { x: number; y: number }, image?: Partial<BlockImageMeta>) => void
  removeBlockAsset: (blockId: string) => void
  setProjectTitle: (title: string, coalesceKey?: string) => void
  /** Sets the open page's length; one drag collapses into one undo step. */
  setCanvasHeight: (height: number, coalesceKey?: string) => void
  setTextAlign: (blockId: string, align: TextAlign) => void
  /** 그림이 블록 안에 놓이는 방식 — 전체 보이기 · 블록 채우기 (§3.1). */
  setImageFit: (blockId: string, fit: ImageFit) => void
  /** 레이어 순서를 한 걸음 옮긴다 (§4). */
  reorderBlock: (blockId: string, move: LayerMove) => void
  /** 블록이 캔버스 밖으로 나갈 수 있는 표면인가 (§3.2). */
  freePlacement: boolean
  /** 가장 최근 복제의 새 id → 원본 id. 블록 밖 설정을 함께 옮길 때 쓴다. */
  cloneOf: Record<string, string>
  hydrate: (brief: EventBrief) => void
  newBrief: () => void
  undo: () => void
  redo: () => void
  endInteraction: () => void
}

const BriefEditorContext = createContext<BriefEditorApi | null>(null)

export function BriefEditorProvider({
  children,
  freePlacement = false,
}: {
  children: ReactNode
  /** 작업판만 참. 캔버스 밖 배치를 허용한다 (배경 합성 1차 §3.2). */
  freePlacement?: boolean
}) {
  const [history, dispatch] = useReducer(historyReducer, freePlacement, createInitialHistoryState)
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
      selectMany: (blockIds) => dispatch({ type: 'SELECT_MANY', blockIds }),
      moveSelected: (dx, dy, coalesceKey) =>
        dispatch(coalesceKey === undefined
          ? { type: 'MOVE_SELECTED', dx, dy }
          : { type: 'MOVE_SELECTED', dx, dy, coalesceKey }),
      copySelected: () => {
        const ids = new Set(state.selectedIds)
        if (ids.size === 0) return 0
        // 버튼·링크는 짝까지 함께 담는다. 반쪽만 붙여넣으면 주소 없는 버튼이 생긴다.
        const withPairs = withLinkPartners(state.brief.blocks, ids)
        clipboard = state.brief.blocks.filter((b) => withPairs.has(b.id)).map((b) => structuredClone(b))
        // 담은 뒤 원본을 고쳐도 복사판은 그대로다 — 붙여넣기가 "복사한 그때"를
        // 내놓지 않으면 사람은 무엇을 붙였는지 알 수 없다.
        return clipboard.filter((b) => !isPairedLinkUrl(state.brief.blocks, b)).length
      },
      pasteCopied: () => {
        if (clipboard.length === 0) return 0
        dispatch({ type: 'PASTE_BLOCKS', blocks: clipboard })
        return clipboard.length
      },
      hasCopied: () => clipboard.length > 0,
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
      setTextAlign: (blockId, align) => dispatch({ type: 'SET_TEXT_ALIGN', blockId, align }),
      setImageFit: (blockId, fit) => dispatch({ type: 'UPDATE_BLOCK', blockId, patch: { image: { fit } } }),
      reorderBlock: (blockId, move) => dispatch({ type: 'REORDER_BLOCK', blockId, move }),
      freePlacement: state.freePlacement === true,
      cloneOf: state.cloneOf ?? {},
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
