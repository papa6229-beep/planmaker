/**
 * Korean display labels for enum values used across the UI. Kept separate from
 * the domain layer so domain code stays presentation-free.
 */

import type { AiVisibility, BlockCategory } from '../domain/blockTypes'

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
