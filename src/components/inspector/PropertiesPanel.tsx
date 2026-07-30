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
import {
  EMPHASIS_CHOICES,
  SIMPLE_BLOCKS,
  findLinkPartner,
  simpleEmphasisOf,
  simpleKindOf,
  toLayoutEmphasis,
  type SimpleBlockKind,
} from '../../domain/simpleBlocks'
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
 * Fields for the four simplified tools (1차 단순화 §2.3). Each asks for the one
 * thing that matters and keeps the rest optional:
 *   글 넣기      정확한 문구 (필수) + 강조 정도
 *   이미지 자리  자리 설명 (필수) + 이미지 업로드 · 상품명 (선택)
 *   버튼·링크    버튼 문구 (필수) + 연결 주소 · 연결 목적 (선택, 퍼블리싱에 보존)
 *   요청 메모    전달할 요청 (인쇄되지 않음)
 */
function SimpleBlockFields({ block, kind }: { block: BriefBlock; kind: SimpleBlockKind }) {
  const { state, updateBlock } = useBriefEditor()
  const editKey = `edit:${block.id}`
  const partner = kind === 'buttonLink' ? findLinkPartner(state.brief.blocks, block) : undefined

  if (kind === 'text') {
    return (
      <div className="fields">
        <label className="field">
          <span className="field__label">문구</span>
          <textarea
            className="field__input field__input--area"
            rows={3}
            placeholder="실제로 넣을 문구를 그대로 적어 주세요"
            value={block.content ?? ''}
            onChange={(e) => updateBlock(block.id, { content: e.target.value }, editKey)}
          />
        </label>
        <fieldset className="field field--group">
          <legend className="field__label">강조 정도</legend>
          <div className="emphasis-choice" role="radiogroup" aria-label="강조 정도">
            {EMPHASIS_CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={simpleEmphasisOf(block) === c.value}
                className={`emphasis-choice__btn${simpleEmphasisOf(block) === c.value ? ' is-active' : ''}`}
                onClick={() => updateBlock(block.id, { layoutHint: { emphasis: toLayoutEmphasis(c.value) } })}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="field__note">크기·폰트·색은 AI가 정합니다. 문구는 그대로 지켜집니다.</p>
        </fieldset>
      </div>
    )
  }

  if (kind === 'imageSlot') {
    return (
      <div className="fields">
        <label className="field">
          <span className="field__label">어떤 이미지 자리인가요?</span>
          <textarea
            className="field__input field__input--area"
            rows={2}
            placeholder="예: 여기에 대표 제품 사진"
            value={block.content ?? ''}
            onChange={(e) => updateBlock(block.id, { content: e.target.value }, editKey)}
          />
        </label>
        <ImageField block={block} />
        <label className="field">
          <span className="field__label">상품명 · 추가 메모 (선택)</span>
          <input
            className="field__input"
            type="text"
            value={block.image?.productName ?? ''}
            onChange={(e) => updateBlock(block.id, { image: { productName: e.target.value } }, editKey)}
          />
        </label>
      </div>
    )
  }

  if (kind === 'buttonLink') {
    return (
      <div className="fields">
        <label className="field">
          <span className="field__label">버튼에 보일 문구</span>
          <input
            className="field__input"
            type="text"
            placeholder="예: 지금 신청하기"
            value={block.content ?? ''}
            onChange={(e) => updateBlock(block.id, { content: e.target.value }, editKey)}
          />
        </label>
        {partner && (
          <>
            <label className="field">
              <span className="field__label">연결 주소 (선택)</span>
              <input
                className="field__input"
                type="text"
                placeholder="https://"
                value={partner.content ?? ''}
                onChange={(e) => updateBlock(partner.id, { content: e.target.value }, `edit:${partner.id}`)}
              />
            </label>
            <label className="field">
              <span className="field__label">연결 목적 메모 (선택)</span>
              <input
                className="field__input"
                type="text"
                value={partner.notes ?? ''}
                onChange={(e) => updateBlock(partner.id, { notes: e.target.value }, `edit:${partner.id}`)}
              />
            </label>
            <p className="field__note">주소는 퍼블리싱 정보로만 보관되며, 이미지 안에 글자로 그려지지 않습니다.</p>
          </>
        )}
      </div>
    )
  }

  // kind === 'note'
  return (
    <div className="fields">
      <label className="field">
        <span className="field__label">전달할 요청</span>
        <textarea
          className="field__input field__input--area"
          rows={3}
          placeholder="예: 이 부분은 시원한 느낌으로, 제품 세 개를 함께 배치"
          value={block.content ?? ''}
          onChange={(e) => updateBlock(block.id, { content: e.target.value }, editKey)}
        />
      </label>
      <p className="field__note">이미지에 인쇄되지 않습니다. AI와 디자인팀에게 전달되는 요청입니다.</p>
    </div>
  )
}

/**
 * Generic editor kept for blocks with an explicit legacy type (메인 문구 · 가격 ·
 * 혜택 …). Existing documents stay fully editable without being rewritten into
 * the four simplified tools.
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
  const kind = simpleKindOf(selected)
  const simple = kind === null ? undefined : SIMPLE_BLOCKS.find((s) => s.kind === kind)
  const issues = validateBrief(state.brief)
  const blockIssues = [...issues.errors, ...issues.warnings].filter((i) => i.blockId === blockId)
  const paired = findLinkPartner(state.brief.blocks, selected) !== undefined

  return (
    <>
      <header className="inspector__header">
        <p className="inspector__type">{simple ? simple.label : meta.label}</p>
        <p className="inspector__role">{simple ? simple.hint : CATEGORY_LABELS[meta.category]}</p>
      </header>

      {kind === null ? <BlockFields block={selected} /> : <SimpleBlockFields block={selected} kind={kind} />}

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
        {/* A 버튼·링크 pair is held together by its group id, so ungrouping it
            would split one tool back into two cards. */}
        {selected.groupId !== undefined && !paired && (
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
