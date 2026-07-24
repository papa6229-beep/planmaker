/**
 * Korean display labels for enum values used across the UI. Kept separate from
 * the domain layer so domain code stays presentation-free.
 */

import type { AiVisibility, BlockCategory, BlockType } from '../domain/blockTypes'

export const CATEGORY_LABELS: Record<BlockCategory, string> = {
  text: '문구',
  image: '이미지',
  structure: '행사정보',
  reference: '참고 / 링크',
}

export const AI_VISIBILITY_LABELS: Record<AiVisibility, string> = {
  design: '디자인 입력',
  reference: 'AI 참고',
  publishing: '퍼블리싱 전용',
}

export const PRIORITY_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '1 · 매우 높음',
  2: '2 · 높음',
  3: '3 · 보통',
  4: '4 · 낮음',
  5: '5 · 매우 낮음',
}

/**
 * The palette's two top-level groups (WORK_PLAN §7.1 vs §7.2). Design-input
 * categories are visually separated from reference/publishing so the user
 * always sees which blocks the image AI reads.
 */
export interface PaletteGroupDef {
  key: 'design' | 'reference'
  label: string
  hint: string
  categories: BlockCategory[]
}

export const PALETTE_GROUPS: PaletteGroupDef[] = [
  {
    key: 'design',
    label: '디자인 입력 블록',
    hint: '이미지 생성 AI가 읽는 정보',
    categories: ['text', 'image', 'structure'],
  },
  {
    key: 'reference',
    label: '참고 · 퍼블리싱 블록',
    hint: 'AI가 기본적으로 읽지 않는 정보',
    categories: ['reference'],
  },
]

/**
 * Simplified palette (WORK_PLAN §10.2, Phase 7 Step 6). Only the recommended
 * design-input blocks are shown by explicit type — the granular 행사정보 blocks
 * (혜택·구매 조건·사은품 등) and the background reference image are hidden from
 * the palette. Their domain types remain valid so existing `.eventbrief` files
 * still render. A separate "퍼블리싱 정보" section holds link/note blocks so
 * they never mix with design blocks (they are excluded from the AI input).
 */
export interface PaletteSectionDef {
  key: string
  label: string
  types: BlockType[]
}

export const MAIN_PALETTE_SECTIONS: PaletteSectionDef[] = [
  {
    key: 'text',
    label: '문구',
    types: ['main_headline', 'sub_headline', 'body_text', 'emphasis_text', 'period', 'price', 'discount_rate', 'caution_text', 'free_text'],
  },
  {
    key: 'image',
    label: '이미지',
    types: ['logo', 'main_product_image', 'sub_product_image', 'product_group_image', 'existing_full_image', 'gif_source'],
  },
  {
    key: 'action',
    label: '동작 · 구조',
    types: ['cta_button', 'divider_section_title', 'group_container'],
  },
]

export const PUBLISHING_PALETTE_SECTION: PaletteSectionDef = {
  key: 'publishing',
  label: '퍼블리싱 정보',
  types: ['button_url', 'product_detail_link', 'application_form_link', 'reference_site_link', 'publishing_note'],
}
