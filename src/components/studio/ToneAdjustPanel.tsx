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
 *
 * **페이지 전체만** 다룬다 (후보정 창 Patch, 2026-09-17). 조각 하나의 색·그림자·
 * 테두리는 완성본에서 그 조각을 누르고 "후보정"으로 연다 — 전에는 여기 아래에
 * "고른 것만"으로 쌓여 있어 멀고 길었다. 결과 전체에 얹는 그레인은 이리 옮겼다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { RESET_TONE, TONE_FIELDS, toneIsFlat } from '../../domain/toneAdjust'
import { pageResultOf } from '../../domain/studioJob'
import { ToneCurvePanel } from './ToneCurvePanel'
import { PanelFold } from './PanelFold'

export function ToneAdjustPanel() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { activePageId } = useBriefDocument()
  if (studio === null || generation === null || !generation.hasResult) return null

  const tone = studio.toneOf(activePageId)
  const busy = generation.state.kind === 'running'
  /** 손을 뗀 뒤 한 번 다시 합친다. 끄는 동안 매번 합치면 화면이 버벅인다. */
  const settle = () => void generation.recomposePage(activePageId)
  /** 끄는 동안의 미리보기 — 저장하지 않는다. */
  const preview = () => generation.previewPage(activePageId)

  return (
    <PanelFold id="tone" title="결과 톤 조절" note="페이지 전체 · 밝기 · 대비 · 채도 · 색온도 · 레벨 · 커브 · 그레인" marked={!toneIsFlat(tone)}>
    <section className="tone" aria-label="결과 톤 조절">
      <p className="tone__note">
        완성 결과 전체에 겁니다. 조각 하나는 완성본에서 그 조각을 누르고 “후보정”을 여세요.
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
              // 슬라이더 한 번 끄는 것이 되돌리기 한 칸이다 (결과 되돌리기 Patch).
              onPointerDown={() => studio.markStep()}
              onKeyDown={() => studio.markStep()}
              onChange={(e) =>
                void studio.setTone(activePageId, { [field.key]: Number(e.target.value) / 100 }).then(preview)
              }
              onPointerUp={settle}
              onKeyUp={settle}
            />
          </label>
        ))}
      </div>

      <details className="tone__fold">
        <summary>레벨 · 커브</summary>
        <ToneCurvePanel
          label="결과 전체"
          curves={tone.curves}
          levels={tone.levels}
          assetId={pageResultOf(studio.job, activePageId)?.assetId}
          busy={busy}
          onChange={(patch) => void studio.setTone(activePageId, patch).then(preview)}
          onStart={() => studio.markStep()}
          onCommit={settle}
        />
      </details>

      {/* 그레인은 제품 하나가 아니라 완성 결과 전체에 얹힌다 (§9.5). 전에는 생성 전
          "합성 효과" 칸에 있었다. */}
      <label className="tone__slider">
        <span className="tone__slider-label">그레인 · {Math.round(studio.grain * 100)}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(studio.grain * 100)}
          aria-label="그레인 세기"
          disabled={busy}
          onPointerDown={() => studio.markStep()}
          onKeyDown={() => studio.markStep()}
          onChange={(e) => void Promise.resolve(studio.setGrain(Number(e.target.value) / 100)).then(preview)}
          onPointerUp={settle}
          onKeyUp={settle}
        />
      </label>

      <button
        type="button"
        className="btn tone__reset"
        disabled={busy || toneIsFlat(tone)}
        onClick={() => {
          studio.markStep()
          void studio.setTone(activePageId, RESET_TONE).then(settle)
        }}
      >
        손대기 전으로
      </button>
    </section>
    </PanelFold>
  )
}
