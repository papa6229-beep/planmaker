/**
 * A single collapsible palette section (WORK_PLAN §10.2). Clicking a block item
 * creates a block of that type via the editor (which uses the Phase 1 factory).
 */

import { useState } from 'react'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import type { PaletteSectionDef } from '../uiLabels'
import { useBriefEditor } from '../../features/editor/useBriefEditor'

export function PaletteSection({ section, defaultOpen = true }: { section: PaletteSectionDef; defaultOpen?: boolean }) {
  const { addBlock } = useBriefEditor()
  const [open, setOpen] = useState(defaultOpen)
  const items = section.types.map(getBlockTypeMeta)
  const sectionId = `palette-section-${section.key}`

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
        {section.label}
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
