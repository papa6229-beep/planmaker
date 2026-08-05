/**
 * 고른 블록 하나에 대한 배치 도구 (배경 합성 1차 §3.1, §4, §11).
 *
 * 캔버스 카드 위에 버튼을 여섯 개 더 얹지 않는다. 카드는 이미 좁고, 거기서
 * 늘어난 버튼은 작업자가 그림을 보는 자리를 먹는다. 대신 오른쪽에 "지금 고른
 * 블록으로 무엇을 할 수 있는가"만 말하는 작은 칸을 둔다.
 *
 * 고른 것이 없으면 아무것도 그리지 않는다 — 누를 수 없는 버튼을 켜 두는 것보다
 * 없는 편이 화면이 조용하다.
 */

import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import { IMAGE_FIT_OPTIONS, imageFitOf } from '../../domain/imageLayout'
import { LAYER_MOVES } from '../../domain/layerOrder'

export function BlockLayerTools() {
  const { selected, setImageFit, reorderBlock } = useBriefEditor()
  if (selected === null) return null

  const meta = getBlockTypeMeta(selected.type)
  const fit = imageFitOf(selected)

  return (
    <section className="block-tools" aria-label="블록 배치">
      <h2 className="block-tools__title">{selected.label}</h2>

      {meta.requiresAsset && (
        <div className="block-tools__group">
          <span className="block-tools__label" id="block-tools-fit">
            이미지 맞춤
          </span>
          <div className="block-tools__row" role="group" aria-labelledby="block-tools-fit">
            {IMAGE_FIT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`block-tools__btn${fit === option.value ? ' is-active' : ''}`}
                aria-pressed={fit === option.value}
                onClick={() => setImageFit(selected.id, option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="block-tools__group">
        <span className="block-tools__label" id="block-tools-layer">
          레이어 순서
        </span>
        <div className="block-tools__row block-tools__row--wrap" role="group" aria-labelledby="block-tools-layer">
          {LAYER_MOVES.map((move) => (
            <button
              key={move.value}
              type="button"
              className="block-tools__btn"
              onClick={() => reorderBlock(selected.id, move.value)}
            >
              {move.label}
            </button>
          ))}
        </div>
        {/* 배경은 블록이 아니므로 이 순서에 끼지 않는다. 언제나 맨 뒤다. */}
        <p className="block-tools__note">배경 레이어는 항상 맨 뒤에 있습니다.</p>
      </div>
    </section>
  )
}
