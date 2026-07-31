/**
 * Rule-based summary generation (WORK_PLAN §15). No AI calls in the MVP.
 *
 * Produces two derived views from the canonical brief:
 *   - `DesignSummary` — AI-facing. MUST NOT contain any publishing link/URL
 *     (WORK_PLAN §34 Phase 5 gate). This is enforced structurally: the builder
 *     only ever reads block *content* for design/reference blocks, and CTA
 *     entries expose a boolean `hasLink`, never the URL.
 *   - `PublishingInfo` — publishing-only info the image AI ignores.
 */

import { getBlockTypeMeta } from './blockTypes'
import { NOTE_TYPE } from './simpleBlocks'
import {
  type BriefBlock,
  type BriefFile,
  type DesignSummary,
  type EventBrief,
  type LayoutAlignment,
  type LayoutEmphasis,
  type LayoutRegion,
  type PublishingInfo,
  type PublishingLink,
  type PublishingNote,
  type SummaryCta,
  type SummaryGeometry,
  type SummaryImage,
  type SummaryInstruction,
  type SummaryItem,
  type SummaryImageSlot,
  type SummaryLayoutHint,
  type SummaryProduct,
  type SummaryText,
  type SummaryTextEntry,
} from './briefSchema'
import type { BlockType } from './blockTypes'

const PRODUCT_IMAGE_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'main_product_image',
  'sub_product_image',
  'product_group_image',
])

const BENEFIT_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'benefit',
  'purchase_condition',
  'gift',
  'application_condition',
  'option_item',
  'winner_count',
])

const LINK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'product_detail_link',
  'button_url',
  'application_form_link',
  'reference_site_link',
  'gif_source_link',
])

/**
 * True when the image on this block is a reference capture rather than the
 * image to use. Single place the rule lives, so nothing derives "use this file"
 * from a picture the planner only pasted in as an example.
 */
export function isReferenceCapture(block: BriefBlock): boolean {
  return block.image?.referenceOnly === true
}

/**
 * The product this block names, or nothing.
 *
 * Only a name someone actually recorded counts. The block's own default label
 * (`이미지`) is a UI caption, and a file name picked up from an upload
 * (`capture`) is storage bookkeeping — neither is a product, and passing either
 * to the AI would invent a requirement the planner never wrote. What the
 * planner did write about the image goes to `imageSlots.description` instead.
 */
function namedProduct(block: BriefBlock): string | undefined {
  const name = block.image?.productName?.trim()
  return name !== undefined && name.length > 0 ? name : undefined
}

function content(block: BriefBlock): string {
  return block.content?.trim() ?? ''
}

function hasContent(block: BriefBlock): boolean {
  return content(block).length > 0
}

function isDesign(block: BriefBlock): boolean {
  return block.aiVisibility === 'design'
}

function isPublishing(block: BriefBlock): boolean {
  return block.aiVisibility === 'publishing'
}

/** Derives a soft region hint from the explicit hint or the block's y position. */
function regionOf(block: BriefBlock, canvasHeight: number): LayoutRegion {
  if (block.layoutHint.region) return block.layoutHint.region
  const centerY = block.position.y + block.position.height / 2
  if (centerY < canvasHeight / 3) return 'top'
  if (centerY > (canvasHeight * 2) / 3) return 'bottom'
  return 'middle'
}

/** Derives a soft alignment hint from the explicit hint or the block's x center. */
function alignmentOf(block: BriefBlock, canvasWidth: number): LayoutAlignment {
  if (block.layoutHint.alignment) return block.layoutHint.alignment
  const centerX = block.position.x + block.position.width / 2
  if (centerX < canvasWidth / 3) return 'left'
  if (centerX > (canvasWidth * 2) / 3) return 'right'
  return 'center'
}

function emphasisOf(block: BriefBlock): LayoutEmphasis {
  return block.layoutHint.emphasis ?? 'normal'
}

function geometryOf(block: BriefBlock): SummaryGeometry {
  const { x, y, width, height } = block.position
  return { x, y, width, height }
}

function firstContent(blocks: BriefBlock[], type: BlockType): string | undefined {
  const match = blocks.find((b) => b.type === type && isDesign(b) && hasContent(b))
  return match ? content(match) : undefined
}

/**
 * Builds the AI-facing design summary. Reads only design/reference blocks; no
 * publishing content ever enters this object.
 */
export interface SummaryContext {
  /** Page the brief projection came from, so summary entries can name it. */
  pageId?: string
}

export function buildDesignSummary(brief: EventBrief, context: SummaryContext = {}): DesignSummary {
  const { blocks, project } = brief
  const designBlocks = blocks.filter(isDesign)
  const { pageId } = context

  const mainHeadline = firstContent(blocks, 'main_headline')

  // Every design text, verbatim — nothing is dropped just because it has no
  // explicit semantic role (the simplified 글 넣기 tool writes `free_text`).
  const texts: SummaryTextEntry[] = designBlocks
    .filter((b) => getBlockTypeMeta(b.type).hasText && hasContent(b))
    .map((b) => {
      const entry: SummaryTextEntry = {
        blockId: b.id,
        type: b.type,
        label: b.label,
        content: content(b),
        emphasis: emphasisOf(b),
        geometry: geometryOf(b),
      }
      if (pageId !== undefined) entry.pageId = pageId
      return entry
    })

  // 요청 메모: guidance for the AI / design team that must never be printed.
  // Selected by block *type* so pre-existing `revision_reference` blocks in old
  // documents read the same way, with their stored data left untouched.
  const instructions: SummaryInstruction[] = blocks
    .filter((b) => b.type === NOTE_TYPE && hasContent(b))
    .map((b) => {
      const item: SummaryInstruction = {
        scope: 'block',
        blockId: b.id,
        label: b.label,
        content: content(b),
        geometry: geometryOf(b),
        renderAsText: false,
      }
      if (pageId !== undefined) item.pageId = pageId
      return item
    })

  // 전체 컨셉 applies to the whole brief, so it leads the instructions with no
  // position of its own — direction for the AI, never copy to print.
  const concept = project.concept?.trim()
  if (concept !== undefined && concept.length > 0) {
    instructions.unshift({
      scope: 'document',
      label: '전체 컨셉',
      content: concept,
      renderAsText: false,
    })
  }

  const subHeadlines = designBlocks
    .filter((b) => b.type === 'sub_headline' && hasContent(b))
    .map(content)

  const requiredTexts: SummaryText[] = designBlocks
    .filter((b) => getBlockTypeMeta(b.type).hasText && b.required && hasContent(b))
    .toSorted((a, b) => a.priority - b.priority)
    .map((b) => ({
      blockId: b.id,
      type: b.type,
      label: b.label,
      content: content(b),
      emphasis: emphasisOf(b),
      priority: b.priority,
    }))

  // Products the brief actually has: a name someone recorded, or a real image
  // to use. A block with neither names no product — it is an image slot, and
  // says what belongs there through `imageSlots` instead. A reference capture
  // is never a product image, whatever it is called.
  const requiredProducts: SummaryProduct[] = blocks
    .filter((b) => PRODUCT_IMAGE_TYPES.has(b.type) && !isReferenceCapture(b))
    .flatMap((b) => {
      const productName = namedProduct(b)
      if (productName === undefined && b.assetId === undefined) return []
      const product: SummaryProduct = {
        blockId: b.id,
        allowTransform: b.image?.allowTransform ?? true,
        required: b.required,
      }
      if (productName !== undefined) product.productName = productName
      if (b.assetId !== undefined) product.assetId = b.assetId
      if (b.groupId !== undefined) product.groupId = b.groupId
      return [product]
    })

  const requiredBenefits: SummaryItem[] = designBlocks
    .filter((b) => BENEFIT_TYPES.has(b.type) && hasContent(b))
    .map((b) => ({ blockId: b.id, type: b.type, label: b.label, content: content(b) }))

  const cautions = designBlocks
    .filter((b) => b.type === 'caution_text' && hasContent(b))
    .map(content)

  // A CTA "has a link" if any publishing link block exists. The URL is never
  // copied here — only the boolean.
  const anyPublishingLink = blocks.some((b) => LINK_TYPES.has(b.type) && isPublishing(b) && hasContent(b))
  const ctaButtons: SummaryCta[] = designBlocks
    .filter((b) => b.type === 'cta_button' && hasContent(b))
    .map((b) => ({ blockId: b.id, text: content(b), hasLink: anyPublishingLink }))

  // Images to insert as-is: existing full images, plus any image block whose
  // transform is explicitly disallowed. A reference capture is never one of
  // these — inserting it as-is is exactly what must not happen.
  const verbatimImages: SummaryImage[] = blocks
    .filter((b) => !isReferenceCapture(b))
    .filter((b) => b.type === 'existing_full_image' || b.image?.allowTransform === false)
    .map((b) => {
      const image: SummaryImage = { blockId: b.id, verbatim: true }
      if (b.assetId !== undefined) image.assetId = b.assetId
      if (b.image?.productName !== undefined) image.productName = b.image.productName
      return image
    })

  // Every image the brief asks for: the box, the planner's description, and the
  // reference capture attached to it (if any), plainly marked as reference.
  const imageSlots: SummaryImageSlot[] = designBlocks
    .filter((b) => getBlockTypeMeta(b.type).requiresAsset)
    .map((b) => {
      const slot: SummaryImageSlot = { blockId: b.id, label: b.label, geometry: geometryOf(b) }
      if (pageId !== undefined) slot.pageId = pageId
      if (hasContent(b)) slot.description = content(b)
      if (b.assetId !== undefined && isReferenceCapture(b)) {
        slot.referenceAssetId = b.assetId
        slot.referenceOnly = true
      }
      return slot
    })

  const layoutHints: SummaryLayoutHint[] = designBlocks
    .map((b, index) => ({
      blockId: b.id,
      region: regionOf(b, project.canvasHeight),
      alignment: alignmentOf(b, project.canvasWidth),
      emphasis: emphasisOf(b),
      order: b.layoutHint.order ?? index,
    }))
    .toSorted((a, b) => a.order - b.order)

  const summary: DesignSummary = {
    subHeadlines,
    texts,
    instructions,
    requiredTexts,
    requiredProducts,
    requiredBenefits,
    cautions,
    ctaButtons,
    verbatimImages,
    imageSlots,
    layoutHints,
  }

  if (mainHeadline !== undefined) summary.mainHeadline = mainHeadline
  const period = firstContent(blocks, 'period')
  if (period !== undefined) summary.period = period
  const price = firstContent(blocks, 'price')
  if (price !== undefined) summary.price = price
  const discountRate = firstContent(blocks, 'discount_rate')
  if (discountRate !== undefined) summary.discountRate = discountRate

  return summary
}

/** Builds the publishing-only info (links + notes) from publishing blocks. */
export function buildPublishingInfo(brief: EventBrief): PublishingInfo {
  const publishingBlocks = brief.blocks.filter(isPublishing)

  const links: PublishingLink[] = publishingBlocks
    .filter((b) => LINK_TYPES.has(b.type) && hasContent(b))
    .map((b) => {
      const link: PublishingLink = { blockId: b.id, label: b.label, url: content(b) }
      if (b.notes !== undefined) link.purpose = b.notes
      return link
    })

  const notes: PublishingNote[] = publishingBlocks
    .filter((b) => !LINK_TYPES.has(b.type) && hasContent(b))
    .map((b) => ({ blockId: b.id, label: b.label, content: content(b) }))

  return { links, notes }
}

/** Assembles the full `brief.json` payload with derived views (WORK_PLAN §13). */
export function buildBriefFile(brief: EventBrief, context: SummaryContext = {}): BriefFile {
  return {
    ...brief,
    designSummary: buildDesignSummary(brief, context),
    publishing: buildPublishingInfo(brief),
  }
}
