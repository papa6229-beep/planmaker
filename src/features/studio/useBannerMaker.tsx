/**
 * `배너 뽑기` 한 번 (배너 Patch §5, 자동 배치 제거 Patch).
 *
 * 배너를 **페이지로 만든다.** PNG 한 장을 내놓고 끝내지 않는 이유가 있다 — 배너는
 * 나온 뒤에 손질이 필요하고, 그 손질을 하려면 조각을 끌어 옮기고 키울 수 있어야
 * 한다. 완성본 화면이 이미 그 일을 하고 있고, 그 화면은 **활성 페이지**를 본다.
 * 그러니 배너가 페이지가 되면 편집이 통째로 따라온다.
 *
 * 모델은 부르지 않는다. 제목 조각도 버튼 조각도 상품 사진도 완성본을 만들 때 이미
 * 만들어 두었고, 여기서 하는 일은 다시 놓고 다시 그리는 것뿐이다. 저장해 둔
 * `.eventbrief`를 열어 `완성본 다시 합치기`를 한 뒤에도 똑같이 된다.
 *
 * ## 첫 화면은 배경뿐이다
 *
 * 앞선 판은 조각을 자동으로 꽂아 내보냈다. 실물을 보고 작업자가 말한 것은 —
 * "이벤트 페이지는 자동 배치를 해 주지, 왜냐 크니까. 하지만 배너는 작은 것들이
 * 많아." 그래서 조각은 하나도 올리지 않고, 서랍에서 사람이 꺼내 놓는다.
 *
 * ## 블록 번호를 새로 받는다
 *
 * 이 파일에서 가장 조심한 자리다. 합성 효과·블록별 톤·연결한 제품 이미지가 전부
 * **블록 번호**로 매달려 있다. 배너가 원본과 같은 번호를 쓰면, 배너 조각 하나를
 * 어둡게 눌렀을 뿐인데 **메인 이벤트 페이지의 같은 조각도 함께 어두워진다.**
 * 페이지 복제가 같은 문제를 겪고 새 번호를 받는 길로 풀었으므로 그 길을 따른다.
 *
 * ## 배경은 잘라서 구워 둔다
 *
 * 잔잔한 자리를 골라 계획에 실어 보내는 길도 있었지만, 사람이 조각을 옮긴 뒤
 * 다시 합칠 때 그 경로는 크롭을 모른다 — 손대는 순간 배경이 가운데로 돌아간다.
 * 잘라서 배너 크기의 그림 한 장으로 구워 두면 그 뒤로는 그냥 배경 한 장이다.
 */

import { useCallback, useState } from 'react'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'
import { useImageGeneration } from './useImageGeneration'
import { buildBanner } from '../../domain/bannerComposite'
import { bannerPageId, sourcePageIdOf } from '../../domain/bannerFit'
import { bannerSpecById, type BannerSpec } from '../../domain/bannerSpec'
import type { EdgeSide } from '../../domain/edgeColor'
import { getAsset, putAsset } from '../../services/assetStore'
import { cropBackground, pickQuietRegion, readEdgeColors } from '../../services/bannerPixels'
import { collectCompositeSources } from '../../services/compositeSources'
import { renderComposite } from '../../services/compositeRenderer'
import { createId } from '../../domain/factory'

export interface BannerResult {
  spec: BannerSpec
  /** 만들어진 배너 페이지. 화면은 이 페이지로 넘어간다. */
  pageId: string
  blob: Blob
  /** 끝단 색 — 얇은 띠 배너가 놓이는 자리의 배경색을 여기 맞춘다. */
  edges: { side: EdgeSide; hex: string }[]
  /** 잔잔한 자리를 못 골라 배경을 그대로 썼는가. */
  centerFallback: boolean
}

export type BannerState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; result: BannerResult }
  | { kind: 'failed'; message: string }

export interface BannerMakerApi {
  state: BannerState
  /** 지금 보고 있는 페이지가 배너인가. 배너면 그 규격 번호. */
  viewingSpecId: string | null
  make: (specId: string) => void
  dismiss: () => void
}

const SIDE_LABEL: Record<EdgeSide, string> = { left: '왼쪽 끝', right: '오른쪽 끝', top: '위쪽 끝', bottom: '아래쪽 끝' }

export function sideLabel(side: EdgeSide): string {
  return SIDE_LABEL[side]
}

export function useBannerMaker(): BannerMakerApi | null {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { pages, activePageId, putBannerPage } = useBriefDocument()
  const [state, setState] = useState<BannerState>({ kind: 'idle' })

  const viewingSpecId = studio?.bannerSpecOf(activePageId) ?? null

  const make = useCallback(
    (specId: string) => {
      if (studio === null) return
      const spec = bannerSpecById(specId)
      // 배너를 보고 있을 때 다시 뽑으면 **그 배너의 원본**에서 뽑는다.
      const viewing = studio.bannerSpecOf(activePageId)
      const sourceId = viewing === null ? activePageId : sourcePageIdOf(activePageId, viewing)
      const source = pages.find((p) => p.id === sourceId)
      if (spec === null || source === undefined) {
        setState({ kind: 'failed', message: '배너를 만들 페이지를 찾지 못했습니다.' })
        return
      }
      setState({ kind: 'working' })

      void (async () => {
        try {
          const job = studio.currentJob()
          const pageId = bannerPageId(source.id, spec.id)

          // 배경에서 잔잔한 자리를 골라 배너 크기로 구워 둔다.
          let backgroundAssetId: string | undefined
          let centerFallback = true
          const background = studio.backgroundOf(source.id)
          if (background !== undefined) {
            backgroundAssetId = background.assetId
            const asset = await getAsset(background.assetId)
            if (asset !== undefined) {
              // 자리를 지정하지 않는다 — 어디에 무엇을 올릴지는 사람이 정한다.
              // 잔잔한 곳을 고르는 일 자체는 남는다: 디자인 요소가 몰린 자리를
              // 배경으로 쓰면 무엇을 올려도 읽히지 않는다.
              const crop = await pickQuietRegion(asset.blob, spec.width / spec.height, [])
              const baked = crop === null ? null : await cropBackground(asset.blob, crop, spec)
              if (baked !== null) {
                backgroundAssetId = createId('asset')
                await putAsset({
                  id: backgroundAssetId,
                  blob: baked,
                  fileName: `${spec.id}-background.png`,
                  mimeType: 'image/png',
                  byteSize: baked.size,
                })
                centerFallback = false
              }
            }
          }

          const built = buildBanner(source, spec, {
            ...(backgroundAssetId === undefined ? {} : { background: { assetId: backgroundAssetId, source: 'ai' } }),
            grain: job.grain,
            tone: studio.toneOf(source.id),
          })

          const sources = await collectCompositeSources(built.plan)
          const blob = await renderComposite(built.plan, sources)
          const resultAssetId = createId('asset')
          await putAsset({
            id: resultAssetId,
            blob,
            fileName: `${spec.id}.png`,
            mimeType: 'image/png',
            byteSize: blob.size,
          })
          const edges = await readEdgeColors(blob, spec.edgeReport)

          // 작업에 심는다. 이 다음부터는 완성본 화면이 알아서 한다.
          //
          // **빈 목록을 적는다.** 없는 목록과 빈 목록은 다르다 — 없으면 다시 합칠
          // 때 기획서 블록에서 다시 세어 전부 그려 버린다.
          await studio.setTextObjects(pageId, [])
          await studio.setImageObjects(pageId, [])
          if (backgroundAssetId !== undefined) {
            await studio.setBackground(pageId, { assetId: backgroundAssetId, source: 'ai' })
          }
          await studio.recordResult({
            pageId,
            assetId: resultAssetId,
            model: 'gpt-image-2',
            quality: 'medium',
            requestedSize: `${String(spec.width)}x${String(spec.height)}`,
            sourceFingerprint: 'banner',
            createdAt: Date.now(),
          })
          await studio.markBannerPage(pageId, spec.id)
          // **페이지는 맨 뒤에 붙인다.** 작업에 쓰는 모든 길이 그때 손에 있던 문서를
          // 함께 실어 보내므로, 페이지를 먼저 붙이면 뒤따르는 쓰기가 그것을 지운다 —
          // 실제로 지웠다. 문서를 건드리는 일은 한 번, 그리고 마지막에.
          putBannerPage(built.page)
          // 배너를 뽑으면 그 배너를 본다. 가운데가 기획서를 가리키고 있으면 방금
          // 만든 것이 어디 있는지 알 수 없다.
          generation?.setView('compare')

          setState({ kind: 'done', result: { spec, pageId, blob, edges, centerFallback } })
        } catch {
          // 공급자 오류도 내부 경로도 여기 없다 — 이 길에는 외부가 없다.
          setState({ kind: 'failed', message: '배너를 만들지 못했습니다. 완성본을 먼저 만들어 주세요.' })
        }
      })()
    },
    [studio, generation, pages, activePageId, putBannerPage],
  )

  const dismiss = useCallback(() => setState({ kind: 'idle' }), [])

  if (studio === null) return null
  return { state, viewingSpecId, make, dismiss }
}
