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
import { findLinkPartner, isPairedLinkUrl, linkUrlOf } from '../../domain/simpleBlocks'
import { autoScrollStep, heightForPointer } from '../../features/editor/heightDrag'
import type { ReferenceLayer } from '../../domain/pageSchema'
import { BriefBlockCard } from './BriefBlockCard'

/** Horizontal padding of the `.canvas` scroll container (keep in sync with CSS). */
const CANVAS_PADDING = 24

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files')
}

/** Room under the sheet for the page-length handle. */
const HEIGHT_HANDLE_ROOM = 44

/** Overlay image sizing in the 840px canvas space, per the fit method (§8.3). */
function overlayStyle(ref: ReferenceLayer, canvasWidth: number): CSSProperties {
  const base: CSSProperties = { opacity: ref.opacity }
  if (ref.fit === 'width') return { ...base, width: canvasWidth, height: 'auto' }
  if (ref.fit === 'center') return { ...base, left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'auto', height: 'auto' }
  return base // 'original' — natural size, pinned top-left
}

export function BriefCanvas() {
  const { state, selectBlock, setCanvasHeight, endInteraction } = useBriefEditor()
  const { uploadFiles, getUrl } = useAssets()
  const { activeReference } = useBriefDocument()
  const { zoom, reportViewport } = useCanvasView()
  const { project, blocks } = state.brief
  const { canvasWidth, canvasHeight } = project
  const selected = new Set(state.selectedIds)
  // A 버튼·링크 is one card: its paired publishing URL block stays in the data
  // (and in exports) but is not drawn. Legacy standalone URL blocks still show.
  const visibleBlocks = blocks.filter((b) => !isPairedLinkUrl(blocks, b))

  const overlayUrl = getUrl(activeReference.assetId)
  const showOverlay =
    activeReference.viewMode === 'overlay' && activeReference.visible && overlayUrl !== undefined

  const canvasRef = useRef<HTMLElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** Everything one height drag needs to be stopped from anywhere. */
  const heightDrag = useRef<{ stop: () => void } | null>(null)

  // A drag that outlives the canvas would keep a timer running against a
  // detached element, so leaving the screen ends it like letting go does.
  useEffect(() => () => heightDrag.current?.stop(), [])

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
        style={{ width: canvasWidth * zoom, height: canvasHeight * zoom + HEIGHT_HANDLE_ROOM }}
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
          {visibleBlocks.map((block) => (
            <BriefBlockCard
              key={block.id}
              block={block}
              selected={selected.has(block.id)}
              scale={zoom}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              paired={findLinkPartner(blocks, block) !== undefined}
              {...(linkUrlOf(blocks, block) === undefined ? {} : { linkUrl: linkUrlOf(blocks, block)! })}
            />
          ))}
        </div>

        {/* Page length. Only this page changes; the 840px width is fixed. */}
        <button
          type="button"
          className="canvas__height-handle"
          style={{ top: canvasHeight * zoom }}
          aria-label="페이지 길이 조절"
          title="아래위로 끌어 페이지 길이를 조절합니다"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            heightDrag.current?.stop()

            const sheet = sheetRef.current
            const scroller = canvasRef.current
            if (!sheet || !scroller) return
            // Where the pointer sits relative to the page's end, so the grab
            // point is kept for the whole drag.
            const grabOffset = heightForPointer(e.clientY, sheet.getBoundingClientRect().top, zoom, 0) - canvasHeight
            let pointerY = e.clientY

            /**
             * Height is read from where the pointer *is* in document space, not
             * from how far it has moved. The sheet's screen position is re-read
             * every time, so when the work area scrolls under a still pointer
             * the page keeps growing — which is what makes one grab enough for a
             * page many screens long.
             */
            const applyHeight = () => {
              const top = sheetRef.current?.getBoundingClientRect().top
              if (top === undefined) return
              setCanvasHeight(heightForPointer(pointerY, top, zoom, grabOffset), 'canvas-height')
            }

            const timer = window.setInterval(() => {
              const box = scroller.getBoundingClientRect()
              const step = autoScrollStep(pointerY, box.top, box.bottom)
              if (step !== 0) scroller.scrollTop += step
              // Even with no scrolling left to do, re-applying is harmless: the
              // clamp decides, and a page that cannot grow simply stops.
              if (step !== 0) applyHeight()
            }, 16)

            const onMove = (ev: PointerEvent) => {
              pointerY = ev.clientY
              applyHeight()
            }
            const stop = () => {
              window.clearInterval(timer)
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', stop)
              window.removeEventListener('pointercancel', stop)
              window.removeEventListener('keydown', onKey)
              heightDrag.current = null
              endInteraction()
            }
            const onKey = (ev: KeyboardEvent) => {
              if (ev.key === 'Escape') stop()
            }

            heightDrag.current = { stop }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', stop)
            window.addEventListener('pointercancel', stop)
            window.addEventListener('keydown', onKey)
          }}
        >
          ↕ 페이지 길이 조절 · {Math.round(canvasHeight)}px
        </button>
      </div>
    </section>
  )
}
