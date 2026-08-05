/**
 * 배경 생성 확인창과 그 결과 (배경 합성 1차 §6, §11).
 *
 * 확인창이 말하는 다섯 가지는 §6이 그대로 요구한 것들이다. 값이 나가는 버튼
 * 앞에서 작업자가 알아야 하는 것은 "무엇이 만들어지고, 무엇이 원본 그대로
 * 남고, 몇 번 나가는가"이고, 그 셋을 모르면 누를지 말지를 정할 수 없다.
 *
 * 대화상자 구조는 다른 확인창과 같다 — 머리는 고정, 몸은 스크롤, 발도 고정.
 * 1280×720에서도 실행 버튼이 화면 밖으로 밀리지 않는다.
 */

import { useEffect } from 'react'
import { useBackgroundComposite } from '../../features/studio/useBackgroundComposite'

export function BackgroundDialog() {
  const composite = useBackgroundComposite()
  const state = composite?.state
  const open = state !== undefined && state.kind !== 'idle'
  const dismiss = composite?.dismiss

  useEffect(() => {
    if (!open || dismiss === undefined) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  if (composite === null || state === undefined || state.kind === 'idle') return null

  if (state.kind === 'confirm') {
    return (
      <div className="confirm-backdrop">
        <div className="confirm confirm--scrollable" role="dialog" aria-modal="true" aria-label="배경 생성 확인">
          <div className="confirm__head">
            <h2 className="confirm__title">빈 배경 1장을 만듭니다</h2>
            <p className="confirm__subtitle">제품·인물·로고 원본은 모델에게 보내지 않습니다.</p>
          </div>
          <div className="confirm__body">
            <dl className="gen-dialog__facts">
              <dt>AI가 만드는 것</dt>
              <dd>{state.facts.generates}</dd>
              <dt>원본 그대로 합성하는 것</dt>
              <dd>{state.facts.keeps}</dd>
              <dt>외부 이미지 생성 호출</dt>
              <dd>{state.facts.externalCalls}회</dd>
              <dt>자동 재시도</dt>
              <dd>{state.facts.autoRetries}회 (없음)</dd>
              <dt>최종 크기</dt>
              <dd>{state.facts.finalSize}</dd>
            </dl>
            <p className="gen-dialog__hint">
              보내는 것은 색·명도·대비·광원 같은 수치와 적어 주신 배경 주문뿐입니다. 원본 파일과 그 내용은
              브라우저 밖으로 나가지 않습니다.
            </p>
          </div>
          <div className="confirm__actions">
            <button type="button" className="btn" onClick={composite.dismiss}>
              취소
            </button>
            <button type="button" className="btn btn--primary" onClick={composite.confirmGenerate}>
              배경 만들기
            </button>
          </div>
        </div>
      </div>
    )
  }

  const message =
    state.kind === 'analyzing'
      ? '연결된 이미지를 브라우저에서 읽는 중…'
      : state.kind === 'running'
        ? '배경을 만드는 중…'
        : state.kind === 'composing'
          ? '원본을 얹어 결과를 만드는 중…'
          : state.message

  const busy = state.kind === 'analyzing' || state.kind === 'running' || state.kind === 'composing'

  return (
    <div className="confirm-backdrop">
      <div className="confirm" role="dialog" aria-modal="true" aria-label="배경 생성 상태">
        <div className="confirm__head">
          <h2 className="confirm__title">{state.kind === 'failed' ? '만들지 못했습니다' : '배경 합성'}</h2>
        </div>
        <div className="confirm__body">
          <p>{message}</p>
        </div>
        {!busy && (
          <div className="confirm__actions">
            <button type="button" className="btn btn--primary" onClick={composite.dismiss}>
              확인
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
