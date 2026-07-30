/**
 * A meaning card on the canvas (WORK_PLAN §3, §4, §12). Renders a block as a
 * simple semantic card — never a styled design component. It is draggable
 * (move) and resizable (corner handles).
 *
 * Step 6 adds in-canvas editing (§12): double-click or Enter starts inline text
 * editing (drag disabled while editing; Ctrl/Cmd+Enter or blur saves, Esc
 * cancels); double-click on an image block opens the file picker; and a "⋯"
 * card menu handles delete (and image replace/remove) since those controls were
 * removed from the right panel.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getBlockTypeMeta, type BlockCategory } from '../../domain/blockTypes'
import { cardKindLabel } from '../../domain/simpleBlocks'
import type { BriefBlock } from '../../domain/briefSchema'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useAssets } from '../../features/assets/useAssets'
import { ACCEPTED_MIME_TYPES } from '../../features/assets/imageUtils'
import { RESIZE_HANDLES, resizeRect, type ResizeHandle } from '../../features/editor/canvasGeometry'

interface Props {
  block: BriefBlock
  selected: boolean
  scale: number
  canvasWidth: number
  canvasHeight: number
  /**
   * True when this card is the visible half of a 버튼·링크 pair. The pair is held
   * together by a group id, but that is internal plumbing — the card must not
   * advertise itself as a user-made group.
   */
  paired?: boolean
}

const CATEGORY_MODIFIER: Record<BlockCategory, string> = {
  text: 'text',
  image: 'image',
  structure: 'structure',
  reference: 'reference',
}

const IMAGE_ACCEPT = ACCEPTED_MIME_TYPES.join(',')
const DRAG_THRESHOLD_PX = 3

interface DragState {
  startX: number
  startY: number
  origX: number
  origY: number
  moved: boolean
}

function hasContent(block: BriefBlock): boolean {
  return typeof block.content === 'string' && block.content.trim().length > 0
}

export function BriefBlockCard({ block, selected, scale, canvasWidth, canvasHeight, paired = false }: Props) {
  const { moveBlock, resizeBlock, selectBlock, endInteraction, updateBlock, deleteBlock, removeBlockAsset } =
    useBriefEditor()
  const { getUrl, uploadFiles } = useAssets()
  const meta = getBlockTypeMeta(block.type)
  const thumbUrl = meta.requiresAsset ? getUrl(block.assetId) : undefined
  const drag = useRef<DragState | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDetailsElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const beginEdit = () => {
    if (!meta.hasText) return
    setDraft(block.content ?? '')
    setEditing(true)
  }
  const commitEdit = () => {
    setEditing(false)
    if (draft !== (block.content ?? '')) updateBlock(block.id, { content: draft })
  }
  const openFilePicker = () => fileRef.current?.click()
  const closeMenu = () => menuRef.current?.removeAttribute('open')

  const startDrag = (e: ReactPointerEvent) => {
    if (editing || e.button !== 0) return
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    if (additive) {
      selectBlock(block.id, true)
      return // additive click only toggles selection, never drags
    }
    if (!selected) selectBlock(block.id)

    e.preventDefault()
    drag.current = { startX: e.clientX, startY: e.clientY, origX: block.position.x, origY: block.position.y, moved: false }

    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      if (!d.moved && Math.abs(ev.clientX - d.startX) < DRAG_THRESHOLD_PX && Math.abs(ev.clientY - d.startY) < DRAG_THRESHOLD_PX) {
        return
      }
      d.moved = true
      const dx = (ev.clientX - d.startX) / scale
      const dy = (ev.clientY - d.startY) / scale
      moveBlock(block.id, d.origX + dx, d.origY + dy, `move:${block.id}`)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (drag.current?.moved) endInteraction()
      drag.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startResize = (handle: ResizeHandle) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startRect = { ...block.position }

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale
      const dy = (ev.clientY - startY) / scale
      resizeBlock(block.id, resizeRect(startRect, handle, dx, dy, canvasWidth, canvasHeight), `resize:${block.id}`)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      endInteraction()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className={[
        'block-card',
        `block-card--${CATEGORY_MODIFIER[meta.category]}`,
        `block-card--vis-${block.aiVisibility}`,
        block.groupId !== undefined && !paired ? 'block-card--grouped' : '',
        selected ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: block.position.x, top: block.position.y, width: block.position.width, height: block.position.height }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onPointerDown={startDrag}
      onDoubleClick={() => (meta.requiresAsset ? openFilePicker() : beginEdit())}
      onKeyDown={(e) => {
        if (editing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          if (meta.hasText) beginEdit()
          else selectBlock(block.id, e.shiftKey)
        } else if (e.key === ' ') {
          e.preventDefault()
          selectBlock(block.id, e.shiftKey)
        }
      }}
    >
      <span className="block-card__head">
        {/* Plain-language kind, so an unselected card is still identifiable
            without knowing the internal type or AI-visibility vocabulary. */}
        <span className="block-card__visibility">{cardKindLabel(block)}</span>
        {block.groupId !== undefined && !paired && <span className="block-card__group" title="그룹">그룹</span>}
        {block.required && <span className="block-card__required" title="필수 블록">필수</span>}
        {selected && (
          <details className="block-card__menu" ref={menuRef} onPointerDown={(e) => e.stopPropagation()}>
            <summary className="block-card__menu-trigger" aria-label={`${block.label} 블록 메뉴`}>⋯</summary>
            <div className="block-card__menu-panel">
              {meta.requiresAsset && (
                <button type="button" className="block-card__menu-item" onClick={() => { closeMenu(); openFilePicker() }}>
                  {thumbUrl ? '이미지 교체' : '이미지 추가'}
                </button>
              )}
              {meta.requiresAsset && thumbUrl && (
                <button type="button" className="block-card__menu-item" onClick={() => { closeMenu(); removeBlockAsset(block.id) }}>
                  이미지 제거
                </button>
              )}
              <button type="button" className="block-card__menu-item block-card__menu-item--danger" onClick={() => { closeMenu(); deleteBlock(block.id) }}>
                삭제
              </button>
            </div>
          </details>
        )}
      </span>

      <span className="block-card__title">{block.label}</span>

      {editing ? (
        <textarea
          className="block-card__editor"
          value={draft}
          autoFocus
          aria-label={`${block.label} 내용`}
          placeholder={`${meta.label} 입력…`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              commitEdit()
            }
          }}
        />
      ) : thumbUrl ? (
        <img className="block-card__thumb" src={thumbUrl} alt={block.image?.productName ?? block.label} draggable={false} />
      ) : (
        <span className={`block-card__content${hasContent(block) ? '' : ' block-card__content--placeholder'}`}>
          {hasContent(block)
            ? block.content
            : meta.requiresAsset
              ? '클릭 또는 붙여넣기로 이미지 추가'
              : `${meta.label} 입력…`}
        </span>
      )}

      {meta.requiresAsset && (
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="block-card__file"
          onChange={(e) => {
            const files = e.target.files
            if (files && files.length > 0) void uploadFiles(files, { targetBlockId: block.id })
            e.target.value = ''
          }}
        />
      )}

      {selected &&
        !editing &&
        RESIZE_HANDLES.map((handle) => (
          <span
            key={handle}
            className={`block-card__handle block-card__handle--${handle}`}
            onPointerDown={startResize(handle)}
            aria-hidden="true"
          />
        ))}
    </div>
  )
}
