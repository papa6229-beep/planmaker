/**
 * AI summary preview (WORK_PLAN §15, Phase 5). Surfaces the three separated
 * information areas so the user can verify what the image-generation AI reads:
 *
 *   1. 디자인 입력 — the rule-based `designSummary` (headline, products,
 *      benefits, CTAs, verbatim images, layout priority). Never contains a
 *      publishing URL (structurally excluded by summaryBuilder).
 *   2. 참고자료 — reference blocks the AI may consult.
 *   3. 퍼블리싱 정보 — links/notes that are NOT sent to the AI.
 *
 * This is the visible proof of the Phase 5 completion gate: publishing links
 * appear only in area 3.
 */

import { useEffect } from 'react'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { buildDesignSummary, buildPublishingInfo } from '../../domain/summaryBuilder'
import { teamLabel } from '../../domain/requestTeam'

/** Plain-language emphasis labels for the summary. */
const EMPHASIS_TEXT: Record<string, string> = {
  very_high: '크게 강조',
  high: '크게 강조',
  normal: '보통',
  low: '작게',
}

function Field({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null
  return (
    <div className="summary__field">
      <span className="summary__field-label">{label}</span>
      <span className="summary__field-value">{value}</span>
    </div>
  )
}

function List({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="summary__field">
      <span className="summary__field-label">{label}</span>
      <ul className="summary__list">
        {items.map((item, i) => (
          <li key={`${label}-${i}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

export function SummaryPanel({ onClose }: { onClose: () => void }) {
  const { state } = useBriefEditor()
  const { activePageId, concept, requestTeam } = useBriefDocument()
  // 전체 컨셉 and 작성팀 belong to the document, not to the page projection the
  // editor holds, so they are folded in here — otherwise the summary would show
  // them only after a reload.
  const brief = {
    ...state.brief,
    project: {
      ...state.brief.project,
      concept,
      ...(requestTeam === undefined ? {} : { requestTeam }),
    },
  }
  const design = buildDesignSummary(brief, { pageId: activePageId })
  const publishing = buildPublishingInfo(brief)
  const instructionIds = new Set(design.instructions.map((i) => i.blockId))
  const referenceBlocks = brief.blocks.filter(
    (b) => b.aiVisibility === 'reference' && !instructionIds.has(b.id),
  )
  const labelOf = (blockId: string) => brief.blocks.find((b) => b.id === blockId)?.label ?? blockId

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="summary-backdrop" role="presentation" onClick={onClose}>
      <div
        className="summary"
        role="dialog"
        aria-modal="true"
        aria-label="AI 요약 미리보기"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="summary__header">
          <h2 className="summary__title">AI 요약 미리보기</h2>
          <button type="button" className="btn" onClick={onClose} aria-label="닫기">닫기</button>
        </header>
        <p className="summary__note">
          규칙 기반으로 생성되며 MVP에서는 AI를 호출하지 않습니다. 퍼블리싱 정보는 이미지 생성 AI에 전달되지 않습니다.
        </p>

        <section className="summary__area summary__area--design" aria-label="그대로 넣을 문구">
          <h3 className="summary__area-title">그대로 넣을 문구 <span>한 글자도 바뀌지 않습니다</span></h3>
          {design.texts.length === 0 ? (
            <p className="summary__empty">문구가 없습니다.</p>
          ) : (
            <ul className="summary__list">
              {design.texts.map((t) => (
                <li key={t.blockId}>
                  {t.content} <span className="summary__tag">{EMPHASIS_TEXT[t.emphasis]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="summary__area summary__area--instruction" aria-label="요청 메모">
          <h3 className="summary__area-title">전체 컨셉 · 요청 메모 <span>이미지에 인쇄하지 않는 지시</span></h3>
          {design.instructions.length === 0 ? (
            <p className="summary__empty">전달할 컨셉이나 요청 메모가 없습니다.</p>
          ) : (
            <ul className="summary__list">
              {design.instructions.map((i) => (
                <li key={i.blockId ?? 'document-concept'}>
                  {i.scope === 'document' && <span className="summary__tag">전체 컨셉</span>}{' '}
                  {i.content} <span className="summary__tag">인쇄하지 않음</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="summary__area summary__area--design" aria-label="이미지 자리">
          <h3 className="summary__area-title">이미지 자리 <span>어떤 이미지가 어디에 들어가는지</span></h3>
          {design.imageSlots.length === 0 ? (
            <p className="summary__empty">이미지 자리가 없습니다.</p>
          ) : (
            <ul className="summary__list">
              {design.imageSlots.map((slot) => (
                <li key={slot.blockId}>
                  {slot.description ?? <span className="summary__empty">설명이 아직 없습니다.</span>}
                  {slot.referenceOnly && (
                    <span className="summary__tag summary__tag--reference">참고용 이미지 첨부됨 · 최종 사용 이미지 아님</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="summary__area summary__area--design" aria-label="디자인 입력 요약">
          <h3 className="summary__area-title">디자인 입력 <span>이미지 생성 AI가 읽는 정보</span></h3>
          <Field label="작성팀" value={design.requestTeam === undefined ? undefined : teamLabel(design.requestTeam)} />
          <Field label="메인 문구" value={design.mainHeadline} />
          <List label="서브 문구" items={design.subHeadlines} />
          <List label="필수 문구" items={design.requiredTexts.map((t) => `${t.label}: ${t.content}`)} />
          <List
            label="제품"
            items={design.requiredProducts.map(
              // No invented names: a product nobody named simply says so.
              (p) => `${p.productName ?? '제품명 미입력'}${p.required ? ' (필수)' : ''}${p.allowTransform ? '' : ' · 변형 불가'}`,
            )}
          />
          <List label="혜택·조건" items={design.requiredBenefits.map((b) => `${b.label}: ${b.content}`)} />
          <Field label="기간" value={design.period} />
          <Field label="가격" value={design.price} />
          <Field label="할인율" value={design.discountRate} />
          <List label="주의 문구" items={design.cautions} />
          <List
            label="버튼 문구"
            items={design.ctaButtons.map((c) => `${c.text} ${c.hasLink ? '(연결 있음)' : '(연결 없음)'}`)}
          />
          <List
            label="그대로 삽입할 이미지"
            items={design.verbatimImages.map((v) => v.productName ?? labelOf(v.blockId))}
          />
          <List
            label="대략적 배치 우선순위"
            items={design.layoutHints.map(
              (h, i) => `${i + 1}. ${labelOf(h.blockId)} (${h.region}/${h.emphasis}/${h.alignment})`,
            )}
          />
        </section>

        <section className="summary__area summary__area--reference" aria-label="참고자료">
          <h3 className="summary__area-title">참고자료 <span>AI가 참고할 수 있는 정보</span></h3>
          {referenceBlocks.length === 0 ? (
            <p className="summary__empty">참고자료 블록이 없습니다.</p>
          ) : (
            <ul className="summary__list">
              {referenceBlocks.map((b) => (
                <li key={b.id}>{b.label}{b.content ? `: ${b.content}` : ''}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="summary__area summary__area--publishing" aria-label="퍼블리싱 정보">
          <h3 className="summary__area-title">퍼블리싱 정보 <span>이미지 생성 AI에 전달되지 않음</span></h3>
          {publishing.links.length === 0 && publishing.notes.length === 0 ? (
            <p className="summary__empty">퍼블리싱 정보가 없습니다.</p>
          ) : (
            <ul className="summary__list">
              {publishing.links.map((l) => (
                <li key={l.blockId}>{l.label}: {l.url}{l.purpose ? ` (${l.purpose})` : ''}</li>
              ))}
              {publishing.notes.map((n) => (
                <li key={n.blockId}>{n.label}: {n.content}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
