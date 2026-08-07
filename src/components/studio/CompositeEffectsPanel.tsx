/**
 * 합성 효과의 간단 설정 (배경 합성 1차 §9, §11).
 *
 * 전문 편집기를 만들지 않는다. 눈에 보이는 것은 켜기·끄기와 세기 하나씩이고,
 * 고급 수치는 접힌 `세부 조정` 안에 있다. 기본값만으로도 결과가 나오므로, 이
 * 칸을 한 번도 열지 않는 것이 정상 사용이다.
 *
 * 효과는 고른 이미지 하나에만 걸린다. 원본 자산은 바뀌지 않으므로, 세기를 0으로
 * 내리면 그 이미지는 원본 그대로 돌아온다.
 */

import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import { COMPOSITE_EFFECT_FIELDS, DEFAULT_COMPOSITE_EFFECTS } from '../../domain/compositeEffects'
import { PanelFold } from './PanelFold'

export function CompositeEffectsPanel() {
  const studio = useStudioJob()
  const { selected } = useBriefEditor()
  if (studio === null || studio.method !== 'background_composite') return null
  if (selected === null || !getBlockTypeMeta(selected.type).requiresAsset) return null

  const effects = studio.effectsOf(selected.id)

  return (
    <PanelFold id="effects" title="합성 효과" note="그림자 · 림라이트 · 색 맞춤">
    <section className="effects" aria-label="합성 효과">
      <p className="effects__note">원본은 그대로 두고, 그릴 때마다 이 값으로 다시 계산합니다.</p>

      <div className="effects__row">
        {COMPOSITE_EFFECT_FIELDS.map((field) => (
          <button
            key={field.key}
            type="button"
            className={`effects__toggle${effects[field.key] > 0 ? ' is-active' : ''}`}
            aria-pressed={effects[field.key] > 0}
            onClick={() =>
              studio.setEffects(selected.id, {
                [field.key]: effects[field.key] > 0 ? 0 : DEFAULT_COMPOSITE_EFFECTS[field.key],
              })
            }
          >
            {field.label}
          </button>
        ))}
      </div>

      <details className="effects__details">
        <summary className="effects__summary">세부 조정</summary>
        <div className="effects__sliders">
          {COMPOSITE_EFFECT_FIELDS.map((field) => (
            <label key={field.key} className="effects__slider">
              <span className="effects__slider-label">
                {field.label} · {Math.round(effects[field.key] * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(effects[field.key] * 100)}
                aria-label={`${field.label} 세기`}
                onChange={(e) => studio.setEffects(selected.id, { [field.key]: Number(e.target.value) / 100 })}
              />
            </label>
          ))}
          {/* 그레인은 제품 하나가 아니라 완성 결과 전체에 얹힌다 (§9.5). */}
          <label className="effects__slider">
            <span className="effects__slider-label">그레인 (결과 전체) · {Math.round(studio.grain * 100)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(studio.grain * 100)}
              aria-label="그레인 세기"
              onChange={(e) => studio.setGrain(Number(e.target.value) / 100)}
            />
          </label>
        </div>
      </details>
    </section>
    </PanelFold>
  )
}
