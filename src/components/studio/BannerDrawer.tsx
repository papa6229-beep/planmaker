/**
 * 이벤트 페이지의 조각을 배너로 꺼내 놓는 서랍 (배너 Patch §6, 서랍 전체 Patch).
 *
 * 배너는 **빈 캔버스**로 시작한다 — 배경만 깔리고 조각은 하나도 없다. 그러니
 * 서랍이 곧 이 화면의 재료 창고다. 여기 없는 것은 배너에 올릴 수 없다.
 *
 * ## 앞선 판이 틀렸던 두 가지
 *
 * 첫째, 서랍에 **자동이 뺀 것만** 들어 있었다. 작업자의 화면에는 문구 두 개와
 * 똑같이 생긴 컷아웃 두 개, 넷뿐이었다 — 나머지는 이미 배너에 올라가 있다는
 * 이유로 서랍에서 빠져 있었던 것이다. 지우고 다시 올릴 방법이 없었다.
 * 지금은 **전부** 늘어놓는다. 이미 올라와 있는 것은 그렇다고 표시할 뿐이고,
 * 다시 누르면 한 벌 더 놓인다(복제).
 *
 * 둘째, 이름이 기획서 블록의 이름표(`이미지`, `문구`)였다. 이미지가 넷이면 넷 다
 * `이미지`라 무엇을 꺼내는지 알 수 없었다. `AI 부분수정` 목록이 쓰는 이름을
 * **그대로** 쓴다 — `문구 1 — 텐가 사고`, `이미지 2`. 두 화면이 같은 것을 같은
 * 이름으로 부른다.
 *
 * 배너 페이지에서만 나온다. 이벤트 페이지에는 조각이 이미 다 놓여 있다.
 */

import { useEffect, useState } from 'react'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { bannerBlockId, sourcePageIdOf } from '../../domain/bannerFit'
import { buildEditTargets, BACKGROUND_TARGET_ID } from '../../domain/editTargets'
import { getAsset } from '../../services/assetStore'
import { PanelFold } from './PanelFold'

/** 조각 하나가 서랍에 서 있는 모습. */
interface Piece {
  /** 원본 페이지에서의 블록 번호. */
  sourceBlockId: string
  /** 배너 안에서 쓸 번호. */
  bannerBlockId: string
  assetId: string
  label: string
  kind: 'text' | 'image'
  /** 원본에서의 크기 — 꺼낼 때 비율을 여기서 가져온다. */
  size: { width: number; height: number }
  /** 이미 배너에 몇 벌 올라와 있는가. */
  placed: number
}

/**
 * 서랍에서 꺼낸 조각이 놓이는 자리 — 배너 한가운데, 원본 비율 그대로.
 *
 * 이미 같은 조각이 올라와 있으면 조금씩 비껴 놓는다. 정확히 겹쳐 놓으면 두 벌이
 * 올라온 것이 화면에서 보이지 않아, 누른 것이 안 먹은 줄 알고 또 누르게 된다.
 */
export function landingRect(
  source: { width: number; height: number },
  canvas: { width: number; height: number },
  nth = 0,
): { x: number; y: number; width: number; height: number } {
  const aspect = source.width / Math.max(1, source.height)
  // 배너 높이의 절반쯤으로 들어온다. 꺼내자마자 화면을 덮으면 다른 것을 가린다.
  let height = Math.max(8, canvas.height * 0.5)
  let width = height * aspect
  if (width > canvas.width * 0.8) {
    width = canvas.width * 0.8
    height = width / Math.max(0.01, aspect)
  }
  const step = Math.min(24, Math.max(4, canvas.height * 0.08)) * nth
  return {
    x: Math.round(Math.max(0, (canvas.width - width) / 2 + step)),
    y: Math.round(Math.max(0, (canvas.height - height) / 2 + step)),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export function BannerDrawer() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { pages, activePageId, document: doc, putBannerPage } = useBriefDocument()
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  const specId = studio?.bannerSpecOf(activePageId) ?? null
  const banner = pages.find((p) => p.id === activePageId)

  // 원본 페이지 — 배너 번호에서 되찾는다. 서랍이 보여 줄 조각은 전부 거기 있다.
  const sourceId = specId === null ? null : sourcePageIdOf(activePageId, specId)
  const source = pages.find((p) => p.id === sourceId)

  const onBanner = [
    ...(studio?.textObjectsOf(activePageId) ?? []),
    ...(studio?.imageObjectsOf(activePageId) ?? []),
  ]

  const pieces: Piece[] =
    specId === null || source === undefined || studio === null
      ? []
      : // 이름은 `AI 부분수정`과 같은 계산에서 나온다. 두 화면이 같은 것을 다른
        // 이름으로 부르면, 무엇을 고치라고 적어 준 것인지 서로 통하지 않는다.
        buildEditTargets(doc, studio.currentJob(), source.id).flatMap((target) => {
          if (target.blockId === undefined || target.targetId === BACKGROUND_TARGET_ID) return []
          const blockId = target.blockId
          const text = studio.textObjectsOf(source.id).find((o) => o.blockId === blockId)
          const image = studio.imageObjectsOf(source.id).find((o) => o.blockId === blockId)
          const assetId = text?.assetId ?? image?.assetId ?? target.productAssetId ?? target.referenceAssetId
          // 그릴 그림이 없는 블록은 꺼내 봐야 빈 상자다. 조용히 안 보여 준다.
          if (assetId === undefined) return []
          const id = bannerBlockId(activePageId, blockId)
          const from = text?.rect ?? image?.rect ?? target.box
          return [
            {
              sourceBlockId: blockId,
              bannerBlockId: id,
              assetId,
              label: target.label,
              kind: text === undefined && target.kind === 'image' ? ('image' as const) : ('text' as const),
              size: { width: from?.width ?? 1, height: from?.height ?? 1 },
              placed: onBanner.filter((o) => o.blockId === id || o.blockId.startsWith(`${id}#`)).length,
            },
          ]
        })

  // 서랍의 그림은 볼 때만 주소를 만들고 떠날 때 거둔다.
  const keys = pieces.map((piece) => piece.assetId).join('|')
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
  const put = (piece: Piece) => {
    // 두 번째 벌부터는 번호 뒤에 차례를 붙인다. 같은 번호를 두 번 쓰면 하나가
    // 다른 하나를 덮어써, 누른 만큼 늘지 않는다.
    const id = piece.placed === 0 ? piece.bannerBlockId : `${piece.bannerBlockId}#${String(piece.placed + 1)}`
    const rect = landingRect(piece.size, canvas, piece.placed)
    const layer = 100 + onBanner.length
    // 조각만 올리는 것이 아니라 **원본 블록의 설정을 함께 옮긴다** — 종이 컷아웃의
    // 두께와 진하기, 톤, 블록 주문. 새 번호로 복사되므로 배너에서 두께를 고쳐도
    // 원본 이벤트 페이지의 같은 그림은 그대로다.
    void studio
      .placePiece(activePageId, piece.sourceBlockId, { blockId: id, assetId: piece.assetId, rect, layer }, piece.kind)
      .then(() => {
        // **이미지 조각은 제 블록이 페이지에 있어야 그려진다** — 합성이
        // `page.blocks`를 훑기 때문이다. 첫 벌은 배너를 뽑을 때 데려온 블록을 쓰고,
        // 두 벌째부터는 새 번호로 한 장 더 만들어 붙인다. 이것을 빼면 복제한
        // 조각이 편집 화면에는 보이는데 합쳐진 그림에는 없다.
        //
        // 작업 쪽을 먼저 적고 문서를 나중에 적는다 — 작업에 쓰는 길은 그때 손에
        // 있던 문서를 함께 실어 보내므로, 순서를 뒤집으면 방금 붙인 블록이 지워진다.
        const origin = banner.blocks.find((b) => b.id === piece.bannerBlockId)
        if (piece.kind === 'image' && origin !== undefined && id !== piece.bannerBlockId) {
          putBannerPage({ ...banner, blocks: [...banner.blocks, { ...origin, id, position: rect }] })
        }
        return generation.recomposePage(activePageId)
      })
  }

  const spare = pieces.filter((piece) => piece.placed === 0).length

  return (
    <PanelFold id="banner-drawer" title="조각 서랍" note={`${String(spare)}/${String(pieces.length)}`}>
      <section className="drawer" aria-label="조각 서랍">
        <p className="drawer__note">
          이벤트 페이지의 조각 전부입니다. 누르면 배너 한가운데에 놓입니다 — 이미 올라온 것을 다시 누르면 한
          벌 더 놓입니다.
        </p>
        {pieces.length === 0 ? (
          <p className="drawer__empty">꺼낼 조각이 없습니다. 완성본을 먼저 만들어 주세요.</p>
        ) : (
          <ul className="drawer__list">
            {pieces.map((piece) => (
              <li key={piece.bannerBlockId}>
                <button
                  type="button"
                  className={`drawer__piece${piece.placed > 0 ? ' is-placed' : ''}`}
                  onClick={() => put(piece)}
                >
                  {thumbs[piece.assetId] === undefined ? (
                    <span className="drawer__thumb drawer__thumb--empty" aria-hidden="true" />
                  ) : (
                    <img className="drawer__thumb" src={thumbs[piece.assetId]} alt="" />
                  )}
                  <span className="drawer__label">{piece.label}</span>
                  {piece.placed > 0 && (
                    <span className="drawer__placed">올림 {piece.placed}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PanelFold>
  )
}
