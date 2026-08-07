/**
 * 완성 결과 전체의 톤 조절 (톤 조절 Patch).
 *
 * 포토샵의 곡선을 옮기지 않는다. 곡선은 그래프를 손으로 끌어야 쓸모가 있고, 그
 * 화면은 여기 있는 어떤 패널보다 크다. 먼저 슬라이더 넷을 둔다 — 실무에서 손대는
 * 것의 대부분이 여기서 끝난다.
 *
 * **원본은 바뀌지 않는다.** 여기 적히는 값은 다시 그릴 때 곱하는 것이라, 전부
 * 0으로 내리면 손대기 전 그림이 그대로 돌아온다. AI 호출도 없다 — 그림은 전부
 * 손에 있고 다시 합치기만 하면 된다.
 *
 * 결과가 있을 때만 나온다. 없는 결과의 톤을 미리 조절할 수는 없다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { TONE_FIELDS, toneIsFlat } from '../../domain/toneAdjust'

export function ToneAdjustPanel() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { activePageId } = useBriefDocument()
  if (studio === null || generation === null || !generation.hasResult) return null

  const tone = studio.toneOf(activePageId)
  const busy = generation.state.kind === 'running'
  /** 손을 뗀 뒤 한 번 다시 합친다. 끄는 동안 매번 합치면 화면이 버벅인다. */
  const settle = () => void generation.recomposePage(activePageId)

  return (
    <section className="tone" aria-label="결과 톤 조절">
      <h2 className="tone__title">결과 톤 조절</h2>
      <p className="tone__note">
        완성 결과 전체에 겁니다. 원본은 그대로 두고 그릴 때마다 이 값으로 다시 계산합니다.
      </p>

      <div className="tone__sliders">
        {TONE_FIELDS.map((field) => (
          <label key={field.key} className="tone__slider">
            <span className="tone__slider-label">
              {field.label} · {tone[field.key] > 0 ? '+' : ''}
              {Math.round(tone[field.key] * 100)}
            </span>
            <input
              type="range"
              min={-100}
              max={100}
              value={Math.round(tone[field.key] * 100)}
              aria-label={`${field.label} 조절`}
              disabled={busy}
              onChange={(e) => void studio.setTone(activePageId, { [field.key]: Number(e.target.value) / 100 })}
              onPointerUp={settle}
              onKeyUp={settle}
            />
          </label>
        ))}
      </div>

      <button
        type="button"
        className="btn tone__reset"
        disabled={busy || toneIsFlat(tone)}
        onClick={() => {
          void studio
            .setTone(activePageId, { brightness: 0, contrast: 0, saturation: 0, temperature: 0 })
            .then(settle)
        }}
      >
        손대기 전으로
      </button>
    </section>
  )
}
