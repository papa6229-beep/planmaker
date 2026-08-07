/**
 * 고른 이미지 블록의 맞춤 방식 (배경 합성 1차 §3.1; 긴급 Patch §2).
 *
 * 레이어 순서는 여기 없다. 예전에는 있었고, 그것이 불편의 원인이었다 — 캔버스
 * 왼쪽에서 고른 블록의 순서를 바꾸려고 화면 오른쪽 끝까지 눈과 손을 옮겨야
 * 했다. 순서는 이제 블록 자신의 도구막대에서 바꾼다. 같은 조작을 두 군데 두면
 * 어느 쪽이 진짜인지 매번 헷갈리므로, 여기서는 지웠다.
 *
 * 맞춤 방식은 이미지에만 있는 선택이므로, 이미지 블록이 아니면 이 칸 자체가
 * 나타나지 않는다.
 */

import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import { IMAGE_FIT_OPTIONS, imageFitOf } from '../../domain/imageLayout'
import { PanelFold } from './PanelFold'

export function BlockLayerTools() {
  const { selected, setImageFit } = useBriefEditor()
  if (selected === null || !getBlockTypeMeta(selected.type).requiresAsset) return null

  const fit = imageFitOf(selected)

  return (
    <PanelFold id="block-tools" title={`${selected.label} 배치`} note="이미지 맞춤" defaultOpen>
    <section className="block-tools" aria-label="블록 배치">

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

      {/* 순서를 바꾸는 자리는 블록 위다. 여기서 그것을 되풀이하지 않는다. */}
      <p className="block-tools__note">레이어 순서는 블록을 고르면 나타나는 `레이어` 메뉴에서 바꿉니다.</p>
    </section>
    </PanelFold>
  )
}
