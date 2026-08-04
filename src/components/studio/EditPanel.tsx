/**
 * AI 부분수정 패널 (부분수정 1단계 §2.3).
 *
 * 여기서 하는 일은 통이미지의 제한된 수정이다. 목록의 번호는 AI 내부의 레이어
 * 번호가 아니라, 생성 순간에 얼려 둔 기획서 블록의 이름표다 — 사람이 "무엇을"
 * 가리키고, 그 정보를 다음 호출에 다시 실어 보내기 위한 것이다.
 *
 * 결과가 없으면 이 패널은 아예 나타나지 않는다. 고칠 것이 없는데 고치는 자리를
 * 보여 주면, 누를 수 없는 버튼 앞에서 이유를 찾게 된다.
 */

import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { useInstructionRefine } from '../../features/studio/useInstructionRefine'
import { REFINE_COST_NOTE } from '../../domain/instructionRefine'

export function EditPanel() {
  const generation = useImageGeneration()
  const refine = useInstructionRefine()
  if (generation === null || !generation.hasResult || generation.editTargets.length === 0) return null

  const busy = generation.state.kind === 'running'
  const chosen = generation.editTargets.filter((t) => generation.selectedTargetIds.includes(t.targetId))

  return (
    <section className="edit-panel" role="region" aria-label="AI 부분수정">
      <header className="edit-panel__head">
        <h2 className="edit-panel__title">AI 부분수정</h2>
        <p className="edit-panel__hint">
          고칠 대상을 고르고 원하는 바를 문장으로 적어 주세요. 한 장짜리 이미지를 다시 그리는 방식이라 주변이 조금
          달라질 수 있습니다.
        </p>
      </header>

      <ul className="edit-panel__targets">
        {generation.editTargets.map((t) => (
          <li key={t.targetId}>
            <label className="edit-panel__target">
              <input
                type="checkbox"
                aria-label={t.label}
                checked={generation.selectedTargetIds.includes(t.targetId)}
                disabled={busy}
                onChange={() => generation.toggleTarget(t.targetId)}
              />
              <span>{t.label}</span>
            </label>
          </li>
        ))}
      </ul>

      {/* 고른 대상마다 자기 지시 칸을 갖는다. 하나의 문장을 여럿에게 나눠 쓰면
          "이 문구만"이라는 말이 어느 문구를 가리키는지 알 수 없어진다. */}
      {chosen.map((t) => (
        <div className="edit-card" key={t.targetId}>
          <div className="edit-card__head">
            <span className="edit-card__label">{t.label}</span>
            <button
              type="button"
              className="edit-card__remove"
              aria-label={`${t.label} 선택 해제`}
              disabled={busy}
              onClick={() => generation.toggleTarget(t.targetId)}
            >
              선택 해제
            </button>
          </div>
          {t.content !== undefined && <p className="edit-card__content">“{t.content}”</p>}
          <p className="edit-card__label edit-card__label--sub">내가 쓴 지시</p>
          <textarea
            className="field__input edit-panel__input"
            aria-label={`${t.label} 수정 지시`}
            rows={3}
            placeholder="예: 숫자가 잘 읽히는 간결한 폰트로 바꿔 주세요. 위치와 크기는 유지합니다."
            value={generation.instructionFor(t.targetId)}
            disabled={busy}
            onChange={(e) => generation.setInstructionFor(t.targetId, e.target.value)}
          />
          {/* 다듬은 문장은 내 문장을 덮지 않고 그 아래에 놓인다. 어느 대상의
              제안인지 카드가 이미 말하므로 여기서 이름을 다시 붙이지 않는다. */}
          {refine?.proposalFor(t.targetId) != null && (
            <div className="refine__proposal refine__proposal--card">
              <p className="refine__label">AI가 다듬은 지시</p>
              <p className="refine__text">{refine.proposalFor(t.targetId)!.revised}</p>
              {refine.proposalFor(t.targetId)!.warning !== undefined && (
                <p className="refine__warn">{refine.proposalFor(t.targetId)!.warning}</p>
              )}
              <button
                type="button"
                className="btn"
                aria-label={`${t.label} 다듬은 지시 적용`}
                disabled={busy}
                onClick={() => refine.applyTarget(t.targetId)}
              >
                개별 적용
              </button>
            </div>
          )}
        </div>
      ))}

      {/* 고른 대상이 여럿이어도 요청은 한 번이다. 다듬은 뒤에 아무것도 스스로
          시작하지 않는다 — 실행은 아래 버튼을 사람이 누를 때다 (§10). */}
      {refine !== null && chosen.length > 0 && (
        <div className="refine">
          <div className="refine__actions">
            <button
              type="button"
              className="btn"
              disabled={!refine.canRefineTargets || busy}
              onClick={refine.refineTargets}
              title="고른 대상의 지시를 실행 가능한 문장으로 다듬습니다"
            >
              {refine.targetsBusy ? '다듬는 중…' : '선택 지시 AI로 다듬기'}
            </button>
            {refine.hasTargetProposals && (
              <button type="button" className="btn" disabled={busy} onClick={refine.applyAllTargets}>
                모두 적용
              </button>
            )}
          </div>
          <p className="refine__cost">{REFINE_COST_NOTE}</p>
          {refine.targetsError !== null && (
            <p className="refine__error" role="status">{refine.targetsError}</p>
          )}
        </div>
      )}

      {generation.editBlockedReason !== null && (
        <p className="edit-panel__warn" role="status">{generation.editBlockedReason}</p>
      )}

      <div className="edit-panel__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!generation.canEdit || busy}
          onClick={generation.beginEdit}
        >
          AI 부분수정 실행
        </button>
      </div>

      {/* 결과의 줄. 앞뒤로 오가도 외부 호출은 없고 그림도 새로 만들지 않는다. */}
      <div className="edit-panel__history">
        <span className="edit-panel__position">
          결과 {generation.revisionPosition} / {generation.revisionCount}
        </span>
        <button
          type="button"
          className="btn"
          disabled={!generation.canGoPrevious || busy}
          onClick={generation.goPrevious}
          title="외부 호출 없이 한 단계 앞의 결과를 봅니다"
        >
          이전 결과
        </button>
        <button
          type="button"
          className="btn"
          disabled={!generation.canGoNext || busy}
          onClick={generation.goNext}
          title="외부 호출 없이 한 단계 뒤의 결과를 봅니다"
        >
          다음 결과
        </button>
        <button
          type="button"
          className="btn"
          disabled={!generation.canGoPrevious || busy}
          onClick={generation.goOriginal}
          title="외부 호출 없이 맨 처음 만든 이미지로 돌아갑니다"
        >
          최초 생성본으로 복원
        </button>
      </div>
    </section>
  )
}
