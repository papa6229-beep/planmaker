/**
 * Simplified authoring view model (기획서 작성 화면 1차 단순화).
 *
 * The editor now offers the user only FOUR tools. This module is the mapping
 * layer between those four and the existing 34-type block catalog — it adds no
 * new block type, no new persisted field, and no schema version bump. Existing
 * documents keep their explicit semantic types (`main_headline`, `price`, …)
 * and stay fully editable; the four tools simply decide what a *new* block is
 * made of.
 *
 * Design rules behind the mapping:
 *  - 글 넣기 always creates the neutral `free_text`. Emphasis is stored ONLY in
 *    `layoutHint.emphasis` — text being large does not make it a headline, and
 *    deciding the semantic role is the AI's job, not the user's.
 *  - 이미지 자리 is a placeholder first: the short description lives in
 *    `content`, the actual upload is optional, and `required` stays false so an
 *    empty slot never blocks export.
 *  - 버튼·링크 is ONE thing to the user but stays TWO blocks in the data, so the
 *    URL remains publishing-only and never reaches the image AI: a design
 *    `cta_button` (the visible wording) paired with a publishing `button_url`
 *    (the address). The pair is linked with the existing `groupId` field.
 *  - 요청 메모 reuses `revision_reference` with `reference` visibility: read by
 *    the AI / design team as an instruction, never printed into the image.
 */

import { getBlockTypeMeta, type BlockType } from './blockTypes'
import type { BriefBlock, LayoutEmphasis } from './briefSchema'

/** The four tools shown to the user. */
export type SimpleBlockKind = 'text' | 'imageSlot' | 'buttonLink' | 'note'

export interface SimpleBlockDef {
  kind: SimpleBlockKind
  /** Palette label. */
  label: string
  /** One-line help shown under the label. */
  hint: string
  /** Default label given to a newly created block. */
  blockLabel: string
}

export const SIMPLE_BLOCKS: SimpleBlockDef[] = [
  { kind: 'text', label: '글 넣기', hint: '넣을 내용을 그대로 적습니다', blockLabel: '문구' },
  { kind: 'imageSlot', label: '이미지', hint: '사진을 넣거나 들어갈 자리를 적습니다', blockLabel: '이미지' },
  { kind: 'buttonLink', label: '버튼·링크', hint: '버튼에 보일 글과 연결 주소', blockLabel: '버튼' },
  { kind: 'note', label: '요청 메모', hint: '이미지에 넣지 않고 전달할 요청입니다', blockLabel: '요청 메모' },
]

/**
 * What the palette offers for a *new* block: three things, not four.
 *
 * 요청 메모 is no longer a way to start a block — the document-wide 전체 컨셉
 * carries that intent now. The kind itself stays in `SIMPLE_BLOCKS` above:
 * existing `revision_reference` blocks keep their name, their card, their
 * editing, and their place in the AI summary.
 */
export const PALETTE_TOOLS: SimpleBlockDef[] = SIMPLE_BLOCKS.filter((tool) => tool.kind !== 'note')

/**
 * Default box for a *new* 이미지 block. Taller than a text block on purpose: a
 * reference capture the design team cannot make out is not reference material,
 * and at the old 96px the picture was left about 34px of room.
 *
 * Only new blocks get this. Blocks in existing documents keep the size they
 * were saved with, and attaching a picture never resizes a block the planner
 * has already placed.
 */
export const NEW_IMAGE_BLOCK_HEIGHT = 210

/**
 * Rows the image card spends around the picture — its padding, the kind badge
 * row, the gaps, and the one-line description underneath. Measured against the
 * rendered card, so `imagePreviewHeight` says what the planner actually sees.
 */
const IMAGE_CARD_CHROME_Y = 62

/** Height left for the picture inside an image block of this height. */
export function imagePreviewHeight(blockHeight: number): number {
  return Math.max(0, blockHeight - IMAGE_CARD_CHROME_Y)
}

/** Block type each tool creates. 버튼·링크 additionally creates `button_url`. */
export const SIMPLE_BLOCK_TYPE: Record<SimpleBlockKind, BlockType> = {
  text: 'free_text',
  imageSlot: 'main_product_image',
  buttonLink: 'cta_button',
  note: 'revision_reference',
}

/**
 * Which publishing block carries the link for a given design block.
 *
 * Both entries reuse an existing type with the right meaning rather than
 * inventing one: a button links through `button_url`, and an image on an event
 * page almost always links to the product detail page, which is exactly what
 * `product_detail_link` means. Both stay `publishing`, so a URL never reaches
 * the image AI.
 */
export const LINK_TYPE_FOR: Partial<Record<BlockType, BlockType>> = {
  cta_button: 'button_url',
  main_product_image: 'product_detail_link',
  sub_product_image: 'product_detail_link',
  product_group_image: 'product_detail_link',
  existing_full_image: 'product_detail_link',
  logo: 'product_detail_link',
}

/** Publishing types that can be the link half of a pair. */
const LINK_TYPES: ReadonlySet<BlockType> = new Set(Object.values(LINK_TYPE_FOR))

/** True when this design block can carry a link. */
export function canCarryLink(type: BlockType): boolean {
  return LINK_TYPE_FOR[type] !== undefined
}

/** @deprecated kept for the 버튼·링크 factory; prefer `LINK_TYPE_FOR`. */
export const LINK_URL_TYPE: BlockType = 'button_url'

/** The block type carrying a 요청 메모 (non-printing instruction). */
export const NOTE_TYPE: BlockType = 'revision_reference'

// ── Emphasis (글 넣기) ───────────────────────────────────────────────────────

/**
 * The three emphasis levels offered for 글 넣기. Stored in
 * `layoutHint.emphasis` only — never by swapping the block type.
 */
export type SimpleEmphasis = 'high' | 'normal' | 'low'

export const EMPHASIS_CHOICES: { value: SimpleEmphasis; label: string }[] = [
  { value: 'high', label: '크게 강조' },
  { value: 'normal', label: '보통' },
  { value: 'low', label: '작게' },
]

/** Reads a block's emphasis as one of the three simple levels. */
export function simpleEmphasisOf(block: BriefBlock): SimpleEmphasis {
  const e = block.layoutHint.emphasis
  if (e === 'high' || e === 'very_high') return 'high'
  if (e === 'low') return 'low'
  return 'normal'
}

/** Maps a simple level onto the stored `LayoutEmphasis`. */
export function toLayoutEmphasis(level: SimpleEmphasis): LayoutEmphasis {
  return level
}

// ── Kind detection ──────────────────────────────────────────────────────────

/**
 * Which of the four tools a block is presented as, or `null` for a legacy
 * block with an explicit semantic type (those keep the generic editor so old
 * documents stay editable without being rewritten).
 */
export function simpleKindOf(block: BriefBlock): SimpleBlockKind | null {
  if (block.type === SIMPLE_BLOCK_TYPE.text) return 'text'
  if (block.type === SIMPLE_BLOCK_TYPE.buttonLink) return 'buttonLink'
  if (block.type === NOTE_TYPE) return 'note'
  if (block.type === SIMPLE_BLOCK_TYPE.imageSlot) return 'imageSlot'
  return null
}

/**
 * True when the block's box on the canvas *is* its wording area (단계 1-A §3.1).
 *
 * Wording that gets printed into the image is drawn bare, so the block's
 * position and size say exactly where that wording goes. Everything else — an
 * image slot waiting for a picture, a legacy 요청 메모 that is never printed —
 * keeps its card, because for those the card is the thing being placed.
 */
export function drawsBareText(block: BriefBlock): boolean {
  return getBlockTypeMeta(block.type).hasText && block.aiVisibility === 'design'
}

// ── 문구 정렬 ────────────────────────────────────────────────────────────────

/**
 * How the wording sits inside its block (v1 마감 §3).
 *
 * Stored in the existing `layoutHint.alignment`, which the AI summary already
 * carries, rather than in a second field meaning the same thing. `free` — what
 * the hint means when nobody chose — reads as 왼쪽 here, so a document written
 * before this feature keeps looking exactly as it did.
 */
export type TextAlign = 'left' | 'center' | 'right'

export const TEXT_ALIGNS: { value: TextAlign; label: string }[] = [
  { value: 'left', label: '왼쪽 정렬' },
  { value: 'center', label: '가운데 정렬' },
  { value: 'right', label: '오른쪽 정렬' },
]

/** The alignment a block is drawn with; 왼쪽 unless one was chosen. */
export function textAlignOf(block: BriefBlock): TextAlign {
  const hint = block.layoutHint.alignment
  return hint === 'center' || hint === 'right' ? hint : 'left'
}

/** Short kind label shown on the canvas card so blocks are told apart at a glance. */
export function cardKindLabel(block: BriefBlock): string {
  const kind = simpleKindOf(block)
  if (kind !== null) return SIMPLE_BLOCKS.find((s) => s.kind === kind)!.label
  return getBlockTypeMeta(block.type).label
}

// ── 버튼·링크 pairing ────────────────────────────────────────────────────────

/**
 * Finds the publishing `button_url` paired with a `cta_button` (or vice versa).
 *
 * A pair is only recognised when it is unambiguous: both blocks share a
 * `groupId` and that group holds exactly one `cta_button` and one `button_url`.
 * Legacy standalone `button_url` blocks therefore keep behaving as before — we
 * never guess, and no data is rewritten to create pairs.
 */
export function findLinkPartner(
  blocks: readonly BriefBlock[],
  block: BriefBlock,
): BriefBlock | undefined {
  const { groupId } = block
  if (groupId === undefined) return undefined
  const isCarrier = canCarryLink(block.type)
  const isLink = LINK_TYPES.has(block.type)
  if (!isCarrier && !isLink) return undefined

  const members = blocks.filter((b) => b.groupId === groupId)
  if (members.length !== 2) return undefined
  const carriers = members.filter((b) => canCarryLink(b.type))
  const links = members.filter((b) => LINK_TYPES.has(b.type))
  if (carriers.length !== 1 || links.length !== 1) return undefined
  // The link block must be the one this carrier would create.
  if (LINK_TYPE_FOR[carriers[0]!.type] !== links[0]!.type) return undefined

  return isCarrier ? links[0] : carriers[0]
}

/**
 * True when the block is the URL half of a recognised pair — the canvas hides
 * it so one 버튼·링크 or linked 이미지 shows as a single card.
 */
export function isPairedLinkUrl(blocks: readonly BriefBlock[], block: BriefBlock): boolean {
  return LINK_TYPES.has(block.type) && findLinkPartner(blocks, block) !== undefined
}

/** The URL currently attached to a design block, if any. */
export function linkUrlOf(blocks: readonly BriefBlock[], block: BriefBlock): string | undefined {
  const partner = findLinkPartner(blocks, block)
  if (!partner || !canCarryLink(block.type)) return undefined
  const url = partner.content?.trim()
  return url && url.length > 0 ? url : undefined
}

/**
 * Expands a set of block ids with the partner of any paired 버튼·링크 half, so
 * delete and duplicate always act on the pair as one unit.
 */
export function withLinkPartners(
  blocks: readonly BriefBlock[],
  ids: ReadonlySet<string>,
): Set<string> {
  const out = new Set(ids)
  for (const block of blocks) {
    if (!ids.has(block.id)) continue
    const partner = findLinkPartner(blocks, block)
    if (partner) out.add(partner.id)
  }
  return out
}
