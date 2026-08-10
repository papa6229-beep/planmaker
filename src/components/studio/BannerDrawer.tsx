/**
 * 배너에 없는 조각을 꺼내 놓는 서랍 (배너 Patch §6).
 *
 * 자동 배치는 **버리는 일**이다. 얇은 띠나 가장 작은 사각형에 다 넣을 수는 없으니
 * 제목과 제품을 넣고 나머지는 포기한다. 그것 자체는 맞다.
 *
 * 문제는 앞선 판에서 **뺀 것을 되돌릴 방법이 없었다**는 것이다. 자동이 잘못 뺐어도,
 * 이 배너에는 저것이 꼭 필요해도, 배너 페이지에 아예 없으니 손댈 수가 없었다.
 * 작업자의 말이 정확했다 — "가장 작은 사이즈는 지금처럼 다 때려넣을 수 없을 텐데,
 * 그럼 백지에서 하나하나 놓는 구조냐?"
 *
 * 서랍이 그 물음을 없앤다. 자동은 초안을 깔고, 서랍에는 **완성본의 조각이 전부**
 * 들어 있다. 큰 규격은 손질만 하면 되고, 작은 규격은 거의 빈 캔버스에서 필요한
 * 것만 꺼내 놓으면 된다. 둘 중 하나를 고를 필요가 없어진다.
 *
 * 배너 페이지에서만 나온다. 이벤트 페이지에는 조각이 이미 다 놓여 있다.
 */

import { useEffect, useState } from 'react'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { bannerBlockId, sourcePageIdOf } from '../../domain/bannerFit'
import { getAsset } from '../../services/assetStore'
import { PanelFold } from './PanelFold'

/** 서랍에서 꺼낸 조각이 놓이는 자리 — 배너 한가운데, 원본 비율 그대로. */
function landingRect(
  source: { width: number; height: number },
  canvas: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const aspect = source.width / Math.max(1, source.height)
  // 배너 높이의 절반쯤으로 들어온다. 꺼내자마자 화면을 덮으면 다른 것을 가린다.
  let height = Math.max(8, canvas.height * 0.5)
  let width = height * aspect
  if (width > canvas.width * 0.8) {
    width = canvas.width * 0.8
    height = width / Math.max(0.01, aspect)
  }
  return {
    x: Math.round((canvas.width - width) / 2),
    y: Math.round((canvas.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export function BannerDrawer() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { pages, activePageId } = useBriefDocument()
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  const specId = studio?.bannerSpecOf(activePageId) ?? null
  const banner = pages.find((p) => p.id === activePageId)

  // 원본 페이지 — 배너 번호에서 되찾는다. 서랍이 보여 줄 조각은 전부 거기 있다.
  const sourceId = specId === null ? null : sourcePageIdOf(activePageId, specId)
  const source = pages.find((p) => p.id === sourceId)

  const onBanner = new Set([
    ...(studio?.textObjectsOf(activePageId) ?? []).map((o) => o.blockId),
    ...(studio?.imageObjectsOf(activePageId) ?? []).map((o) => o.blockId),
  ])

  const spare =
    specId === null || source === undefined || studio === null
      ? []
      : source.blocks.flatMap((block) => {
          const id = bannerBlockId(activePageId, block.id)
          if (onBanner.has(id)) return []
          const text = studio.textObjectsOf(source.id).find((o) => o.blockId === block.id)
          const image = studio.imageObjectsOf(source.id).find((o) => o.blockId === block.id)
          const assetId = text?.assetId ?? image?.assetId ?? studio.productImageOf(block.id) ?? block.assetId
          if (assetId === undefined) return []
          const from = text ?? image
          return [
            {
              id,
              assetId,
              label: block.label,
              kind: text === undefined ? ('image' as const) : ('text' as const),
              size: from === undefined ? block.position : from.rect,
            },
          ]
        })

  // 서랍의 그림은 볼 때만 주소를 만들고 떠날 때 거둔다.
  const keys = spare.map((piece) => piece.assetId).join('|')
  useEffect(() => {
    let alive = true
    const made: string[] = []
    void (async () => {
      const next: Record<string, string> = {}
      for (const assetId of new Set(keys.split('|').filter(Boolean))) {
        const asset = await getAsset(assetId)
        if (asset === undefined) continue
        const url = URL.createObjectURL(asset.blob)
        made.push(url)
        next[assetId] = url
      }
      if (alive) setThumbs(next)
      else for (const url of made) URL.revokeObjectURL(url)
    })()
    return () => {
      alive = false
      for (const url of made) URL.revokeObjectURL(url)
    }
  }, [keys])

  if (studio === null || generation === null || specId === null || banner === undefined) return null

  const canvas = { width: banner.canvasWidth, height: banner.canvasHeight }
  const put = (piece: (typeof spare)[number]) => {
    const rect = landingRect(piece.size, canvas)
    const layer = 100 + onBanner.size
    if (piece.kind === 'text') {
      void studio.setTextObjects(activePageId, [
        ...studio.textObjectsOf(activePageId),
        { blockId: piece.id, assetId: piece.assetId, rect, layer },
      ])
    } else {
      void studio.setImageObjects(activePageId, [
        ...studio.imageObjectsOf(activePageId),
        { blockId: piece.id, assetId: piece.assetId, rect, layer },
      ])
    }
    void generation.recomposePage(activePageId)
  }

  return (
    <PanelFold id="banner-drawer" title="조각 서랍" note={`${String(spare.length)}개 남음`}>
      <section className="drawer" aria-label="조각 서랍">
        <p className="drawer__note">
          완성본의 조각 중 이 배너에 없는 것입니다. 누르면 배너 한가운데에 놓입니다 — 자동이 뺀 것도 여기서
          다시 꺼낼 수 있습니다.
        </p>
        {spare.length === 0 ? (
          <p className="drawer__empty">완성본의 조각이 모두 이 배너에 있습니다.</p>
        ) : (
          <ul className="drawer__list">
            {spare.map((piece) => (
              <li key={piece.id}>
                <button type="button" className="drawer__piece" onClick={() => put(piece)}>
                  {thumbs[piece.assetId] === undefined ? (
                    <span className="drawer__thumb drawer__thumb--empty" aria-hidden="true" />
                  ) : (
                    <img className="drawer__thumb" src={thumbs[piece.assetId]} alt="" />
                  )}
                  <span className="drawer__label">{piece.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PanelFold>
  )
}
