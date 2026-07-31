/**
 * AI 제작 요청 미리보기 (이미지 생성기 0단계 §6).
 *
 * API를 붙이기 전에 사람이 먼저 읽는 화면이다. "GPT가 이 기획서를 어떻게
 * 읽는가"를 개발자용 JSON이 아니라 쉬운 한국어로 보여 준다 — 구조화 데이터는
 * 필요한 사람만 아래에서 펼친다.
 *
 * 내용은 저장된 과거 상태가 아니라 지금 화면에서 편집 중인 문서로 만든다
 * (`getDocument()`), 그리고 그 계산은 `buildGenerationRequest` 하나뿐이다.
 * 사람이 여기서 본 것과 나중에 GPT가 받는 것이 다르면 이 화면은 의미가 없다.
 */

import { useEffect, useMemo } from 'react'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { buildGenerationRequests } from '../../domain/generationRequest'
import { teamLabel } from '../../domain/requestTeam'

const EMPHASIS_TEXT: Record<string, string> = {
  very_high: '크게 강조',
  high: '크게 강조',
  normal: '보통',
  low: '작게',
}

const ALIGN_TEXT: Record<string, string> = {
  left: '왼쪽',
  center: '가운데',
  right: '오른쪽',
}

export function GenerationRequestPreview({ onClose }: { onClose: () => void }) {
  const { getDocument } = useBriefDocument()
  const studio = useStudioJob()

  const requests = useMemo(
    () => (studio ? buildGenerationRequests(getDocument(), studio.job) : []),
    [getDocument, studio],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const first = requests[0]
  // Publishing info is per page in the request; the reader wants one list.
  const publishing = {
    links: requests.flatMap((r) => r.publishing.links),
    notes: requests.flatMap((r) => r.publishing.notes),
  }

  return (
    <div className="summary-backdrop" role="presentation" onClick={onClose}>
      <div
        className="summary"
        role="dialog"
        aria-modal="true"
        aria-label="AI 제작 요청 미리보기"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="summary__header">
          <h2 className="summary__title">AI 제작 요청 미리보기</h2>
          <button type="button" className="btn" onClick={onClose} aria-label="닫기">닫기</button>
        </header>
        <p className="summary__note">
          아직 이미지를 만들지 않습니다. 지금 기획서를 GPT가 어떻게 읽는지만 보여 줍니다.
        </p>
        {first?.sourceChanged === true && (
          <p className="summary__note summary__note--warn">
            불러온 원본 기획서와 지금 작업본이 달라졌습니다. 원본은 그대로 보관돼 있습니다.
          </p>
        )}

        <section className="summary__area summary__area--design" aria-label="이미지 제작 입력">
          {requests.length === 0 && <p className="summary__empty">아직 불러온 기획서가 없습니다.</p>}

          {requests.map((request) => {
            const { design } = request
            const concept = design.document.concept
            return (
              <article className="summary__page" key={design.document.pageId}>
                <h3 className="summary__area-title">
                  {design.document.pageTitle}{' '}
                  <span>
                    {design.document.canvas.width} × {design.document.canvas.height} · {design.document.title}
                    {design.document.requestTeam === undefined ? '' : ` · ${teamLabel(design.document.requestTeam)}`}
                  </span>
                </h3>

                <h4 className="summary__sub">전체 컨셉 · 요청 메모 <span>이미지에 인쇄하지 않는 지시</span></h4>
                {design.instructions.length === 0 ? (
                  <p className="summary__empty">전달할 컨셉이나 요청 메모가 없습니다.</p>
                ) : (
                  <ul className="summary__list">
                    {design.instructions.map((i, index) => (
                      <li key={i.blockId ?? `document-${index}`}>
                        {i.scope === 'document' && <span className="summary__tag">전체 컨셉</span>} {i.content}{' '}
                        <span className="summary__tag">인쇄하지 않음</span>
                      </li>
                    ))}
                  </ul>
                )}
                {concept === undefined && <p className="summary__empty">전체 컨셉이 비어 있습니다.</p>}

                <h4 className="summary__sub">반드시 그대로 넣을 문구 <span>한 글자도 바뀌지 않습니다</span></h4>
                {design.texts.length === 0 ? (
                  <p className="summary__empty">문구가 없습니다.</p>
                ) : (
                  <ul className="summary__list">
                    {design.texts.map((t) => (
                      <li key={t.blockId}>
                        {t.content}{' '}
                        <span className="summary__tag">
                          가로 {Math.round(t.box.x)} · 세로 {Math.round(t.box.y)} · {Math.round(t.box.width)}×
                          {Math.round(t.box.height)}
                        </span>{' '}
                        <span className="summary__tag">{ALIGN_TEXT[t.align]} 정렬</span>{' '}
                        <span className="summary__tag">{EMPHASIS_TEXT[t.emphasis]}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <h4 className="summary__sub">이미지 자리 <span>참고 이미지와 실제 사용 제품 이미지</span></h4>
                {design.imageSlots.length === 0 ? (
                  <p className="summary__empty">이미지 자리가 없습니다.</p>
                ) : (
                  <ul className="summary__list">
                    {design.imageSlots.map((slot) => (
                      <li key={slot.blockId}>
                        {slot.description ?? '설명이 아직 없습니다.'}{' '}
                        <span className="summary__tag">
                          가로 {Math.round(slot.box.x)} · 세로 {Math.round(slot.box.y)} ·{' '}
                          {Math.round(slot.box.width)}×{Math.round(slot.box.height)}
                        </span>{' '}
                        {slot.referenceAsset ? (
                          <span className="summary__tag summary__tag--reference">참고 이미지 있음 · 최종 사용 아님</span>
                        ) : (
                          <span className="summary__tag">참고 이미지 없음</span>
                        )}{' '}
                        {slot.status === 'linked' ? (
                          <span className="summary__tag summary__tag--product">실제 제품 이미지 연결됨</span>
                        ) : (
                          <span className="summary__tag summary__tag--missing">제품 이미지 미연결</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <h4 className="summary__sub">버튼 문구 <span>주소는 이미지에 넣지 않습니다</span></h4>
                {design.buttons.length === 0 ? (
                  <p className="summary__empty">버튼이 없습니다.</p>
                ) : (
                  <ul className="summary__list">
                    {design.buttons.map((b) => (
                      <li key={b.blockId}>
                        {b.text} <span className="summary__tag">{b.hasLink ? '연결 주소 있음' : '연결 주소 없음'}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <h4 className="summary__sub">참고자료 <span>배경·분위기 참고용</span></h4>
                <p className="summary__field-value">
                  {design.reference.assetId === undefined
                    ? '페이지 참고 이미지가 없습니다.'
                    : `페이지 참고 이미지 있음${design.reference.overlay ? ` · 겹쳐 보기 ${Math.round(design.reference.opacity * 100)}%` : ''}`}
                </p>

                {design.missingProductImages.length > 0 && (
                  <p className="summary__warn">
                    아직 실제 제품 이미지가 연결되지 않은 자리가 {design.missingProductImages.length}곳 있습니다.
                  </p>
                )}
              </article>
            )
          })}

          {first && (
            <>
              <h4 className="summary__sub">GPT가 지켜야 할 것</h4>
              <ul className="summary__list">
                {first.design.constraints.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="summary__area summary__area--publishing" aria-label="퍼블리싱 정보">
          <h3 className="summary__area-title">퍼블리싱 정보 <span>이미지 제작 입력에 포함되지 않음</span></h3>
          {publishing.links.length === 0 && publishing.notes.length === 0 ? (
            <p className="summary__empty">퍼블리싱 정보가 없습니다.</p>
          ) : (
            <ul className="summary__list">
              {publishing.links.map((l) => (
                <li key={l.blockId}>{l.label}: {l.url}</li>
              ))}
              {publishing.notes.map((n) => (
                <li key={n.blockId}>{n.label}: {n.content}</li>
              ))}
            </ul>
          )}
        </section>

        <details className="summary__raw">
          <summary>개발자용 구조화 데이터</summary>
          <pre className="summary__json">{JSON.stringify(requests, null, 2)}</pre>
        </details>
      </div>
    </div>
  )
}
