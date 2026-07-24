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
import type { BriefBlock } from '../../domain/briefSchema'
import { validateBrief } from '../../domain/validation'
import { CATEGORY_LABELS } from '../uiLabels'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useAssets } from '../../features/assets/useAssets'
import { ACCEPTED_MIME_TYPES } from '../../features/assets/imageUtils'
import { useRef } from 'react'
import { EmptySelection } from './EmptySelection'

const IMAGE_ACCEPT = ACCEPTED_MIME_TYPES.join(',')

/** Upload / preview / remove control for an image block (WORK_PLAN §11). */
function ImageField({ block }: { block: BriefBlock }) {
  const { uploadFiles, getUrl } = useAssets()
  const { removeBlockAsset } = useBriefEditor()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const url = getUrl(block.assetId)

  return (
    <div className="field">
      <span className="field__label">이미지</span>
      {url ? (
        <img className="image-field__preview" src={url} alt={block.image?.productName ?? block.label} />
      ) : (
        <div className="image-field__empty">이미지가 없습니다</div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="image-field__input"
        onChange={(e) => {
          const files = e.target.files
          if (files && files.length > 0) void uploadFiles(files, { targetBlockId: block.id })
          e.target.value = ''
        }}
      />
      <div className="image-field__actions">
        <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
          {url ? '이미지 교체' : '이미지 업로드'}
        </button>
        {url && (
          <button type="button" className="btn" onClick={() => removeBlockAsset(block.id)}>이미지 제거</button>
        )}
      </div>
      <p className="field__note">붙여넣기(Ctrl+V) 또는 캔버스로 드래그도 가능합니다.</p>
    </div>
  )
}

/**
 * Minimal block editor (WORK_PLAN §11.2, Phase 7 Step 6). Only the essentials:
 * 라벨 · 내용(텍스트) · 이미지(교체/제거)·제품명(이미지) · 필수 여부 · 메모.
 * Importance, AI-visibility, layout hints, and the delete button are removed —
 * their domain fields keep their defaults; the design/publishing distinction is
 * driven by the block type, and deletion is done on the canvas.
 */
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
          <ImageField block={block} />
          <label className="field">
            <span className="field__label">제품명</span>
            <input
              className="field__input"
              type="text"
              value={block.image?.productName ?? ''}
              onChange={(e) => updateBlock(block.id, { image: { productName: e.target.value } }, editKey)}
            />
          </label>
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
  const { selectedBlocks, groupSelected, ungroupSelected, duplicateSelected } = useBriefEditor()
  const anyGrouped = selectedBlocks.some((b) => b.groupId !== undefined)

  return (
    <>
      <header className="inspector__header">
        <p className="inspector__type">{count}개 블록 선택됨</p>
        <p className="inspector__role">그룹으로 묶어 함께 이동할 수 있습니다. 삭제는 Delete 키 또는 카드 메뉴로.</p>
      </header>
      <div className="inspector__actions">
        <button type="button" className="btn" onClick={groupSelected}>그룹으로 묶기</button>
        {anyGrouped && (
          <button type="button" className="btn" onClick={ungroupSelected}>그룹 해제</button>
        )}
        <button type="button" className="btn" onClick={duplicateSelected}>복제</button>
      </div>
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
        <p className="inspector__role">{CATEGORY_LABELS[meta.category]}</p>
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
      <p className="inspector__hint">삭제는 Delete 키 또는 카드 ⋯ 메뉴로 합니다.</p>
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
