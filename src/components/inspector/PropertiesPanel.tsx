/**
 * Right column — transitional state (중앙 직접 편집 §8).
 *
 * Every per-block input has moved onto the canvas card, so this panel no longer
 * duplicates 문구 · 강조 · 이미지 설명 · 버튼 문구 · URL inputs. What remains is a
 * short orientation for the current selection plus any validation issue that
 * relates to it. The panel is replaced by the 기획서 보관함 in the next step.
 */

import { getBlockTypeMeta } from '../../domain/blockTypes'
import { validateBrief } from '../../domain/validation'
import { SIMPLE_BLOCKS, canCarryLink, simpleKindOf } from '../../domain/simpleBlocks'
import { CATEGORY_LABELS } from '../uiLabels'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { EmptySelection } from './EmptySelection'

function SingleSelectionBody({ blockId }: { blockId: string }) {
  const { state, selected } = useBriefEditor()
  if (selected === null) return null

  const meta = getBlockTypeMeta(selected.type)
  const kind = simpleKindOf(selected)
  const simple = kind === null ? undefined : SIMPLE_BLOCKS.find((s) => s.kind === kind)
  const issues = validateBrief(state.brief)
  const blockIssues = [...issues.errors, ...issues.warnings].filter((i) => i.blockId === blockId)

  return (
    <>
      <header className="inspector__header">
        <p className="inspector__type">{simple ? simple.label : meta.label}</p>
        <p className="inspector__role">{simple ? simple.hint : CATEGORY_LABELS[meta.category]}</p>
      </header>

      <ul className="inspector__howto">
        <li>더블클릭하면 블록 안에서 바로 입력합니다.</li>
        {meta.requiresAsset && <li>이미지를 블록 위로 끌어다 놓거나 붙여넣을 수 있습니다.</li>}
        {!meta.requiresAsset && meta.hasText && <li>블록을 크게 만들면 글자도 커집니다.</li>}
        {canCarryLink(selected.type) && <li>연결 주소는 블록의 링크 아이콘으로 입력합니다.</li>}
        <li>복제·삭제는 블록의 ⋯ 메뉴 또는 Delete 키로 합니다.</li>
      </ul>

      {blockIssues.length > 0 && (
        <ul className="inspector__issues">
          {blockIssues.map((issue) => (
            <li key={issue.code} className={`inspector__issue inspector__issue--${issue.severity}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function MultiSelectionBody({ count }: { count: number }) {
  return (
    <header className="inspector__header">
      <p className="inspector__type">{count}개 블록 선택됨</p>
      <p className="inspector__role">드래그로 함께 옮기고, 삭제는 Delete 키로 합니다.</p>
    </header>
  )
}

/**
 * Always renders the same stable <aside> wrapper; only the inner body switches
 * between empty / single / multi so consumers keep a stable DOM node.
 */
export function PropertiesPanel() {
  const { selected, selectedIds } = useBriefEditor()

  let body
  if (selectedIds.length === 0 || selected === null) {
    body = <EmptySelection />
  } else if (selectedIds.length > 1) {
    body = <MultiSelectionBody count={selectedIds.length} />
  } else {
    body = <SingleSelectionBody blockId={selected.id} />
  }

  return (
    <aside className="inspector" aria-label="선택 블록 설정">
      {body}
    </aside>
  )
}
