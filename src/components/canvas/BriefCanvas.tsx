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
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useCanvasView } from '../../features/editor/useCanvasView'
import { findLinkPartner, isPairedLinkUrl, linkUrlOf } from '../../domain/simpleBlocks'
import { autoScrollStep, heightForPointer, heightKeyDelta } from '../../features/editor/heightDrag'
import { blocksInRect, marqueeRect, type Rect } from '../../features/editor/canvasGeometry'

/** 이보다 작게 움직인 것은 끌기가 아니라 손 떨림이다. */
const MARQUEE_MIN_PX = 4
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
  const { state, selectBlock, selectMany, setCanvasHeight, endInteraction } = useBriefEditor()
  /** 지금 그리고 있는 선택 범위. 끌지 않는 동안에는 `null`이다. */
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const { uploadFiles, getUrl } = useAssets()
  const { activeReference, activePageId } = useBriefDocument()
  // 작업판에서만 배경이 있다. 작성기에는 provider 자체가 없어 언제나 `null`이므로
  // 같은 캔버스가 두 표면에서 그대로 쓰인다 (배경 합성 1차 §5).
  const studio = useStudioJob()
  const { zoom, reportViewport } = useCanvasView()
  const { project, blocks } = state.brief
  const { canvasWidth, canvasHeight } = project
  const selected = new Set(state.selectedIds)
  // A 버튼·링크 is one card: its paired publishing URL block stays in the data
  // (and in exports) but is not drawn. Legacy standalone URL blocks still show.
  const visibleBlocks = blocks.filter((b) => !isPairedLinkUrl(blocks, b))

  const backgroundUrl = getUrl(studio?.backgroundOf(activePageId)?.assetId)
  const overlayUrl = getUrl(activeReference.assetId)
  const showOverlay =
    activeReference.viewMode === 'overlay' && activeReference.visible && overlayUrl !== undefined

  const canvasRef = useRef<HTMLElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** Everything one height drag needs to be stopped from anywhere. */
  const heightDrag = useRef<{ stop: () => void } | null>(null)
  /**
   * 길이 칸에 **적는 중인** 글자 (길이 조절 Patch).
   *
   * 값을 곧바로 반영하면 `1000`을 고치려고 지우는 순간 `1`이 최소 길이로 눌려
   * 붙어 버려 이어 적을 수가 없다. 그래서 적는 동안은 글자 그대로 두고, Enter나
   * 칸을 떠날 때 한 번만 반영한다. 반영하지 않는 동안에는 `null`이다.
   */
  const [heightDraft, setHeightDraft] = useState<string | null>(null)

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
            // 빈 자리를 누르면 선택이 풀린다. 그대로 끌면 범위 선택이 된다
            // (범위 선택 Patch) — 누르는 순간에는 둘을 구별할 수 없으므로,
            // 먼저 풀고 끌기 시작한 뒤에야 고르기로 넘어간다.
            if (e.target !== e.currentTarget || e.button !== 0) return
            selectBlock(null)
            const sheet = sheetRef.current
            if (sheet === null) return
            const box = sheet.getBoundingClientRect()
            const at = (ev: { clientX: number; clientY: number }) => ({
              x: (ev.clientX - box.left) / zoom,
              y: (ev.clientY - box.top) / zoom,
            })
            const from = at(e)
            let drew = false

            const onMove = (ev: PointerEvent) => {
              const area = marqueeRect(from, at(ev))
              // 손이 떨린 정도는 끌기가 아니다.
              if (!drew && area.width < MARQUEE_MIN_PX && area.height < MARQUEE_MIN_PX) return
              drew = true
              setMarquee(area)
            }
            const onUp = (ev: PointerEvent) => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
              setMarquee(null)
              if (!drew) return
              selectMany(blocksInRect(blocks, marqueeRect(from, at(ev))))
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
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
          {/* 지금 끌고 있는 선택 범위 (범위 선택 Patch). 눌러도 아무 일 없는
              장식이라, 손가락이 블록에 닿지 않도록 통과시킨다. */}
          {marquee !== null && (
            <div
              className="canvas__marquee"
              aria-hidden="true"
              style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
            />
          )}
          {/* 언제나 맨 뒤다. 블록 순서 도구는 이 레이어에 닿지 않는다 (§4). */}
          {backgroundUrl !== undefined && (
            <img
              className="canvas__background"
              src={backgroundUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
              style={{ width: canvasWidth, height: canvasHeight }}
            />
          )}
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

        {/* Page length. Only this page changes; the 840px width is fixed.
            끌기·자판·숫자 세 길이 같은 값을 가리킨다 (길이 조절 Patch) — 끌기는
            빠르고, 화살표는 마지막 몇 px을 맞추고, 숫자는 아는 길이를 바로 적는다. */}
        <div className="canvas__height-bar" style={{ top: canvasHeight * zoom }}>
          <button
            type="button"
            className="canvas__height-handle"
            aria-label="페이지 길이 조절"
            title="끌어서 조절 · ↑↓ 10px (Shift 100px) · PageUp/Down 400px"
            onKeyDown={(e) => {
              const delta = heightKeyDelta(e.key, e.shiftKey)
              if (delta === 0) return
              e.preventDefault()
              setCanvasHeight(canvasHeight + delta, 'canvas-height-key')
            }}
            onKeyUp={(e) => {
              // 한 번 누른 것은 실행 취소 한 걸음이다. 누르고 있는 동안만 뭉친다.
              if (heightKeyDelta(e.key, e.shiftKey) !== 0) endInteraction()
            }}
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
              const grabY = e.clientY
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
                // 잡은 자리를 함께 넘긴다 — 손잡이는 페이지 끝에 붙어 있어 잡는
                // 순간 이미 아래 가장자리 안인 일이 흔하다.
                const step = autoScrollStep(pointerY, box.top, box.bottom, grabY)
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
            ↕ 페이지 길이 조절
          </button>
          <label className="canvas__height-field">
            <input
              type="number"
              aria-label="페이지 길이 (px)"
              value={heightDraft ?? String(Math.round(canvasHeight))}
              onChange={(e) => setHeightDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
                // 적던 것을 버리고 지금 길이로 돌아온다.
                if (e.key === 'Escape') setHeightDraft(null)
              }}
              onBlur={() => {
                const asked = Number(heightDraft)
                setHeightDraft(null)
                if (heightDraft === null || heightDraft.trim() === '' || !Number.isFinite(asked)) return
                setCanvasHeight(asked)
                endInteraction()
              }}
            />
            <span aria-hidden="true">px</span>
          </label>
        </div>
      </div>
    </section>
  )
}
