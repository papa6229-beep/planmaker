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
  { kind: 'imageSlot', label: '이미지 자리', hint: '어떤 이미지가 들어갈 자리인지 적습니다', blockLabel: '이미지 자리' },
  { kind: 'buttonLink', label: '버튼·링크', hint: '버튼에 보일 글과 연결 주소', blockLabel: '버튼' },
  { kind: 'note', label: '요청 메모', hint: '이미지에 넣지 않고 전달할 요청입니다', blockLabel: '요청 메모' },
]

/** Block type each tool creates. 버튼·링크 additionally creates `button_url`. */
export const SIMPLE_BLOCK_TYPE: Record<SimpleBlockKind, BlockType> = {
  text: 'free_text',
  imageSlot: 'main_product_image',
  buttonLink: 'cta_button',
  note: 'revision_reference',
}

/** The publishing half of a 버튼·링크 pair. */
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
  if (block.type !== SIMPLE_BLOCK_TYPE.buttonLink && block.type !== LINK_URL_TYPE) return undefined

  const members = blocks.filter((b) => b.groupId === groupId)
  if (members.length !== 2) return undefined
  const buttons = members.filter((b) => b.type === SIMPLE_BLOCK_TYPE.buttonLink)
  const urls = members.filter((b) => b.type === LINK_URL_TYPE)
  if (buttons.length !== 1 || urls.length !== 1) return undefined

  return block.type === SIMPLE_BLOCK_TYPE.buttonLink ? urls[0] : buttons[0]
}

/**
 * True when the block is the URL half of a recognised pair — the canvas hides
 * it so one 버튼·링크 shows as a single card.
 */
export function isPairedLinkUrl(blocks: readonly BriefBlock[], block: BriefBlock): boolean {
  return block.type === LINK_URL_TYPE && findLinkPartner(blocks, block) !== undefined
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
