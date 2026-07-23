/**
 * A meaning card on the canvas (WORK_PLAN §3, §4). Renders a block as a simple
 * semantic card — never a styled design component. No colors/fonts/effects are
 * editable here; the card only communicates meaning, importance, and whether
 * the block is design input or reference/publishing.
 */

import { getBlockTypeMeta, type BlockCategory } from '../../domain/blockTypes'
import { AI_VISIBILITY_LABELS } from '../uiLabels'
import type { BriefBlock } from '../../domain/briefSchema'

interface Props {
  block: BriefBlock
  selected: boolean
  onSelect: (blockId: string) => void
}

const CATEGORY_MODIFIER: Record<BlockCategory, string> = {
  text: 'text',
  image: 'image',
  structure: 'structure',
  reference: 'reference',
}

export function BriefBlockCard({ block, selected, onSelect }: Props) {
  const meta = getBlockTypeMeta(block.type)
  const isPublishingSide = block.aiVisibility !== 'design'

  return (
    <button
      type="button"
      className={[
        'block-card',
        `block-card--${CATEGORY_MODIFIER[meta.category]}`,
        isPublishingSide ? 'block-card--reference-side' : 'block-card--design-side',
        selected ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: block.position.x,
        top: block.position.y,
        width: block.position.width,
        height: block.position.height,
      }}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(block.id)
      }}
    >
      <span className="block-card__head">
        <span className="block-card__visibility">{AI_VISIBILITY_LABELS[block.aiVisibility]}</span>
        {block.required && (
          <span className="block-card__required" title="필수 블록">필수</span>
        )}
      </span>
      <span className="block-card__title">{block.label}</span>
      <span className="block-card__content">
        {block.content && block.content.trim().length > 0
          ? block.content
          : meta.requiresAsset
            ? '(이미지 미지정)'
            : '(내용 없음)'}
      </span>
    </button>
  )
}
