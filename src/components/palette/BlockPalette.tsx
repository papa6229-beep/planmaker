/**
 * Left column: the block palette. Design-input blocks (§7.1) and
 * reference/publishing blocks (§7.2) are rendered as visually distinct groups
 * so the design/publishing separation is obvious in the UI (WORK_PLAN §7).
 */

import { PALETTE_GROUPS } from '../uiLabels'
import { PaletteSection } from './PaletteSection'

export function BlockPalette() {
  return (
    <aside className="palette" aria-label="블록 팔레트">
      {PALETTE_GROUPS.map((group) => (
        <section
          key={group.key}
          className={`palette-group palette-group--${group.key}`}
          aria-label={group.label}
        >
          <header className="palette-group__header">
            <h2 className="palette-group__title">{group.label}</h2>
            <p className="palette-group__hint">{group.hint}</p>
          </header>
          {group.categories.map((category) => (
            <PaletteSection key={category} category={category} />
          ))}
        </section>
      ))}
    </aside>
  )
}
