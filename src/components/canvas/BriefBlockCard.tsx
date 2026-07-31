/**
 * A meaning card on the canvas (WORK_PLAN §3, §4, §12; 중앙 직접 편집 §2–§4).
 *
 * Almost all editing happens here rather than in a side panel:
 *  - 문구: double-click or Enter edits in place, and the drawn type size follows
 *    the block's size (`textFit`), so making a block bigger makes the wording
 *    bigger. When even the minimum readable size will not fit, the card says so
 *    instead of shrinking the text into illegibility.
 *  - 이미지: the block asks what image belongs there and takes the answer
 *    inline; dropping, picking, or pasting attaches a *reference capture* that
 *    shows the idea — never the file the finished page will use.
 *  - 링크: a small chain control on 이미지 and 버튼 opens a URL field. The URL is
 *    stored in a paired publishing block, never in the design wording.
 *
 * The card is draggable (move) and resizable (corner handles).
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getBlockTypeMeta, type BlockCategory } from '../../domain/blockTypes'
import { canCarryLink, cardKindLabel, drawsBareText, textAlignOf, TEXT_ALIGNS, type TextAlign } from '../../domain/simpleBlocks'
import { CARD_CHROME_Y, CARD_PADDING_X, PLACEHOLDER_FONT_PX, fitBlockToText, fitTextSize } from '../../domain/textFit'
import { createLineMeasurer } from '../../features/editor/measureText'
import { isReferenceCapture } from '../../domain/summaryBuilder'
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
   * True when this card is the visible half of a link pair. The pair is held
   * together by a group id, but that is internal plumbing — the card must not
   * advertise itself as a user-made group.
   */
  paired?: boolean
  /** URL currently attached through the paired publishing block, if any. */
  linkUrl?: string
}

const CATEGORY_MODIFIER: Record<BlockCategory, string> = {
  text: 'text',
  image: 'image',
  structure: 'structure',
  reference: 'reference',
}

const IMAGE_ACCEPT = ACCEPTED_MIME_TYPES.join(',')
/** Built once: measuring asks the browser for the card's own font. */
const measureLine = createLineMeasurer()
const DRAG_THRESHOLD_PX = 3

/**
 * Alignment icon: three lines, the middle one short, pushed to the side the
 * wording will sit on. Shape only — the button's accessible name is Korean.
 */
function AlignIcon({ align }: { align: TextAlign }) {
  const short = { left: 'M2 8h8', center: 'M4 8h8', right: 'M6 8h8' }[align]
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M2 4h12" />
      <path d={short} />
      <path d="M2 12h12" />
    </svg>
  )
}

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

function hasImageFiles(types: readonly string[]): boolean {
  return types.includes('Files')
}

/** True for anything the user could be typing into right now. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
}

/** Small chain glyph used for the link control. */
function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  )
}

export function BriefBlockCard({ block, selected, scale, canvasWidth, canvasHeight, paired = false, linkUrl }: Props) {
  const {
    moveBlock, resizeBlock, selectBlock, endInteraction, commitText,
    deleteBlock, duplicateBlock, removeBlockAsset, setBlockLink, setTextAlign,
  } = useBriefEditor()
  const { getUrl, uploadFiles } = useAssets()
  const meta = getBlockTypeMeta(block.type)
  const align = textAlignOf(block)
  const thumbUrl = meta.requiresAsset ? getUrl(block.assetId) : undefined
  const drag = useRef<DragState | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDetailsElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [dropActive, setDropActive] = useState(false)

  // Text blocks take wording in place; an image block takes the description of
  // what belongs there, with or without a reference capture attached to it.
  const takesInlineText = meta.hasText || meta.requiresAsset
  const linkable = canCarryLink(block.type)
  // Printed wording is drawn bare, so its box is measured as pure text area;
  // the kinds that keep a card are measured with that card's chrome.
  const bare = drawsBareText(block)
  const fitArea = bare
    ? (measureLine ? { measure: measureLine } : {})
    : { padX: CARD_PADDING_X, padY: CARD_CHROME_Y, ...(measureLine ? { measure: measureLine } : {}) }
  const fit = fitTextSize(block.content ?? '', block.position.width, block.position.height, fitArea)
  // While typing, the wording on screen is the draft, so it is what decides the
  // size. An empty field shows the hint, which is not the user's wording and is
  // drawn at its own plain size.
  const draftFit = editing
    ? draft.trim().length === 0
      ? PLACEHOLDER_FONT_PX
      : fitTextSize(draft, block.position.width, block.position.height, fitArea).fontSize
    : fit.fontSize

  const beginEdit = () => {
    if (!takesInlineText) return
    setDraft(block.content ?? '')
    setEditing(true)
  }
  const commitEdit = () => {
    setEditing(false)
    if (draft === (block.content ?? '')) return
    // Settle the box around the wording as it will actually be drawn, so no
    // empty band is left beside or under it (손검수 1 §3).
    if (bare) {
      const settled = fitBlockToText(draft, block.position, fitArea)
      commitText(block.id, draft, { ...block.position, width: settled.width, height: settled.height })
    } else {
      commitText(block.id, draft)
    }
  }
  const openFilePicker = () => fileRef.current?.click()
  const closeMenu = () => menuRef.current?.removeAttribute('open')

  /**
   * A block added from the palette opens ready to type (단계 1-A §4.2): it is
   * brand new, selected, and still empty, so the only thing left to do is say
   * what goes in it. Existing blocks are unaffected — they still open on a
   * double-click.
   */
  const autoEdited = useRef(false)
  useEffect(() => {
    if (autoEdited.current) return
    autoEdited.current = true
    if (!selected || !takesInlineText || hasContent(block)) return
    setDraft('')
    setEditing(true)
    // Mount-only: this is about how the block was created, not about later
    // selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * A picture arriving ends the description edit (손검수 1 §4). While the field
   * is open it covers the block: the capture would not be visible, the block
   * would not drag, and the ⋯ menu would act on a card that looks unchanged.
   */
  useEffect(() => {
    if (thumbUrl !== undefined && editing) commitEdit()
    // Only the arrival of a picture matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbUrl])

  // Paste a reference capture straight onto the selected image block. Only an
  // image on the clipboard is taken, and never while the paste is going into a
  // field someone is typing in — ordinary text pasting is untouched.
  useEffect(() => {
    if (!selected || !meta.requiresAsset) return
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return
      const items = Array.from(e.clipboardData?.items ?? [])
      const files = items
        .filter((i) => i.kind === 'file' && ACCEPTED_MIME_TYPES.includes(i.type as never))
        .map((i) => i.getAsFile())
        .filter((f): f is File => f !== null)
      if (files.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      void uploadFiles(files, { targetBlockId: block.id })
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [selected, meta.requiresAsset, block.id, uploadFiles])

  const startDrag = (e: ReactPointerEvent) => {
    if (editing || linkOpen || e.button !== 0) return
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
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      // One settling pass at the end of the gesture: the size the user dragged
      // to decides the type size, and the wording then decides how much of that
      // box is actually kept (손검수 1 §3). Same coalesce key, so the drag and
      // its settling stay a single undo step.
      if (bare && hasContent(block)) {
        const dragged = resizeRect(startRect, handle, (ev.clientX - startX) / scale, (ev.clientY - startY) / scale, canvasWidth, canvasHeight)
        const settled = fitBlockToText(block.content ?? '', dragged, fitArea)
        resizeBlock(block.id, { ...dragged, width: settled.width, height: settled.height }, `resize:${block.id}`)
      }
      // The reducer keeps layoutHint.emphasis in step with the size, so ending
      // the gesture commits both the box and the emphasis as one undo step.
      endInteraction()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const dropFiles = (files: File[]) => {
    if (files.length === 0) return
    void uploadFiles(files, { targetBlockId: block.id })
  }

  /**
   * The kind and the ⋯ menu, shown either in the card head (kinds that keep a
   * card) or in the floating bar above a selected bare block. Either way it is
   * screen furniture: it is not part of the block's box and never reaches the
   * saved position, the AI placement data, or the content fingerprint.
   */
  const tools = (
    <span className="block-card__tools" onPointerDown={(e) => e.stopPropagation()}>
      {linkable && (
        <button
          type="button"
          className="block-card__tool"
          aria-label={`${block.label} 링크 연결`}
          title="연결 주소 입력"
          onClick={() => {
            setLinkDraft(linkUrl ?? '')
            setLinkOpen((v) => !v)
          }}
        >
          <LinkIcon />
        </button>
      )}
      <details className="block-card__menu" ref={menuRef}>
        <summary className="block-card__menu-trigger" aria-label={`${block.label} 블록 메뉴`}>⋯</summary>
        <div className="block-card__menu-panel">
          {meta.requiresAsset && (
            <button type="button" className="block-card__menu-item" onClick={() => { closeMenu(); openFilePicker() }}>
              {thumbUrl ? '참고 이미지 교체' : '참고 이미지 넣기'}
            </button>
          )}
          {meta.requiresAsset && thumbUrl && (
            <button type="button" className="block-card__menu-item" onClick={() => { closeMenu(); removeBlockAsset(block.id) }}>
              참고 이미지 제거
            </button>
          )}
          {meta.requiresAsset && thumbUrl && (
            <button type="button" className="block-card__menu-item" onClick={() => { closeMenu(); beginEdit() }}>
              설명 수정
            </button>
          )}
          <button type="button" className="block-card__menu-item" onClick={() => { closeMenu(); duplicateBlock(block.id) }}>
            블록 복제
          </button>
          <button type="button" className="block-card__menu-item block-card__menu-item--danger" onClick={() => { closeMenu(); deleteBlock(block.id) }}>
            삭제
          </button>
        </div>
      </details>
    </span>
  )

  const linkBadge = linkUrl !== undefined && (
    <span className="block-card__link-badge" title={`연결됨: ${linkUrl}`} aria-label="연결된 주소 있음">
      <LinkIcon />
    </span>
  )
  const overflowBadge = fit.overflow && (
    <span className="block-card__overflow" title="글이 블록보다 깁니다. 블록을 키워 주세요.">
      블록이 작아요
    </span>
  )

  return (
    <div
      className={[
        'block-card',
        `block-card--${CATEGORY_MODIFIER[meta.category]}`,
        `block-card--vis-${block.aiVisibility}`,
        block.groupId !== undefined && !paired ? 'block-card--grouped' : '',
        // Printed wording carries no card: the box is the wording area itself.
        bare ? 'block-card--bare' : '',
        selected ? 'is-selected' : '',
        // A card whose popovers can be open has to paint above later siblings,
        // otherwise the next card swallows clicks on the link editor / ⋯ menu.
        selected || editing || linkOpen ? 'is-front' : '',
        dropActive ? 'is-drop-target' : '',
        fit.overflow ? 'is-overflowing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: block.position.x, top: block.position.y, width: block.position.width, height: block.position.height }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      // The kind and label are no longer drawn inside a text block, so the
      // block still says what it is to a screen reader (and to tests) here.
      aria-label={hasContent(block) ? `${block.label}: ${block.content}` : block.label}
      onPointerDown={startDrag}
      onDoubleClick={() => (meta.requiresAsset && thumbUrl ? openFilePicker() : beginEdit())}
      onDragOver={(e) => {
        if (!meta.requiresAsset || !hasImageFiles(Array.from(e.dataTransfer.types))) return
        e.preventDefault()
        e.stopPropagation()
        setDropActive(true)
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setDropActive(false)
      }}
      onDrop={(e) => {
        if (!meta.requiresAsset || !hasImageFiles(Array.from(e.dataTransfer.types))) return
        e.preventDefault()
        e.stopPropagation()
        setDropActive(false)
        dropFiles(Array.from(e.dataTransfer.files))
      }}
      onKeyDown={(e) => {
        if (editing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          if (takesInlineText) beginEdit()
          else selectBlock(block.id, e.shiftKey)
        } else if (e.key === ' ') {
          e.preventDefault()
          selectBlock(block.id, e.shiftKey)
        }
      }}
    >
      {bare ? (
        <>
          {/* Whether an address is attached has to be readable without
              selecting the block, so this marker sits on the block's own
              corner, outside its layout (1-C §7.3). */}
          {linkUrl !== undefined && !selected && <span className="block-card__link-mark">{linkBadge}</span>}
          {/* Floating bar, drawn above the block and outside its box (§3.2). */}
          {selected && (
            <span className="block-toolbar" onPointerDown={(e) => e.stopPropagation()}>
              {/* The block's own name (문구 · 버튼 · 혜택 …), which is what the
                  label line used to say inside the box. */}
              <span className="block-toolbar__kind">{block.label}</span>
              {/* Where the wording sits inside the box the planner drew. Only
                  wording has a side to sit on, so only 문구 blocks show it. */}
              <span className="block-toolbar__aligns" role="group" aria-label="문구 정렬">
                {TEXT_ALIGNS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={`block-toolbar__align${align === value ? ' is-active' : ''}`}
                    aria-label={label}
                    aria-pressed={align === value}
                    title={label}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      setTextAlign(block.id, value)
                    }}
                  >
                    <AlignIcon align={value} />
                  </button>
                ))}
              </span>
              {block.groupId !== undefined && !paired && <span className="block-card__group" title="그룹">그룹</span>}
              {linkBadge}
              {overflowBadge}
              {tools}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="block-card__head">
            {/* Plain-language kind, so an unselected card is still identifiable
                without knowing the internal type or AI-visibility vocabulary. */}
            <span className="block-card__visibility">{cardKindLabel(block)}</span>
            {block.groupId !== undefined && !paired && <span className="block-card__group" title="그룹">그룹</span>}
            {linkBadge}
            {overflowBadge}
            {selected && tools}
          </span>
          {/* With a capture attached the badge already names the block, and the
              room is better spent on the picture and its description. */}
          {thumbUrl === undefined && <span className="block-card__title">{block.label}</span>}
        </>
      )}

      {editing ? (
        <textarea
          className="block-card__editor"
          value={draft}
          autoFocus
          aria-label={`${block.label} 내용`}
          placeholder={meta.requiresAsset ? '어떤 이미지가 들어갈지 적어주세요' : `${meta.label} 입력…`}
          style={{ fontSize: meta.requiresAsset ? undefined : draftFit, textAlign: align }}
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
        // The capture, what it is a stand-in for, and — plainly — that it is
        // only a stand-in (1-B §2.3).
        <>
          <span className="block-card__thumb-wrap">
            <img className="block-card__thumb" src={thumbUrl} alt={block.image?.productName ?? block.label} draggable={false} />
            {/* Sits on the picture itself, so what it is for is never in doubt. */}
            {isReferenceCapture(block) && (
              <span className="block-card__ref-note">참고용 이미지 · 최종 사용 이미지 아님</span>
            )}
          </span>
          <span
            className={`block-card__slot${hasContent(block) ? '' : ' block-card__content--placeholder'}`}
            onDoubleClick={(e) => {
              e.stopPropagation()
              beginEdit()
            }}
          >
            {hasContent(block) ? block.content : '어떤 이미지가 들어갈지 적어주세요'}
          </span>
        </>
      ) : meta.requiresAsset ? (
        <span
          className={`block-card__slot${hasContent(block) ? '' : ' block-card__content--placeholder'}`}
          onDoubleClick={beginEdit}
        >
          {hasContent(block) ? block.content : '어떤 이미지가 들어갈지 적어주세요'}
        </span>
      ) : (
        <span
          className={`block-card__content${hasContent(block) ? '' : ' block-card__content--placeholder'}`}
          style={{ fontSize: fit.fontSize, textAlign: align }}
        >
          {hasContent(block) ? block.content : `${meta.label} 입력…`}
        </span>
      )}

      {linkOpen && (
        <div className="block-card__link-editor" onPointerDown={(e) => e.stopPropagation()}>
          <input
            className="block-card__link-input"
            type="text"
            autoFocus
            placeholder="https://"
            aria-label={`${block.label} 연결 주소`}
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                setBlockLink(block.id, linkDraft)
                setLinkOpen(false)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setLinkOpen(false)
              }
            }}
          />
          <button
            type="button"
            className="btn block-card__link-save"
            onClick={() => {
              setBlockLink(block.id, linkDraft)
              setLinkOpen(false)
            }}
          >
            저장
          </button>
          <p className="block-card__link-note">주소는 퍼블리싱 정보로만 보관됩니다.</p>
        </div>
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
