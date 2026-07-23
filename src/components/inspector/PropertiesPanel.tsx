/**
 * Right column: properties of the selection (WORK_PLAN §6, §10). Edits only the
 * common fields already defined in the Phase 1 schema — no new domain fields.
 * Enum fields use <select>, so invalid values can't be entered; free-text
 * fields are validated live and surfaced as issues below.
 *
 * Handles three states: nothing selected, one block (full editor + actions),
 * and multiple blocks (group / ungroup / delete).
 */

import { getBlockTypeMeta } from '../../domain/blockTypes'
import type { AiVisibility } from '../../domain/blockTypes'
import type {
  BriefBlock,
  LayoutAlignment,
  LayoutEmphasis,
  LayoutRegion,
} from '../../domain/briefSchema'
import { validateBrief } from '../../domain/validation'
import { AI_VISIBILITY_LABELS, CATEGORY_LABELS, PRIORITY_LABELS } from '../uiLabels'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { EmptySelection } from './EmptySelection'
import { DeleteBlockAction } from './DeleteBlockAction'

const VISIBILITY_OPTIONS: AiVisibility[] = ['design', 'reference', 'publishing']
const PRIORITY_OPTIONS: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5]
const REGION_OPTIONS: LayoutRegion[] = ['top', 'middle', 'bottom', 'free']
const ALIGNMENT_OPTIONS: LayoutAlignment[] = ['left', 'center', 'right', 'free']
const EMPHASIS_OPTIONS: LayoutEmphasis[] = ['low', 'normal', 'high', 'very_high']

const REGION_LABELS: Record<LayoutRegion, string> = {
  top: '상단', middle: '중단', bottom: '하단', free: '자유',
}
const ALIGNMENT_LABELS: Record<LayoutAlignment, string> = {
  left: '좌', center: '중앙', right: '우', free: '자유',
}
const EMPHASIS_LABELS: Record<LayoutEmphasis, string> = {
  low: '낮음', normal: '보통', high: '높음', very_high: '매우 높음',
}

function BlockFields({ block }: { block: BriefBlock }) {
  const { updateBlock } = useBriefEditor()
  const meta = getBlockTypeMeta(block.type)
  const editKey = `edit:${block.id}` // coalesce a run of text edits into one undo step

  return (
    <div className="fields">
      <label className="field">
        <span className="field__label">라벨</span>
        <input
          className="field__input"
          type="text"
          value={block.label}
          onChange={(e) => updateBlock(block.id, { label: e.target.value }, editKey)}
        />
      </label>

      {meta.hasText && (
        <label className="field">
          <span className="field__label">내용</span>
          <textarea
            className="field__input field__input--area"
            rows={3}
            value={block.content ?? ''}
            onChange={(e) => updateBlock(block.id, { content: e.target.value }, editKey)}
          />
        </label>
      )}

      {meta.requiresAsset && (
        <>
          <label className="field">
            <span className="field__label">제품명</span>
            <input
              className="field__input"
              type="text"
              value={block.image?.productName ?? ''}
              onChange={(e) => updateBlock(block.id, { image: { productName: e.target.value } }, editKey)}
            />
          </label>
          <label className="field field--checkbox">
            <input
              type="checkbox"
              checked={block.image?.allowTransform ?? true}
              onChange={(e) => updateBlock(block.id, { image: { allowTransform: e.target.checked } })}
            />
            <span className="field__label">AI 변형 허용</span>
          </label>
          <p className="field__note">이미지 파일 업로드는 Phase 4에서 지원됩니다.</p>
        </>
      )}

      <label className="field field--checkbox">
        <input
          type="checkbox"
          checked={block.required}
          onChange={(e) => updateBlock(block.id, { required: e.target.checked })}
        />
        <span className="field__label">필수 블록</span>
      </label>

      <label className="field">
        <span className="field__label">중요도</span>
        <select
          className="field__input"
          value={block.priority}
          onChange={(e) => updateBlock(block.id, { priority: Number(e.target.value) as BriefBlock['priority'] })}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">AI 전달 여부</span>
        <select
          className="field__input"
          value={block.aiVisibility}
          onChange={(e) => updateBlock(block.id, { aiVisibility: e.target.value as AiVisibility })}
        >
          {VISIBILITY_OPTIONS.map((v) => (
            <option key={v} value={v}>{AI_VISIBILITY_LABELS[v]}</option>
          ))}
        </select>
      </label>

      <fieldset className="field field--group">
        <legend className="field__label">위치 힌트 (소프트)</legend>
        <div className="field__row">
          <select
            aria-label="영역"
            className="field__input"
            value={block.layoutHint.region ?? 'free'}
            onChange={(e) => updateBlock(block.id, { layoutHint: { region: e.target.value as LayoutRegion } })}
          >
            {REGION_OPTIONS.map((r) => (
              <option key={r} value={r}>{REGION_LABELS[r]}</option>
            ))}
          </select>
          <select
            aria-label="정렬"
            className="field__input"
            value={block.layoutHint.alignment ?? 'free'}
            onChange={(e) => updateBlock(block.id, { layoutHint: { alignment: e.target.value as LayoutAlignment } })}
          >
            {ALIGNMENT_OPTIONS.map((a) => (
              <option key={a} value={a}>{ALIGNMENT_LABELS[a]}</option>
            ))}
          </select>
          <select
            aria-label="강조"
            className="field__input"
            value={block.layoutHint.emphasis ?? 'normal'}
            onChange={(e) => updateBlock(block.id, { layoutHint: { emphasis: e.target.value as LayoutEmphasis } })}
          >
            {EMPHASIS_OPTIONS.map((em) => (
              <option key={em} value={em}>{EMPHASIS_LABELS[em]}</option>
            ))}
          </select>
        </div>
      </fieldset>

      <label className="field">
        <span className="field__label">메모</span>
        <textarea
          className="field__input field__input--area"
          rows={2}
          value={block.notes ?? ''}
          onChange={(e) => updateBlock(block.id, { notes: e.target.value }, editKey)}
        />
      </label>
    </div>
  )
}

function MultiSelectionBody({ count }: { count: number }) {
  const { selectedBlocks, groupSelected, ungroupSelected, deleteSelected } = useBriefEditor()
  const anyGrouped = selectedBlocks.some((b) => b.groupId !== undefined)

  return (
    <>
      <header className="inspector__header">
        <p className="inspector__type">{count}개 블록 선택됨</p>
        <p className="inspector__role">그룹으로 묶어 함께 이동할 수 있습니다.</p>
      </header>
      <div className="inspector__actions">
        <button type="button" className="btn" onClick={groupSelected}>그룹으로 묶기</button>
        {anyGrouped && (
          <button type="button" className="btn" onClick={ungroupSelected}>그룹 해제</button>
        )}
      </div>
      <button type="button" className="btn btn--danger inspector__delete" onClick={deleteSelected}>
        선택 블록 삭제
      </button>
    </>
  )
}

function SingleSelectionBody({ blockId }: { blockId: string }) {
  const { state, selected, duplicateBlock, ungroupSelected } = useBriefEditor()
  if (selected === null) return null

  const meta = getBlockTypeMeta(selected.type)
  const issues = validateBrief(state.brief)
  const blockIssues = [...issues.errors, ...issues.warnings].filter((i) => i.blockId === blockId)

  return (
    <>
      <header className="inspector__header">
        <p className="inspector__type">{meta.label}</p>
        <p className="inspector__role">
          {CATEGORY_LABELS[meta.category]} · {AI_VISIBILITY_LABELS[selected.aiVisibility]}
        </p>
      </header>

      <BlockFields block={selected} />

      {blockIssues.length > 0 && (
        <ul className="inspector__issues">
          {blockIssues.map((issue) => (
            <li key={issue.code} className={`inspector__issue inspector__issue--${issue.severity}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="inspector__actions">
        <button type="button" className="btn" onClick={() => duplicateBlock(blockId)}>블록 복제</button>
        {selected.groupId !== undefined && (
          <button type="button" className="btn" onClick={ungroupSelected}>그룹 해제</button>
        )}
      </div>
      <DeleteBlockAction blockId={blockId} />
    </>
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
