/**
 * A single collapsible category of block types. Clicking a block item creates
 * a block of that type via the editor (which uses the Phase 1 factory).
 */

import { useState } from 'react'
import { BLOCK_TYPE_LIST, type BlockCategory } from '../../domain/blockTypes'
import { CATEGORY_LABELS } from '../uiLabels'
import { useBriefEditor } from '../../features/editor/useBriefEditor'

export function PaletteSection({ category }: { category: BlockCategory }) {
  const { addBlock } = useBriefEditor()
  const [open, setOpen] = useState(true)
  const items = BLOCK_TYPE_LIST.filter((meta) => meta.category === category)
  const sectionId = `palette-section-${category}`

  return (
    <div className="palette-section">
      <button
        type="button"
        className="palette-section__toggle"
        aria-expanded={open}
        aria-controls={sectionId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="palette-section__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        {CATEGORY_LABELS[category]}
        <span className="palette-section__count">{items.length}</span>
      </button>
      {open && (
        <ul id={sectionId} className="palette-section__list">
          {items.map((meta) => (
            <li key={meta.type}>
              <button
                type="button"
                className="palette-item"
                onClick={() => addBlock(meta.type)}
              >
                {meta.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
