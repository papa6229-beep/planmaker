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

export function GenerateImageDialog() {
  const generation = useImageGeneration()
  const [key, setKey] = useState('')
  const state = generation?.state

  // 창이 닫히면 입력하던 키를 화면에서 지운다. 남겨 둘 이유가 없다.
  useEffect(() => {
    if (state?.kind !== 'confirm') setKey('')
  }, [state?.kind])

  if (generation === null || state === undefined) return null
  if (state.kind === 'idle' || state.kind === 'running') return null

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
          <div><dt>요청 크기</dt><dd>{plan.size}</dd></div>
          <div><dt>보낼 이미지</dt><dd>{plan.inputs.length}장</dd></div>
          <div><dt>호출 횟수</dt><dd>{CALL_SUMMARY.calls}회 (자동 재시도 없음)</dd></div>
        </dl>

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
