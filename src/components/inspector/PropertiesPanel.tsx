/**
 * Right column: properties of the selected block (WORK_PLAN §6). Edits only the
 * common fields already defined in the Phase 1 schema — no new domain fields.
 * Enum fields use <select>, so invalid values can't be entered; free-text
 * fields are validated live and surfaced as issues below.
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

  return (
    <div className="fields">
      <label className="field">
        <span className="field__label">라벨</span>
        <input
          className="field__input"
          type="text"
          value={block.label}
          onChange={(e) => updateBlock(block.id, { label: e.target.value })}
        />
      </label>

      {meta.hasText && (
        <label className="field">
          <span className="field__label">내용</span>
          <textarea
            className="field__input field__input--area"
            rows={3}
            value={block.content ?? ''}
            onChange={(e) => updateBlock(block.id, { content: e.target.value })}
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
              onChange={(e) => updateBlock(block.id, { image: { productName: e.target.value } })}
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
          onChange={(e) => updateBlock(block.id, { notes: e.target.value })}
        />
      </label>
    </div>
  )
}

export function PropertiesPanel() {
  const { state, selected } = useBriefEditor()

  if (selected === null) {
    return (
      <aside className="inspector" aria-label="선택 블록 설정">
        <EmptySelection />
      </aside>
    )
  }

  const meta = getBlockTypeMeta(selected.type)
  const issues = validateBrief(state.brief)
  const blockIssues = [...issues.errors, ...issues.warnings].filter((i) => i.blockId === selected.id)

  return (
    <aside className="inspector" aria-label="선택 블록 설정">
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
            <li
              key={issue.code}
              className={`inspector__issue inspector__issue--${issue.severity}`}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <DeleteBlockAction blockId={selected.id} />
    </aside>
  )
}
