/**
 * A meaning card on the canvas (WORK_PLAN §3, §4). Renders a block as a simple
 * semantic card — never a styled design component. Phase 3 makes it draggable
 * (move) and resizable (corner handles); the card still communicates only
 * meaning, importance, and design-vs-publishing — no colors/fonts/effects.
 */

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { getBlockTypeMeta, type BlockCategory } from '../../domain/blockTypes'
import { AI_VISIBILITY_LABELS } from '../uiLabels'
import type { BriefBlock } from '../../domain/briefSchema'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useAssets } from '../../features/assets/useAssets'
import { RESIZE_HANDLES, resizeRect, type ResizeHandle } from '../../features/editor/canvasGeometry'

interface Props {
  block: BriefBlock
  selected: boolean
  scale: number
  canvasWidth: number
  canvasHeight: number
}

const CATEGORY_MODIFIER: Record<BlockCategory, string> = {
  text: 'text',
  image: 'image',
  structure: 'structure',
  reference: 'reference',
}

const DRAG_THRESHOLD_PX = 3

interface DragState {
  startX: number
  startY: number
  origX: number
  origY: number
  moved: boolean
}

export function BriefBlockCard({ block, selected, scale, canvasWidth, canvasHeight }: Props) {
  const { moveBlock, resizeBlock, selectBlock, endInteraction } = useBriefEditor()
  const { getUrl } = useAssets()
  const meta = getBlockTypeMeta(block.type)
  const isPublishingSide = block.aiVisibility !== 'design'
  const thumbUrl = meta.requiresAsset ? getUrl(block.assetId) : undefined
  const drag = useRef<DragState | null>(null)

  const startDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    if (additive) {
      selectBlock(block.id, true)
      return // additive click only toggles selection, never drags
    }
    if (!selected) selectBlock(block.id)

    e.preventDefault()
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: block.position.x,
      origY: block.position.y,
      moved: false,
    }

    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      if (
        !d.moved &&
        Math.abs(ev.clientX - d.startX) < DRAG_THRESHOLD_PX &&
        Math.abs(ev.clientY - d.startY) < DRAG_THRESHOLD_PX
      ) {
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
        isPublishingSide ? 'block-card--reference-side' : 'block-card--design-side',
        block.groupId !== undefined ? 'block-card--grouped' : '',
        selected ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: block.position.x,
        top: block.position.y,
        width: block.position.width,
        height: block.position.height,
      }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onPointerDown={startDrag}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectBlock(block.id, e.shiftKey)
        }
      }}
    >
      <span className="block-card__head">
        <span className="block-card__visibility">{AI_VISIBILITY_LABELS[block.aiVisibility]}</span>
        {block.groupId !== undefined && <span className="block-card__group" title="그룹">그룹</span>}
        {block.required && <span className="block-card__required" title="필수 블록">필수</span>}
      </span>
      <span className="block-card__title">{block.label}</span>
      {thumbUrl ? (
        <img className="block-card__thumb" src={thumbUrl} alt={block.image?.productName ?? block.label} draggable={false} />
      ) : (
        <span className="block-card__content">
          {block.content && block.content.trim().length > 0
            ? block.content
            : meta.requiresAsset
              ? '(이미지 미지정)'
              : '(내용 없음)'}
        </span>
      )}

      {selected &&
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
