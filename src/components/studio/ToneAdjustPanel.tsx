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

  return (
    <PanelFold id="tone" title="결과 톤 조절" note="밝기 · 대비 · 채도 · 색온도" marked={!toneIsFlat(tone)}>
    <section className="tone" aria-label="결과 톤 조절">
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
              // 슬라이더 한 번 끄는 것이 되돌리기 한 칸이다 (결과 되돌리기 Patch).
              onPointerDown={() => studio.markStep()}
              onKeyDown={() => studio.markStep()}
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
          studio.markStep()
          void studio
            .setTone(activePageId, { brightness: 0, contrast: 0, saturation: 0, temperature: 0 })
            .then(settle)
        }}
      >
        손대기 전으로
      </button>

      <ObjectTone settle={settle} busy={busy} />
    </section>
    </PanelFold>
  )
}

/**
 * 고른 오브젝트 하나에만 거는 톤 (블록별 톤 Patch).
 *
 * 위의 전체 톤과 **따로** 산다. 사진 하나만 어둡게 깔고 페이지 전체를 밝히는 일은
 * 한 벌의 값으로는 되지 않는다. 그리는 차례도 그대로다 — 이 값이 먼저 걸리고,
 * 다 그린 뒤에 전체 톤이 한 번 더 걸린다.
 *
 * 오브젝트를 고르지 않았으면 나오지 않는다. 무엇에 걸리는지 화면이 말하지 못하는
 * 슬라이더는 두지 않는다.
 */
function ObjectTone({ settle, busy }: { settle: () => void; busy: boolean }) {
  const studio = useStudioJob()
  const { pages, activePageId } = useBriefDocument()
  const blockId = studio?.selectedObjectBlockId ?? null
  if (studio === null || blockId === null) return null

  const label =
    pages.find((p) => p.id === activePageId)?.blocks.find((b) => b.id === blockId)?.label ?? '고른 오브젝트'
  const tone = studio.objectToneOf(blockId)

  return (
    <div className="tone__object">
      <p className="tone__object-title">고른 것만 · {label}</p>
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
              aria-label={`${label} ${field.label} 조절`}
              disabled={busy}
              onPointerDown={() => studio.markStep()}
              onKeyDown={() => studio.markStep()}
              onChange={(e) =>
                void studio.setObjectTone(blockId, { [field.key]: Number(e.target.value) / 100 })
              }
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
          studio.markStep()
          void studio
            .setObjectTone(blockId, { brightness: 0, contrast: 0, saturation: 0, temperature: 0 })
            .then(settle)
        }}
      >
        이것만 손대기 전으로
      </button>
    </div>
  )
}
