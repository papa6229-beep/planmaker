/**
 * 완성한 뒤에 고치는 종이 테두리 (완성 후 컷아웃 Patch).
 *
 * 두께와 진하기는 기획서 단계에도 있다. 그런데 알맞은 두께는 **완성된 배경 위에서**
 * 라야 보인다 — 밝은 배경에서 알맞던 테두리가 어두운 배경 위에서는 도드라진다.
 * 그때마다 기획서로 돌아가 값을 고치고 다시 만들 수는 없다.
 *
 * 다행히 종이 테두리는 AI가 그린 것이 아니다. 합칠 때마다 브라우저가 그리는
 * 것이라, 값만 바꾸고 다시 합치면 그만이다. **외부 호출은 0건이다.**
 *
 * 값을 넣는 자리는 기획서와 같다(`effects`). 두 벌로 나누면 어느 값이 실제로
 * 그려진 값인지 화면이 말해 주지 못한다.
 *
 * 이름과 그림을 함께 보여 준다 (컷아웃 구분 Patch). 앞선 판은 기획서 블록의
 * 이름표를 그대로 썼는데, 이미지 블록은 이름이 전부 `이미지`라 컷아웃이 둘이면
 * 화면에 똑같은 칸이 둘 나왔다 — 어느 슬라이더가 어느 그림의 것인지 알 수 없고,
 * 그러면 "한쪽은 안 먹는다"로 보인다. 그래서 부분수정 목록이 쓰는 번호(`이미지 2`,
 * `이미지 3`)를 그대로 쓰고 그 그림도 함께 건다.
 *
 * 실제로 얹히는 그림이 있는 블록만 나온다. 연결된 그림이 없으면 합성에 그 겹이
 * 아예 없어서, 슬라이더를 움직여도 정말로 아무 일이 일어나지 않는다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { useAssets } from '../../features/assets/useAssets'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import { PAPER_WEIGHT_MAX, PAPER_WEIGHT_MIN } from '../../domain/paperCutout'
import { PanelFold } from './PanelFold'

export function PaperTunePanel() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { pages, activePageId } = useBriefDocument()
  const { getUrl } = useAssets()
  if (studio === null || generation === null || !generation.hasResult) return null

  const page = pages.find((p) => p.id === activePageId)
  const named = new Map(generation.editTargets.map((t) => [t.blockId ?? '', t.label]))
  const cutouts = (page?.blocks ?? [])
    .filter((block) => getBlockTypeMeta(block.type).requiresAsset && studio.effectsOf(block.id).paperCutout)
    .map((block) => ({
      block,
      assetId: studio.productImageOf(block.id) ?? block.assetId,
      label: named.get(block.id) ?? block.label,
    }))
    // 얹히는 그림이 없으면 다듬을 테두리도 없다.
    .filter((item) => item.assetId !== undefined)
  if (cutouts.length === 0) return null

  const busy = generation.state.kind === 'running'
  /** 손을 뗀 뒤 한 번 다시 합친다. 끄는 동안 매번 합치면 화면이 버벅인다. */
  const settle = () => void generation.recomposePage(activePageId)

  return (
    <PanelFold id="paper-tune" title="종이 테두리 다듬기" note={`컷아웃 ${String(cutouts.length)}개`}>
    <section className="paper-tune" aria-label="완성본 종이 테두리">
      <p className="paper-tune__note">
        완성된 배경 위에서 두께와 진하기를 고칩니다. AI를 다시 부르지 않습니다.
      </p>

      {cutouts.map(({ block, assetId, label }) => {
        const effects = studio.effectsOf(block.id)
        const url = getUrl(assetId)
        return (
          <div className="paper-tune__block" key={block.id}>
            <div className="paper-tune__head">
              {url !== undefined && <img className="paper-tune__thumb" src={url} alt="" />}
              <p className="paper-tune__label">{label}</p>
            </div>
            <label className="paper-tune__slider">
              <span className="paper-tune__slider-label">
                두께 · {effects.paperWeight.toFixed(2)}배
              </span>
              <input
                type="range"
                min={Math.round(PAPER_WEIGHT_MIN * 100)}
                max={Math.round(PAPER_WEIGHT_MAX * 100)}
                value={Math.round(effects.paperWeight * 100)}
                aria-label={`${label} 종이 테두리 두께`}
                disabled={busy}
                onPointerDown={() => studio.markStep()}
                onKeyDown={() => studio.markStep()}
                onChange={(e) => void studio.setEffects(block.id, { paperWeight: Number(e.target.value) / 100 })}
                onPointerUp={settle}
                onKeyUp={settle}
              />
            </label>
            <label className="paper-tune__slider">
              <span className="paper-tune__slider-label">
                진하기 · {String(Math.round(effects.paperOpacity * 100))}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(effects.paperOpacity * 100)}
                aria-label={`${label} 종이 테두리 진하기`}
                disabled={busy}
                onPointerDown={() => studio.markStep()}
                onKeyDown={() => studio.markStep()}
                onChange={(e) => void studio.setEffects(block.id, { paperOpacity: Number(e.target.value) / 100 })}
                onPointerUp={settle}
                onKeyUp={settle}
              />
            </label>
          </div>
        )
      })}
    </section>
    </PanelFold>
  )
}
