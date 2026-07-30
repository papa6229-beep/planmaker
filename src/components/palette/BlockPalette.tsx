/**
 * Left column: the four authoring tools (기획서 작성 화면 1차 단순화 §2.2).
 *
 * The user sees exactly four things to add — 글 넣기 · 이미지 자리 · 버튼·링크 ·
 * 요청 메모 — instead of the previous 23 typed entries. The 34-type catalog is
 * untouched: `simpleBlocks.ts` maps these four onto existing types, and blocks
 * of any other type in an existing document still open and edit normally.
 *
 * The URL of a 버튼·링크 is entered in the properties panel, so there is no
 * separate 퍼블리싱 정보 section to browse here.
 */

import { SIMPLE_BLOCKS, SIMPLE_BLOCK_TYPE, type SimpleBlockKind } from '../../domain/simpleBlocks'
import { useBriefEditor } from '../../features/editor/useBriefEditor'

export function BlockPalette() {
  const { addBlock, addButtonLink } = useBriefEditor()

  const add = (kind: SimpleBlockKind, blockLabel: string) => {
    if (kind === 'buttonLink') addButtonLink(blockLabel)
    else addBlock(SIMPLE_BLOCK_TYPE[kind], blockLabel)
  }

  return (
    <aside className="palette" aria-label="블록 팔레트">
      <header className="palette-group__header">
        <h2 className="palette-group__title">무엇을 넣을까요?</h2>
        <p className="palette-group__hint">누르면 캔버스에 바로 생깁니다</p>
      </header>

      <ul className="simple-tools" aria-label="기본 블록">
        {SIMPLE_BLOCKS.map((tool) => (
          <li key={tool.kind}>
            <button
              type="button"
              className={`simple-tool simple-tool--${tool.kind}`}
              aria-label={tool.label}
              onClick={() => add(tool.kind, tool.blockLabel)}
            >
              <span className="simple-tool__label">{tool.label}</span>
              <span className="simple-tool__hint">{tool.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
