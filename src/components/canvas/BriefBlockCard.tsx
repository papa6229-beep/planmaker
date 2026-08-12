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
import { imageFitOf } from '../../domain/imageLayout'
import { LAYER_MOVES, visibleLayerPosition } from '../../domain/layerOrder'
import { contentAspect, keepAspect, photoImageStyle, photoRect } from '../../domain/photoBox'
import { measurePhoto, type PhotoContent } from '../../services/photoContent'
import { buildPaperShape, type PaperShape } from '../../services/paperCutoutShape'
import {
  paperOutset,
  DEFAULT_PAPER_WEIGHT,
  DEFAULT_PAPER_OPACITY,
  PAPER_WEIGHT_MAX,
  PAPER_WEIGHT_MIN,
  PAPER_SHADOW,
} from '../../domain/paperCutout'
import { getAsset } from '../../services/assetStore'
import { canCarryLink, cardKindLabel, drawsBareText, textAlignOf, TEXT_ALIGNS, type TextAlign } from '../../domain/simpleBlocks'
import { CARD_CHROME_Y, CARD_PADDING_X, PLACEHOLDER_FONT_PX, fitBlockToText, fitTextSize } from '../../domain/textFit'
import { createLineMeasurer } from '../../features/editor/measureText'
import { isReferenceCapture } from '../../domain/summaryBuilder'
import type { BriefBlock } from '../../domain/briefSchema'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useAssets } from '../../features/assets/useAssets'
import { useStudioJob } from '../../features/studio/useStudioJob'
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
/** 떠 있는 도구막대가 블록 위에 설 수 있는 최소 여유 (긴급 Patch §2). */
const TOOLBAR_ROOM = 40

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
    state, moveBlock, moveSelected, resizeBlock, selectBlock, endInteraction, commitText,
    deleteBlock, duplicateBlock, removeBlockAsset, setBlockLink, setTextAlign,
    reorderBlock, freePlacement,
  } = useBriefEditor()
  const { getUrl, uploadFiles } = useAssets()
  const meta = getBlockTypeMeta(block.type)
  const align = textAlignOf(block)
  const thumbUrl = meta.requiresAsset ? getUrl(block.assetId) : undefined
  // 이미지 생성기 작업판에서만: 디자인팀이 이 자리에 연결한 실제 사용 제품
  // 이미지. 작성기에는 provider 자체가 없어 언제나 `undefined`이므로, 같은 카드가
  // 두 표면에서 그대로 쓰인다. 문서에는 아무것도 쓰이지 않는다 — 화면에서 참고
  // 이미지와 실사용 이미지를 눈으로 가르기 위한 표시일 뿐이다.
  const studio = useStudioJob()
  const productAssetId = meta.requiresAsset ? studio?.productImageOf(block.id) : undefined
  const productUrl = getUrl(productAssetId)
  // 작업자가 잠깐 원래 참고 캡처를 다시 볼 수 있다 (첫 사용 흐름 §7).
  const [showingReference, setShowingReference] = useState(false)
  const displayUrl = showingReference ? (thumbUrl ?? productUrl) : (productUrl ?? thumbUrl)
  const showingProduct = displayUrl !== undefined && displayUrl === productUrl && !showingReference
  /**
   * 사진 표현인가 (긴급 Patch §1).
   *
   * 작업판에서 **실제로 쓸 제품 이미지가 걸린** 자리만 참이다. 그 순간 이 블록은
   * "무엇이 들어갈지 적는 칸"이 아니라 그림 그 자체이므로, 카드도 라벨도 설명도
   * 남길 이유가 없다. 참고 캡처를 잠깐 되돌려 보는 동안에는 다시 카드로 돌아가
   * 그것이 참고용이라는 사실이 흐려지지 않는다.
   *
   * 작성기에는 `studio`가 없어 언제나 거짓이다 — 표면 하나로 갈린다.
   */
  const photo = studio !== null && productUrl !== undefined && !showingReference
  const [content, setContent] = useState<PhotoContent | null>(null)
  /** 이 이미지에 종이 컷아웃이 걸려 있는가 (Studio Patch §2). */
  const paperOn = photo && studio !== null && studio.effectsOf(block.id).paperCutout
  /**
   * 이 이미지에 그림자를 깔 것인가 (그림자 Patch).
   *
   * 스위치가 여기 있는 이유는, 어색한 그림자를 발견하는 자리가 바로 이 블록이기
   * 때문이다 — 그림을 올리고 그 그림을 보면서 안다. 우측 패널까지 갔다 오는 동안
   * 무엇을 보고 있었는지 놓친다.
   */
  const shadowOn = photo && studio !== null && studio.effectsOf(block.id).shadow
  /** 종이 테두리의 두께 (한방 생성 Patch §3). 모르는 값은 보통으로 읽힌다. */
  const paperWeight = studio === null ? DEFAULT_PAPER_WEIGHT : studio.effectsOf(block.id).paperWeight
  const paperOpacity = studio === null ? DEFAULT_PAPER_OPACITY : studio.effectsOf(block.id).paperOpacity
  const [paper, setPaper] = useState<PaperShape | null>(null)
  const [layerOpen, setLayerOpen] = useState(false)
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
  const layerRef = useRef<HTMLSpanElement | null>(null)

  // 메뉴가 열려 있는 동안만 바깥 클릭을 듣는다. 고른 블록은 그대로 두고 메뉴만
  // 닫으므로, 순서를 몇 번이든 이어서 바꿀 수 있다.
  useEffect(() => {
    if (!layerOpen) return
    const onDown = (e: MouseEvent) => {
      if (layerRef.current?.contains(e.target as Node)) return
      setLayerOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [layerOpen])
  /**
   * 더블클릭이 파일 선택창을 여는가 (손검수 Patch 2 §10).
   *
   * 작업판에서 이미지 블록이 하는 일은 하나 — 실제로 쓸 제품 이미지를 여기 거는
   * 것 — 이므로, 작성자가 참고 캡처를 붙여 뒀는지 여부와 상관없이 같은 자리를
   * 연다. 정작 채워야 할 빈 자리에서만 그것이 막혀 있던 것이 결함이었다.
   *
   * 작성기에서는 그대로다: 그림 없는 이미지 블록은 아직 "무엇이 들어갈지"부터
   * 적는 자리이고, 붙이는 그림은 참고용이다 (§12).
   */
  const dblClickPicksFile = meta.requiresAsset && (studio !== null || thumbUrl !== undefined)
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

  /**
   * 이 누끼의 실제 경계를 잰다.
   *
   * 파일에는 대개 투명한 띠가 붙어 있고, 그것까지 블록으로 삼으면 선택 테두리가
   * 보이지 않는 여백을 감싼다. 잰 값은 화면이 잠깐 들고 있을 뿐 저장소에도
   * 작업 파일에도 들어가지 않는다.
   */
  useEffect(() => {
    if (!photo || productAssetId === undefined) {
      setContent(null)
      return
    }
    let alive = true
    void (async () => {
      const asset = await getAsset(productAssetId)
      if (!alive || asset === undefined) return
      const measured = await measurePhoto(asset.blob)
      if (alive) setContent(measured)
    })()
    return () => {
      alive = false
    }
  }, [photo, productAssetId])

  /**
   * 종이 모양을 만든다.
   *
   * 껐을 때는 아예 만들지 않는다 — 꺼 둔 효과를 위해 계산을 돌리면, 쓰지도 않을
   * 그림 때문에 체크되지 않은 블록까지 느려진다. 씨앗은 자산 번호라, 같은 그림은
   * 언제나 같은 결로 잘린다.
   */
  useEffect(() => {
    if (!paperOn || productAssetId === undefined || content === null) {
      setPaper(null)
      return
    }
    let alive = true
    void (async () => {
      const asset = await getAsset(productAssetId)
      if (!alive || asset === undefined) return
      const shape = await buildPaperShape(asset.blob, content.box, productAssetId, paperWeight)
      if (alive) setPaper(shape)
    })()
    return () => {
      alive = false
    }
  }, [paperOn, productAssetId, content, paperWeight])

  /**
   * 연결하는 순간 블록을 그림 비율로 정리한다 (§1 이미지 경계).
   *
   * **연결·교체 때만**이다. 처음 마운트할 때의 자산은 이미 맞춰 둔 것으로 보므로,
   * 새로고침이 작업자가 조정해 둔 크기를 되돌리지 않는다.
   */
  const fittedFor = useRef<string | undefined>(productAssetId)
  useEffect(() => {
    if (content === null || productAssetId === undefined) return
    if (fittedFor.current === productAssetId) return
    fittedFor.current = productAssetId
    resizeBlock(block.id, photoRect(block.position, content.natural, content.box), `photo-fit:${block.id}`)
    endInteraction()
    // 잰 값이 도착하는 순간 한 번. 뒤이은 이동·크기 변경은 여기 오지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, productAssetId])

  const startDrag = (e: ReactPointerEvent) => {
    if (editing || linkOpen || e.button !== 0) return
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    if (additive) {
      selectBlock(block.id, true)
      return // additive click only toggles selection, never drags
    }
    if (!selected) selectBlock(block.id)

    /**
     * 여럿을 골라 두고 끌면 **고른 것 전부**가 따라온다 (여러 개 한 번에 Patch).
     *
     * 앞선 판은 잡은 것 하나만 움직였다. 열 개를 옮기려면 열 번 끌어야 했고,
     * 그러는 동안 서로의 간격이 조금씩 어긋났다.
     *
     * 고른 것이 하나면 지금까지의 길로 간다 — 그쪽은 "이 자리로"를 주고, 여럿은
     * "이만큼"을 준다. 하나짜리에 뺄셈을 끼워 넣을 이유가 없다.
     */
    const together = selected && state.selectedIds.length > 1
    e.preventDefault()
    drag.current = { startX: e.clientX, startY: e.clientY, origX: block.position.x, origY: block.position.y, moved: false }
    let lastDx = 0
    let lastDy = 0

    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      if (!d.moved && Math.abs(ev.clientX - d.startX) < DRAG_THRESHOLD_PX && Math.abs(ev.clientY - d.startY) < DRAG_THRESHOLD_PX) {
        return
      }
      d.moved = true
      const dx = (ev.clientX - d.startX) / scale
      const dy = (ev.clientY - d.startY) / scale
      if (together) {
        // 묶음 이동은 **직전 자리에서의 차이**로 준다. 시작점에서의 차이를 그대로
        // 주면 매번 처음부터 다시 더해져 손가락보다 빨리 달아난다.
        moveSelected(dx - lastDx, dy - lastDy, `move-many:${block.id}`)
        lastDx = dx
        lastDy = dy
        return
      }
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

    // 사진은 가로세로를 따로 늘리면 원본에 없던 찌그러짐이 생긴다 (§1).
    const aspect = photo && content !== null ? contentAspect(content.natural, content.box) : null
    const sized = (dx: number, dy: number) =>
      aspect === null
        ? resizeRect(startRect, handle, dx, dy, canvasWidth, canvasHeight, freePlacement)
        : keepAspect(startRect, handle, dx, dy, aspect)

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale
      const dy = (ev.clientY - startY) / scale
      resizeBlock(block.id, sized(dx, dy), `resize:${block.id}`)
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      // One settling pass at the end of the gesture: the size the user dragged
      // to decides the type size, and the wording then decides how much of that
      // box is actually kept (손검수 1 §3). Same coalesce key, so the drag and
      // its settling stay a single undo step.
      if (bare && hasContent(block)) {
        const dragged = sized((ev.clientX - startX) / scale, (ev.clientY - startY) / scale)
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
  // 이 블록이 보이는 순서에서 어디쯤인가 — 끝에 닿은 방향은 눌리지 않는다 (§2).
  const layerPos = visibleLayerPosition(state.brief.blocks, block.id)
  const atFront = layerPos !== null && layerPos.index >= layerPos.count - 1
  const atBack = layerPos !== null && layerPos.index <= 0
  const layerDisabled: Record<string, boolean> = {
    front: atFront,
    forward: atFront,
    backward: atBack,
    back: atBack,
  }

  const tools = (
    <span className="block-card__tools" onPointerDown={(e) => e.stopPropagation()}>
      {/* 종이 컷아웃 — 이 블록 하나에만 걸리는 디자인 효과다 (Studio Patch §2).
          AI 전송에서 빼거나 안전 모드를 뜻하지 않는다. */}
      {photo && studio !== null && (
        <label className="block-toolbar__check">
          <input
            type="checkbox"
            checked={paperOn}
            onChange={() => studio.setEffects(block.id, { paperCutout: !paperOn })}
          />
          종이 컷아웃
        </label>
      )}
      {/* 그림자 — 투명한 구멍이 많은 그림에서는 처음부터 꺼진 채로 온다
          (그림자 Patch). 어림짐작이므로 여기서 바로 되돌릴 수 있어야 한다. */}
      {photo && studio !== null && (
        <label className="block-toolbar__check">
          <input
            type="checkbox"
            checked={shadowOn}
            onChange={() => studio.setEffects(block.id, { shadow: !shadowOn })}
          />
          그림자
        </label>
      )}
      {/* 두께와 진하기는 켠 자리에만 나온다. 꺼 둔 블록에 보여 주면 무엇을
          두껍게 하는 값인지 화면이 말해 주지 못한다 (두께·투명도 Patch).

          단계가 아니라 슬라이더인 것은, 알맞은 두께가 그림마다 다르기 때문이다.
          진하기 0은 컷아웃을 끄는 것과 다르다 — 테두리만 보이지 않을 뿐 오브젝트도
          자리도 그대로다. */}
      {paperOn && studio !== null && (
        <span className="block-card__paper-tune" role="group" aria-label="종이 테두리">
          <label className="block-card__tune">
            <span className="block-card__tune-label">두께</span>
            <input
              type="range"
              min={Math.round(PAPER_WEIGHT_MIN * 100)}
              max={Math.round(PAPER_WEIGHT_MAX * 100)}
              value={Math.round(paperWeight * 100)}
              aria-label="종이 테두리 두께"
              title={`종이 테두리 두께 ${paperWeight.toFixed(2)}배`}
              onChange={(e) => studio.setEffects(block.id, { paperWeight: Number(e.target.value) / 100 })}
            />
          </label>
          <label className="block-card__tune">
            <span className="block-card__tune-label">진하기</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(paperOpacity * 100)}
              aria-label="종이 테두리 진하기"
              title={`종이 테두리 진하기 ${String(Math.round(paperOpacity * 100))}%`}
              onChange={(e) => studio.setEffects(block.id, { paperOpacity: Number(e.target.value) / 100 })}
            />
          </label>
        </span>
      )}

      {/* 레이어 순서는 블록 바로 옆에서 바꾼다 — 우측 패널까지 갔다 오는 동안
          "무엇을 고르고 있었는지"를 놓치기 때문이다 (긴급 Patch §2). */}
      <span className="block-card__layer" ref={layerRef}>
        <button
          type="button"
          className={`block-card__tool block-card__layer-trigger${layerOpen ? ' is-open' : ''}`}
          // 블록 이름을 붙이지 않는다. 도구막대는 고른 블록의 것이라 이름이
          // 겹칠 일이 없고, 붙이면 블록 이름으로 무엇을 찾든 이 버튼이 함께
          // 걸린다 — 정렬 버튼들이 이미 같은 규칙을 쓴다.
          aria-label="레이어 순서"
          aria-expanded={layerOpen}
          title="레이어 순서"
          onClick={() => setLayerOpen((v) => !v)}
        >
          레이어 ▾
        </button>
        {layerOpen && (
          <span className="block-card__layer-panel">
            {LAYER_MOVES.map((move) => (
              <button
                key={move.value}
                type="button"
                className="block-card__menu-item"
                disabled={layerDisabled[move.value] === true}
                onClick={() => {
                  reorderBlock(block.id, move.value)
                  // 고른 블록은 그대로, 메뉴만 닫는다.
                  setLayerOpen(false)
                }}
              >
                {move.label}
              </button>
            ))}
          </span>
        )}
      </span>
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
              {studio === null
                ? (thumbUrl ? '참고 이미지 교체' : '참고 이미지 넣기')
                : (productAssetId === undefined ? '제품 이미지 넣기' : '제품 이미지 교체')}
            </button>
          )}
          {meta.requiresAsset && studio === null && thumbUrl && (
            <button type="button" className="block-card__menu-item" onClick={() => { closeMenu(); removeBlockAsset(block.id) }}>
              참고 이미지 제거
            </button>
          )}
          {/* 작업판에서 지우는 것은 연결한 제품 이미지뿐이다. 작성자가 붙인
              참고 캡처는 기획서의 내용이라 여기서 지울 수 없다. */}
          {meta.requiresAsset && studio !== null && productAssetId !== undefined && (
            <button type="button" className="block-card__menu-item" onClick={() => { closeMenu(); setShowingReference(false); studio.removeProductImage(block.id) }}>
              제품 이미지 제거
            </button>
          )}
          {meta.requiresAsset && studio !== null && thumbUrl !== undefined && productAssetId !== undefined && (
            <button type="button" className="block-card__menu-item" onClick={() => { closeMenu(); setShowingReference((v) => !v) }}>
              {showingReference ? '제품 이미지 보기' : '참고 이미지 보기'}
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
  /** 카드 대신 떠 있는 도구막대를 쓰는가 — 인쇄되는 문구와 사진. */
  const floating = bare || photo
  /** 캔버스 위쪽에 도구막대가 설 자리가 없으면 블록 아래로 내린다. */
  const toolbarBelow = block.position.y < TOOLBAR_ROOM

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
        // 연결된 제품 이미지는 그림 그 자체다 — CSS가 이 하나로 껍데기를 걷는다.
        photo ? 'block-card--photo' : '',
        paperOn ? 'block-card--paper' : '',
        selected ? 'is-selected' : '',
        // 열려 있는 팝오버(링크 입력·⋯ 메뉴)만 뒤 카드보다 앞으로 나온다.
        // **선택만으로는 나오지 않는다** — 고른 것이 앞으로 튀어나오면 작업자가
        // 정한 레이어 순서가 클릭 한 번에 뒤집혀 보인다 (배경 합성 1차 §4).
        editing || linkOpen ? 'is-front' : '',
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
      onDoubleClick={() => (dblClickPicksFile ? openFilePicker() : beginEdit())}
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
      {floating ? (
        <>
          {/* Whether an address is attached has to be readable without
              selecting the block, so this marker sits on the block's own
              corner, outside its layout (1-C §7.3). */}
          {linkUrl !== undefined && !selected && <span className="block-card__link-mark">{linkBadge}</span>}
          {/* Floating bar, drawn above the block and outside its box (§3.2).
              위쪽에 자리가 없으면 아래로 내려 그림을 가리지 않는다 (긴급 Patch §2). */}
          {selected && (
            <span
              className={`block-toolbar${toolbarBelow ? ' block-toolbar--below' : ''}`}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* The block's own name (문구 · 버튼 · 혜택 …), which is what the
                  label line used to say inside the box. */}
              <span className="block-toolbar__kind">{block.label}</span>
              {/* Where the wording sits inside the box the planner drew. Only
                  wording has a side to sit on, so only 문구 blocks show it. */}
              {bare && (
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
              )}
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
          {displayUrl === undefined && <span className="block-card__title">{block.label}</span>}
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
      ) : photo && displayUrl ? (
        // 그림 하나. 라벨도 배지도 설명도 없다 (긴급 Patch §1).
        //
        // 경계를 잰 뒤에는 그림을 확대해 밀어 넣어 **내용 상자가 블록을 정확히
        // 채운다** — 선택 테두리와 조작점이 보이는 그림과 같은 자리에 선다.
        // 아직 재기 전이거나 `블록 채우기`를 고른 자리에서는 지금까지처럼 블록을
        // 틀로 삼는다.
        <>
          {paper !== null && (
            <img
              className="block-card__paper"
              src={paper.url}
              alt=""
              aria-hidden="true"
              draggable={false}
              // 종이는 그림보다 크므로 블록 밖으로 나간다. 잘라내는 것은 최종
              // 캔버스 경계뿐이다 (§3).
              style={(() => {
                const out = paperOutset(paper.content, paper.pad)
                // `drop-shadow()`는 백분율 길이를 받지 않는다 — 넣으면 필터 전체가
                // 조용히 버려진다. 블록의 짧은 변에서 픽셀 값을 만든다.
                const short = Math.min(block.position.width, block.position.height)
                const px = (ratio: number) => `${(short * ratio).toFixed(2)}px`
                return {
                  left: `${-out.x * 100}%`,
                  top: `${-out.y * 100}%`,
                  width: `${(1 + out.x * 2) * 100}%`,
                  height: `${(1 + out.y * 2) * 100}%`,
                  // 진하기는 종이와 그림자에 함께 걸린다 — 종이만 옅어지고
                  // 그림자가 남으면 무엇이 그림자를 지는지 알 수 없다.
                  opacity: paperOpacity,
                  filter: `drop-shadow(${px(PAPER_SHADOW.dx)} ${px(PAPER_SHADOW.dy)} ${px(PAPER_SHADOW.blur)} rgba(24, 26, 34, ${PAPER_SHADOW.opacity}))`,
                }
              })()}
            />
          )}
        <span className="block-card__photo-clip">
          <img
            className="block-card__thumb"
            src={displayUrl}
            alt="실제 사용 제품 이미지"
            draggable={false}
            style={
              content !== null && imageFitOf(block) === 'contain'
                ? { position: 'absolute', objectFit: 'contain', ...photoImageStyle(block.position, content.box) }
                : { objectFit: imageFitOf(block) }
            }
          />
        </span>
        </>
      ) : displayUrl ? (
        // The capture, what it is a stand-in for, and — plainly — that it is
        // only a stand-in (1-B §2.3).
        <>
          <span className="block-card__thumb-wrap">
            <img
              className="block-card__thumb"
              src={displayUrl}
              alt={showingProduct ? '실제 사용 제품 이미지' : (block.image?.productName ?? block.label)}
              draggable={false}
              // 화면에서 보이는 대로가 최종 결과다 (§3.1).
              style={{ objectFit: imageFitOf(block) }}
            />
            {/* Sits on the picture itself, so what it is for is never in doubt. */}
            {showingProduct ? (
              <span className="block-card__ref-note block-card__ref-note--product">실제 사용 제품 이미지</span>
            ) : (
              isReferenceCapture(block) && (
                <span className="block-card__ref-note">참고용 이미지 · 최종 사용 이미지 아님</span>
              )
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
        // 빈 자리는 이 글이 카드의 거의 전부다. 여기서만 다르게 굴면 사람은
        // "어디를 눌러야 열리는지"를 외워야 한다 — 카드와 같은 곳을 연다.
        <span
          className={`block-card__slot${hasContent(block) ? '' : ' block-card__content--placeholder'}`}
          onDoubleClick={(e) => {
            if (dblClickPicksFile) return // 카드의 처리기가 파일 선택창을 연다
            e.stopPropagation()
            beginEdit()
          }}
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
