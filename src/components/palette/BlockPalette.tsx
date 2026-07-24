/**
 * Left column: the simplified block palette (WORK_PLAN §10, Phase 7 Step 6).
 * Shows the recommended design-input blocks (문구 · 이미지 · 동작·구조) plus a
 * search box. Reference/publishing link blocks live in a separate collapsible
 * "퍼블리싱 정보" section so they never mix with design blocks and stay out of
 * the AI image input. Granular 행사정보 blocks and the background reference image
 * are hidden here (their types remain valid for existing files).
 */

import { useState } from 'react'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import { MAIN_PALETTE_SECTIONS, PUBLISHING_PALETTE_SECTION } from '../uiLabels'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { PaletteSection } from './PaletteSection'

const SEARCHABLE = [...MAIN_PALETTE_SECTIONS.flatMap((s) => s.types), ...PUBLISHING_PALETTE_SECTION.types].map(getBlockTypeMeta)

export function BlockPalette() {
  const { addBlock } = useBriefEditor()
  const [query, setQuery] = useState('')
  const q = query.trim()
  const results = q ? SEARCHABLE.filter((m) => m.label.includes(q)) : []

  return (
    <aside className="palette" aria-label="블록 팔레트">
      <div className="palette-search">
        <input
          type="search"
          className="palette-search__input"
          aria-label="블록 검색"
          placeholder="블록 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {q ? (
        results.length > 0 ? (
          <ul className="palette-section__list" aria-label="검색 결과">
            {results.map((meta) => (
              <li key={meta.type}>
                <button type="button" className="palette-item" onClick={() => addBlock(meta.type)}>
                  {meta.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="palette-empty">검색 결과가 없습니다.</p>
        )
      ) : (
        <>
          <section className="palette-group palette-group--design" aria-label="디자인 입력 블록">
            <header className="palette-group__header">
              <h2 className="palette-group__title">디자인 입력 블록</h2>
              <p className="palette-group__hint">이미지 생성 AI가 읽는 정보</p>
            </header>
            {MAIN_PALETTE_SECTIONS.map((section) => (
              <PaletteSection key={section.key} section={section} />
            ))}
          </section>

          <section className="palette-group palette-group--publishing" aria-label="퍼블리싱 정보">
            <PaletteSection section={PUBLISHING_PALETTE_SECTION} defaultOpen={false} />
            <p className="palette-group__hint">디자인 블록과 분리 · AI 이미지 입력에 미포함</p>
          </section>
        </>
      )}
    </aside>
  )
}
