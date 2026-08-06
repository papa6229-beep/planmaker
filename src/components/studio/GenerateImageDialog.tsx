/**
 * 이미지 생성 확인 창 (1단계 §6, 키 교정 §1).
 *
 * 생성은 돈이 드는 일이라, 누르기 전에 무엇을 얼마나 쓰는지 한 번 보여 준다 —
 * 모델·품질·요청 크기·호출 횟수. 그리고 키가 아직 없으면 여기서 받는다.
 *
 * 키 입력창을 따로 띄우지 않고 같은 창에 두는 이유는, 사람이 답해야 할 것이
 * 결국 하나의 질문이기 때문이다: "이대로 한 번 생성할까요?"
 *
 * 이 창은 막힌 이유와 실패 원인도 같은 자리에서 말한다. 실패했을 때 창이
 * 사라지면 사람은 무엇이 잘못됐는지 모른 채 다시 누르게 된다.
 */

import { useEffect, useState } from 'react'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { CALL_SUMMARY } from '../../features/studio/useImageGeneration'
import { sizeLabel } from '../../services/workingImage'

/** 목록에서 한눈에 알아볼 만큼만. 전체 문장은 펼치면 그대로 있다. */
function summarize(instruction: string): string {
  const flat = instruction.trim().replace(/\s+/g, ' ')
  return flat.length > 32 ? `${flat.slice(0, 32)}…` : flat
}

export function GenerateImageDialog() {
  const generation = useImageGeneration()
  const [key, setKey] = useState('')
  const state = generation?.state

  // 창이 닫히면 입력하던 키를 화면에서 지운다. 남겨 둘 이유가 없다.
  useEffect(() => {
    if (state?.kind !== 'confirm') setKey('')
  }, [state?.kind])

  /**
   * Esc로 닫는다 (손검수 Patch 1-B §13). 내용이 길어 아래 버튼이 화면 밖으로
   * 밀렸을 때도 사람이 빠져나올 길은 있어야 한다 — 스크롤은 그 다음 문제다.
   */
  const open = state !== undefined && state.kind !== 'idle' && state.kind !== 'running'
  const dismiss = generation?.dismiss
  useEffect(() => {
    if (!open || dismiss === undefined) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  if (generation === null || state === undefined) return null
  if (state.kind === 'idle' || state.kind === 'running') return null

  // 생성은 됐고 작업본 변환만 실패한 자리. 이미 결제된 그림이 손에 있으므로
  // 닫는 것보다 다시 만드는 것이 먼저다 — 다시 만들어도 모델은 부르지 않는다.
  if (state.kind === 'convert-failed') {
    return (
      <div className="confirm-backdrop" role="presentation">
        <div className="confirm" role="alertdialog" aria-modal="true" aria-label="작업본 변환 실패">
          <h2 className="confirm__title">{state.message}</h2>
          <p className="confirm__body">
            생성된 이미지는 그대로 남아 있습니다. 다시 만들기는 이미 받은 이미지만 사용하므로 추가 요금이 들지
            않습니다.
          </p>
          <div className="confirm__actions">
            <button type="button" className="btn" onClick={generation.dismiss}>닫기</button>
            <button type="button" className="btn btn--primary" onClick={generation.retryConversion}>
              작업본 다시 만들기
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 부분수정 확인. 무엇을 고치라고 말했는지 사람이 자기 문장으로 한 번 더 읽는다.
  if (state.kind === 'edit-confirm') {
    return (
      <div className="confirm-backdrop" role="presentation" onClick={generation.dismiss}>
        <div
          className="confirm confirm--scrollable gen-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="AI 부분수정"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 머리와 바닥은 제자리에 붙어 있고 가운데만 흐른다. 대상이 여섯이면
              내용은 화면 높이를 쉽게 넘는데, 그때 아래 버튼이 함께 밀려 내려가면
              사람은 시작할 수도 취소할 수도 없다 (손검수 Patch 1-B §7). */}
          <div className="confirm__head">
            <h2 className="confirm__title">이 부분을 수정합니다</h2>
            <p className="confirm__subtitle">대상 {state.items.length}개</p>
          </div>
          <div className="confirm__body">
            {/* 대상과 그 대상의 지시를 한 덩어리로 합치지 않는다 — 합치면 어느 말이
                어느 대상에게 간 것인지 사람이 확인할 수 없다. 기본은 한 줄 요약이고,
                긴 문장은 펼쳐서 읽는다 (§8). */}
            <ul className="gen-dialog__targets">
              {state.items.map((item) => (
                <li key={item.target.targetId}>
                  <details className="gen-dialog__target">
                    <summary className="gen-dialog__target-label">
                      {item.target.label}
                      <span className="gen-dialog__target-brief">{summarize(item.instruction)}</span>
                    </summary>
                    <span className="gen-dialog__target-instruction">수정 지시: {item.instruction}</span>
                  </details>
                </li>
              ))}
            </ul>
            <dl className="gen-dialog__facts">
              <div><dt>모델</dt><dd>{CALL_SUMMARY.model}</dd></div>
              <div><dt>품질</dt><dd>{CALL_SUMMARY.quality}</dd></div>
              <div><dt>AI 편집 규격</dt><dd>{state.plan.size}</dd></div>
              <div><dt>최종 작업 이미지</dt><dd>{sizeLabel(state.plan.working)}</dd></div>
              <div><dt>호출 횟수</dt><dd>{state.plan.calls}회 (자동 재시도 없음)</dd></div>
            </dl>
            <p className="gen-dialog__hint">
              한 장짜리 이미지를 AI가 다시 그리는 방식이라, 고르지 않은 주변 요소도 조금 달라질 수 있습니다.
            </p>
          </div>
          <div className="confirm__actions">
            <button type="button" className="btn" onClick={generation.dismiss}>취소</button>
            <button type="button" className="btn btn--primary" onClick={generation.confirmEdit}>수정 시작</button>
          </div>
        </div>
      </div>
    )
  }

  if (state.kind === 'blocked' || state.kind === 'failed') {
    return (
      <div className="confirm-backdrop" role="presentation" onClick={generation.dismiss}>
        <div
          className="confirm"
          role="alertdialog"
          aria-modal="true"
          aria-label={state.kind === 'blocked' ? '생성할 수 없음' : '이미지 생성 실패'}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="confirm__title">{state.kind === 'blocked' ? '아직 생성할 수 없습니다' : '이미지를 생성하지 못했습니다'}</h2>
          <p className="confirm__body">{state.message}</p>
          <div className="confirm__actions">
            <button type="button" className="btn btn--primary" onClick={generation.dismiss}>확인</button>
          </div>
        </div>
      </div>
    )
  }

  const { plan, needsKey } = state
  return (
    <div className="confirm-backdrop" role="presentation" onClick={generation.dismiss}>
      <div
        className="confirm gen-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="이미지 생성"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="confirm__title">이미지를 생성합니다</h2>
        <dl className="gen-dialog__facts">
          <div><dt>모델</dt><dd>{CALL_SUMMARY.model}</dd></div>
          <div><dt>품질</dt><dd>{CALL_SUMMARY.quality}</dd></div>
          {/* 두 크기는 다른 것이고, 하나만 보이면 최종 파일도 그 크기인 줄 안다.
              모델은 16의 배수만 받으므로 840을 보낼 수 없고, 840은 받은 뒤에
              이쪽에서 맞춘다 (마감 교정 §3). */}
          <div><dt>AI 생성 규격</dt><dd>{plan.size}</dd></div>
          <div><dt>최종 작업 이미지</dt><dd>{sizeLabel(plan.working)}</dd></div>
          <div><dt>보낼 이미지</dt><dd>{plan.inputs.length}장</dd></div>
          {/* 한 번 눌러도 안에서 두 번 나가는 길이 있다 (한방 생성 Patch 2 §4).
              그 수를 화면이 그대로 말한다 — 결제는 이 숫자만큼 일어난다. */}
          <div><dt>호출 횟수</dt><dd>{plan.calls}회 (자동 재시도 없음)</dd></div>
        </dl>

        {plan.mode === 'preserve' && (
          <p className="gen-dialog__hint">
            배경과 장식을 한 번, 문구 레이어를 한 번 만듭니다. 캔버스에 놓인 이미지 {plan.fixedBlockIds.length}장은
            AI에 보내지 않고 지금 위치·크기 그대로 합성합니다.
          </p>
        )}

        {needsKey && (
          <label className="gen-dialog__field">
            <span className="gen-dialog__label">테스트용 OpenAI API 키</span>
            <input
              className="field__input"
              type="password"
              autoFocus
              aria-label="테스트용 OpenAI API 키"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <span className="gen-dialog__hint">
              이 탭에만 보관되며 탭을 닫으면 지워집니다. 저장소나 파일에는 남지 않습니다.
            </span>
          </label>
        )}

        <div className="confirm__actions">
          <button type="button" className="btn" onClick={generation.dismiss}>취소</button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={needsKey && key.trim().length === 0}
            onClick={() => generation.confirm(needsKey ? key : undefined)}
          >
            {needsKey ? '저장하고 계속' : '생성 시작'}
          </button>
        </div>
      </div>
    </div>
  )
}
