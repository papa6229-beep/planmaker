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

export function EditPanel() {
  const generation = useImageGeneration()
  if (generation === null || !generation.hasResult || generation.editTargets.length === 0) return null

  const busy = generation.state.kind === 'running'

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

      {generation.selectedTargetIds.length > 0 && (
        <p className="edit-panel__chips">
          {generation.editTargets
            .filter((t) => generation.selectedTargetIds.includes(t.targetId))
            .map((t) => (
              <span className="edit-panel__chip" key={t.targetId}>{t.label}</span>
            ))}
        </p>
      )}

      <label className="edit-panel__field">
        <span className="edit-panel__label">수정 지시</span>
        <textarea
          className="field__input edit-panel__input"
          aria-label="수정 지시"
          rows={3}
          placeholder="예: 위의 20% OFF와 간격이 좁아지도록 조금 위로 이동해 주세요. 글자 내용과 기존 효과는 유지하세요."
          value={generation.instruction}
          disabled={busy}
          onChange={(e) => generation.setInstruction(e.target.value)}
        />
      </label>

      <div className="edit-panel__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!generation.canEdit || busy}
          onClick={generation.beginEdit}
        >
          AI 부분수정 실행
        </button>
        <button
          type="button"
          className="btn"
          disabled={!generation.canRevertPrevious || busy}
          onClick={generation.revertToPrevious}
          title="외부 호출 없이 직전 이미지로 돌아갑니다"
        >
          직전 결과로 되돌리기
        </button>
        <button
          type="button"
          className="btn"
          disabled={!generation.canRevertOriginal || busy}
          onClick={generation.revertToOriginal}
          title="외부 호출 없이 맨 처음 만든 이미지로 돌아갑니다"
        >
          최초 생성본으로 복원
        </button>
      </div>
    </section>
  )
}
