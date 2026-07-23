/**
 * Block type catalog.
 *
 * Design principle (WORK_PLAN §3, §7): blocks carry *meaning*, not visual
 * styling. The user explicitly picks the block type, so there is no
 * color/shape/arrow inference anywhere in the system. Each block type declares
 * its category and its default AI visibility; both can still be overridden per
 * block instance in the inspector.
 */

/** How the image-generation AI should treat a block's content. */
export type AiVisibility = 'design' | 'reference' | 'publishing'

/** Broad grouping used by the palette and the summary builder. */
export type BlockCategory = 'text' | 'image' | 'structure' | 'reference'

/**
 * Union of every valid block type identifier. Declared explicitly (rather than
 * derived from the catalog) to avoid a circular reference with `BlockTypeMeta`.
 * `BLOCK_TYPE_LIST` is checked against this union via `satisfies`, so adding a
 * catalog entry without extending this union is a compile error.
 */
export type BlockType =
  // §7.1 Design input · Text
  | 'main_headline'
  | 'sub_headline'
  | 'body_text'
  | 'emphasis_text'
  | 'period'
  | 'price'
  | 'discount_rate'
  | 'caution_text'
  | 'free_text'
  // §7.1 Design input · Image
  | 'logo'
  | 'main_product_image'
  | 'sub_product_image'
  | 'product_group_image'
  | 'background_reference_image'
  | 'existing_full_image'
  | 'gif_source'
  // §7.1 Design input · Event structure
  | 'benefit'
  | 'purchase_condition'
  | 'gift'
  | 'application_condition'
  | 'option_item'
  | 'winner_count'
  | 'product_name'
  | 'cta_button'
  | 'divider_section_title'
  | 'group_container'
  // §7.2 Reference / publishing
  | 'product_detail_link'
  | 'button_url'
  | 'application_form_link'
  | 'reference_site_link'
  | 'gif_source_link'
  | 'publishing_note'
  | 'manager_note'
  | 'existing_page_location'
  | 'revision_reference'

/**
 * Static metadata for a block type. Intentionally free of layout/appearance
 * data — those live on the block instance as soft hints.
 */
export interface BlockTypeMeta {
  type: BlockType
  /** Korean display label shown in the palette. */
  label: string
  category: BlockCategory
  /** Default AI visibility when a block of this type is created. */
  defaultVisibility: AiVisibility
  /** Image blocks must reference an asset to be valid. */
  requiresAsset: boolean
  /** Whether the block primarily holds editable text content. */
  hasText: boolean
}

/**
 * The full ordered catalog. The `type` string is the stable identifier stored
 * in `.eventbrief` files; do not rename existing values without a schema bump.
 */
export const BLOCK_TYPE_LIST = [
  // ── §7.1 Design input · Text ────────────────────────────────────────────
  { type: 'main_headline', label: '메인 문구', category: 'text', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'sub_headline', label: '서브 문구', category: 'text', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'body_text', label: '본문 문구', category: 'text', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'emphasis_text', label: '강조 문구', category: 'text', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'period', label: '기간', category: 'text', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'price', label: '가격', category: 'text', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'discount_rate', label: '할인율', category: 'text', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'caution_text', label: '주의 문구', category: 'text', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'free_text', label: '자유 텍스트', category: 'text', defaultVisibility: 'design', requiresAsset: false, hasText: true },

  // ── §7.1 Design input · Image ───────────────────────────────────────────
  { type: 'logo', label: '로고', category: 'image', defaultVisibility: 'design', requiresAsset: true, hasText: false },
  { type: 'main_product_image', label: '메인 제품 이미지', category: 'image', defaultVisibility: 'design', requiresAsset: true, hasText: false },
  { type: 'sub_product_image', label: '보조 제품 이미지', category: 'image', defaultVisibility: 'design', requiresAsset: true, hasText: false },
  { type: 'product_group_image', label: '제품 그룹', category: 'image', defaultVisibility: 'design', requiresAsset: true, hasText: false },
  { type: 'background_reference_image', label: '배경 참고 이미지', category: 'image', defaultVisibility: 'reference', requiresAsset: true, hasText: false },
  { type: 'existing_full_image', label: '기존 통이미지', category: 'image', defaultVisibility: 'design', requiresAsset: true, hasText: false },
  { type: 'gif_source', label: 'GIF/움짤 원본', category: 'image', defaultVisibility: 'design', requiresAsset: true, hasText: false },

  // ── §7.1 Design input · Event structure ─────────────────────────────────
  { type: 'benefit', label: '혜택', category: 'structure', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'purchase_condition', label: '구매 조건', category: 'structure', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'gift', label: '사은품', category: 'structure', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'application_condition', label: '신청 조건', category: 'structure', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'option_item', label: '선택 항목', category: 'structure', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'winner_count', label: '당첨 인원', category: 'structure', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'product_name', label: '제품명', category: 'structure', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'cta_button', label: 'CTA 버튼', category: 'structure', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'divider_section_title', label: '구분선/섹션 제목', category: 'structure', defaultVisibility: 'design', requiresAsset: false, hasText: true },
  { type: 'group_container', label: '그룹 컨테이너', category: 'structure', defaultVisibility: 'design', requiresAsset: false, hasText: false },

  // ── §7.2 Reference / publishing blocks ──────────────────────────────────
  { type: 'product_detail_link', label: '상품 상세페이지 링크', category: 'reference', defaultVisibility: 'publishing', requiresAsset: false, hasText: true },
  { type: 'button_url', label: '버튼 연결 URL', category: 'reference', defaultVisibility: 'publishing', requiresAsset: false, hasText: true },
  { type: 'application_form_link', label: '신청 폼 링크', category: 'reference', defaultVisibility: 'publishing', requiresAsset: false, hasText: true },
  { type: 'reference_site_link', label: '참고 사이트 링크', category: 'reference', defaultVisibility: 'reference', requiresAsset: false, hasText: true },
  { type: 'gif_source_link', label: 'GIF 원본 링크', category: 'reference', defaultVisibility: 'publishing', requiresAsset: false, hasText: true },
  { type: 'publishing_note', label: '퍼블리싱 메모', category: 'reference', defaultVisibility: 'publishing', requiresAsset: false, hasText: true },
  { type: 'manager_note', label: '담당자 메모', category: 'reference', defaultVisibility: 'publishing', requiresAsset: false, hasText: true },
  { type: 'existing_page_location', label: '기존 페이지 위치', category: 'reference', defaultVisibility: 'publishing', requiresAsset: false, hasText: true },
  { type: 'revision_reference', label: '수정 요청 참고자료', category: 'reference', defaultVisibility: 'reference', requiresAsset: false, hasText: true },
] as const satisfies readonly BlockTypeMeta[]

/** Fast lookup table keyed by block type. */
export const BLOCK_TYPES: Record<BlockType, BlockTypeMeta> = Object.fromEntries(
  BLOCK_TYPE_LIST.map((meta) => [meta.type, meta]),
) as Record<BlockType, BlockTypeMeta>

/** Returns the metadata for a block type. */
export function getBlockTypeMeta(type: BlockType): BlockTypeMeta {
  return BLOCK_TYPES[type]
}

/** True when the block type stores an image asset. */
export function isImageBlock(type: BlockType): boolean {
  return BLOCK_TYPES[type].category === 'image'
}

/** True when the block type is a reference/publishing block. */
export function isReferenceBlock(type: BlockType): boolean {
  return BLOCK_TYPES[type].category === 'reference'
}
