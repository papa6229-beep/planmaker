/**
 * 생성 방식 고르기와 배경 합성의 실행 (배경 합성 1차 §6, §11).
 *
 * 두 방식은 값을 치르는 방식도, 결과의 성질도 다르다. 그래서 고르는 자리를
 * 버튼 옆에 숨기지 않고 먼저 묻는다.
 *
 *  - 전체 AI 디자인: 제품 원본과 기획서를 함께 보내고 모델이 완성본을 만든다.
 *  - 배경 생성 + 원본 합성: 모델은 빈 배경만 만들고, 원본은 브라우저에서 얹는다.
 *
 * 두 번째를 고른다고 값이 바로 나가지는 않는다. 확인창이 무엇이 만들어지고
 * 무엇이 원본 그대로 남는지 먼저 말한다.
 */

import { useStudioJob } from '../../features/studio/useStudioJob'
import { useBackgroundComposite } from '../../features/studio/useBackgroundComposite'
import type { GenerationMethod } from '../../domain/studioJob'

const METHODS: readonly { value: GenerationMethod; label: string; note: string }[] = [
  {
    value: 'full_ai',
    label: '전체 AI 디자인',
    note: '제품 원본과 기획서를 함께 보내 완성 이미지 1장을 만듭니다.',
  },
  {
    value: 'background_composite',
    label: '배경 생성 + 원본 합성',
    note: '원본은 보내지 않습니다. 빈 배경만 만들고 제품·인물·로고는 그대로 얹습니다.',
  },
]

export function MethodChoice() {
  const studio = useStudioJob()
  const composite = useBackgroundComposite()
  if (studio === null || composite === null) return null

  const isComposite = studio.method === 'background_composite'

  return (
    <section className="method" aria-label="생성 방식">
      <h2 className="method__title">생성 방식</h2>
      <div className="method__options" role="radiogroup" aria-label="생성 방식 선택">
        {METHODS.map((method) => (
          <button
            key={method.value}
            type="button"
            role="radio"
            aria-checked={studio.method === method.value}
            className={`method__option${studio.method === method.value ? ' is-active' : ''}`}
            onClick={() => studio.setMethod(method.value)}
          >
            <span className="method__label">{method.label}</span>
            <span className="method__note">{method.note}</span>
          </button>
        ))}
      </div>

      {isComposite && (
        <>
          <label className="method__field">
            <span className="method__field-label">어떤 배경이면 좋을까요</span>
            <textarea
              className="method__input"
              rows={3}
              value={composite.wish}
              placeholder="예) 따뜻한 베이지 스튜디오, 부드러운 바닥 반사"
              onChange={(e) => composite.setWish(e.target.value)}
            />
          </label>
          <div className="method__actions">
            <button type="button" className="btn" onClick={composite.beginGenerate}>
              AI로 배경 생성
            </button>
            <button type="button" className="btn btn--primary" onClick={composite.saveComposite}>
              원본 합성으로 저장
            </button>
          </div>
          <p className="method__hint">
            `원본 합성으로 저장`은 이미지 생성 호출 없이 지금 배경 위에 원본을 얹어 결과를 만듭니다.
          </p>
        </>
      )}
    </section>
  )
}
