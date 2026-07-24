/**
 * Center column: the planning canvas (WORK_PLAN §6, §10). This is a *layout of
 * intent*, not a design surface — it shows meaning cards at their soft
 * positions. Phase 3 enables move (drag) and resize on the cards; Phase 4 adds
 * image drag-and-drop (WORK_PLAN §11) that drops new image blocks at the cursor.
 *
 * The 840px sheet is displayed at the current zoom; block coordinates stay in
 * true canvas space, so clicks, drags, drops, and exports stay accurate. Zoom
 * is view-only (WORK_PLAN §14.7, `canvasView.ts`) and never saved.
 */

import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useAssets } from '../../features/assets/useAssets'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useCanvasView } from '../../features/editor/useCanvasView'
import type { ReferenceLayer } from '../../domain/pageSchema'
import { BriefBlockCard } from './BriefBlockCard'

/** Horizontal padding of the `.canvas` scroll container (keep in sync with CSS). */
const CANVAS_PADDING = 24

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files')
}

/** Overlay image sizing in the 840px canvas space, per the fit method (§8.3). */
function overlayStyle(ref: ReferenceLayer, canvasWidth: number): CSSProperties {
  const base: CSSProperties = { opacity: ref.opacity }
  if (ref.fit === 'width') return { ...base, width: canvasWidth, height: 'auto' }
  if (ref.fit === 'center') return { ...base, left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'auto', height: 'auto' }
  return base // 'original' — natural size, pinned top-left
}

export function BriefCanvas() {
  const { state, selectBlock } = useBriefEditor()
  const { uploadFiles, getUrl } = useAssets()
  const { activeReference } = useBriefDocument()
  const { zoom, reportViewport } = useCanvasView()
  const { project, blocks } = state.brief
  const { canvasWidth, canvasHeight } = project
  const selected = new Set(state.selectedIds)

  const overlayUrl = getUrl(activeReference.assetId)
  const showOverlay =
    activeReference.viewMode === 'overlay' && activeReference.visible && overlayUrl !== undefined

  const canvasRef = useRef<HTMLElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // Measure the available width so fit-to-view can size the fixed 840px canvas.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const measure = () => reportViewport(Math.max(0, el.clientWidth - CANVAS_PADDING * 2), canvasWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [reportViewport, canvasWidth])

  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const rect = sheetRef.current?.getBoundingClientRect()
    const position = rect
      ? { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }
      : undefined
    void uploadFiles(files, position ? { position } : {})
  }

  return (
    <section className="canvas" aria-label="기획 캔버스" ref={canvasRef}>
      <div
        className="canvas__viewport"
        style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}
      >
        <div
          ref={sheetRef}
          className={`canvas__sheet${dragOver ? ' is-drag-over' : ''}`}
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: `scale(${zoom})`,
          }}
          role="presentation"
          onPointerDown={(e) => {
            // Clicking the empty sheet clears the selection.
            if (e.target === e.currentTarget) selectBlock(null)
          }}
          onDragOver={(e) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={(e) => {
            if (e.target === e.currentTarget) setDragOver(false)
          }}
          onDrop={onDrop}
        >
          {showOverlay && (
            <img
              className="canvas__overlay"
              src={overlayUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
              style={overlayStyle(activeReference, canvasWidth)}
            />
          )}
          {blocks.length === 0 && (
            <p className="canvas__empty">
              왼쪽 팔레트에서 블록을 클릭하거나, 이미지를 여기로 끌어다 놓으세요.
            </p>
          )}
          {blocks.map((block) => (
            <BriefBlockCard
              key={block.id}
              block={block}
              selected={selected.has(block.id)}
              scale={zoom}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
