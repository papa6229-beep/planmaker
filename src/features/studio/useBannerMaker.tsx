/**
 * `배너 뽑기` 한 번 (배너 Patch §4).
 *
 * 완성본이 있는 페이지에서 규격 하나를 골라 배너 한 장을 만든다. **모델을 부르지
 * 않는다** — 제목 조각도 버튼 조각도 상품 사진도 완성본을 만들 때 이미 만들어
 * 두었고, 여기서 하는 일은 그것들을 다른 자리에 놓고 다시 그리는 것뿐이다.
 *
 * 그래서 저장해 둔 `.eventbrief` 를 열어 `완성본 다시 합치기` 를 한 뒤 이 버튼을
 * 누르면, 크레딧 없이 몇 번이든 다시 뽑을 수 있다.
 *
 * ## 무엇을 알리는가
 *
 * 배너는 **버리는 일**이다. 열다섯 장을 읽어 보면 사람도 그렇게 만든다 — 얇은 띠에
 * 다 넣으려 하지 않고, 제목과 제품을 넣고 남는 자리에 몇 개를 우겨넣고 나머지는
 * 포기한다.
 *
 * 그러므로 무엇을 버렸는지 말하지 않는 배너 생성기는 쓸 수 없다. 넷을 구분해서
 * 알린다.
 *
 *  - **포기했다** — 자리가 없어 뺐다. 기간, 로고. 대개 괜찮다.
 *  - **배경으로 내렸다** — 모양이 안 맞아 뒤에 깔았다.
 *  - **자리를 못 얻었다** — 제목이나 CTA인데 자리가 없다. **사람이 봐야 한다.**
 *  - **조각이 없다** — 완성본에 그 블록의 그림이 없다. 대개 문구 조각이 생기기
 *    전에 저장한 파일이다.
 *
 * 결과가 없으면 이 훅은 아무것도 하지 않는다. 만든 적 없는 완성본에서 배너를
 * 지어낼 수는 없다.
 */

import { useCallback, useState } from 'react'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'
import { buildBanner, readableSlots } from '../../domain/bannerComposite'
import { bannerSpecById, type BannerSpec } from '../../domain/bannerSpec'
import type { EdgeSide } from '../../domain/edgeColor'
import { getAsset } from '../../services/assetStore'
import { pickQuietRegion, readEdgeColors } from '../../services/bannerPixels'
import { collectCompositeSources } from '../../services/compositeSources'
import { renderComposite } from '../../services/compositeRenderer'
import { downloadBlob, safeFileStem } from '../../services/downloadFile'

/** 무엇이 어떻게 되었는지 한 줄. 화면이 그대로 읽는다. */
export interface BannerNote {
  kind: 'dropped' | 'background' | 'unplaced' | 'missing'
  label: string
}

export interface BannerResult {
  spec: BannerSpec
  /** 미리보기용 주소. 다음 배너를 만들 때 거둔다. */
  url: string
  blob: Blob
  notes: BannerNote[]
  /** 끝단 색 — 얇은 띠 배너가 놓이는 자리의 배경색을 여기 맞춘다. */
  edges: { side: EdgeSide; hex: string }[]
  /** 잔잔한 자리를 못 골라 가운데를 썼는가. */
  centerFallback: boolean
}

export type BannerState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; result: BannerResult }
  | { kind: 'failed'; message: string }

export interface BannerMakerApi {
  state: BannerState
  make: (specId: string) => void
  save: () => void
  dismiss: () => void
}

const SIDE_LABEL: Record<EdgeSide, string> = { left: '왼쪽 끝', right: '오른쪽 끝', top: '위쪽 끝', bottom: '아래쪽 끝' }

export function sideLabel(side: EdgeSide): string {
  return SIDE_LABEL[side]
}

export function useBannerMaker(): BannerMakerApi | null {
  const studio = useStudioJob()
  const { pages, activePageId, getDocument } = useBriefDocument()
  const [state, setState] = useState<BannerState>({ kind: 'idle' })

  const make = useCallback(
    (specId: string) => {
      if (studio === null) return
      const spec = bannerSpecById(specId)
      const source = pages.find((p) => p.id === activePageId)
      if (spec === null || source === undefined) {
        setState({ kind: 'failed', message: '배너를 만들 페이지를 찾지 못했습니다.' })
        return
      }

      setState((previous) => {
        if (previous.kind === 'done') URL.revokeObjectURL(previous.result.url)
        return { kind: 'working' }
      })

      void (async () => {
        try {
          const job = studio.currentJob()
          const background = studio.backgroundOf(activePageId)

          // 배경에서 **글자 밑이 잔잔한** 자리를 고른다. 못 고르면 지금까지처럼
          // 가운데를 쓴다 — 배너를 못 뽑을 이유는 아니다.
          let crop = null
          if (background !== undefined) {
            const asset = await getAsset(background.assetId)
            if (asset !== undefined) {
              crop = await pickQuietRegion(asset.blob, spec.width / spec.height, readableSlots(spec))
            }
          }

          const built = buildBanner(
            source,
            spec,
            {
              background,
              textObjects: studio.textObjectsOf(activePageId),
              imageObjects: studio.imageObjectsOf(activePageId),
              productImages: job.productImages,
              effects: job.effects ?? {},
              objectTones: job.objectTones,
              grain: job.grain,
              tone: studio.toneOf(activePageId),
            },
            { backgroundCrop: crop ?? undefined },
          )

          const sources = await collectCompositeSources(built.plan)
          const blob = await renderComposite(built.plan, sources)
          const edges = await readEdgeColors(blob, spec.edgeReport)

          const labelOf = (blockId: string): string =>
            source.blocks.find((b) => b.id === blockId)?.label ?? blockId
          const notes: BannerNote[] = [
            ...built.fit.unplaced.map((id) => ({ kind: 'unplaced' as const, label: labelOf(id) })),
            ...built.missingPieces.map((id) => ({ kind: 'missing' as const, label: labelOf(id) })),
            ...built.fit.background.map((id) => ({ kind: 'background' as const, label: labelOf(id) })),
            ...built.fit.dropped
              .filter((d) => d.reason === 'no-slot')
              .map((d) => ({ kind: 'dropped' as const, label: labelOf(d.blockId) })),
          ]

          setState({
            kind: 'done',
            result: {
              spec,
              url: URL.createObjectURL(blob),
              blob,
              notes,
              edges,
              centerFallback: crop === null,
            },
          })
        } catch {
          // 공급자 오류도 내부 경로도 여기 없다 — 이 길에는 외부가 없다.
          setState({ kind: 'failed', message: '배너를 만들지 못했습니다. 완성본을 먼저 만들어 주세요.' })
        }
      })()
    },
    [studio, pages, activePageId],
  )

  const save = useCallback(() => {
    setState((current) => {
      if (current.kind !== 'done') return current
      const { spec, blob } = current.result
      const stem = safeFileStem(getDocument().project.title, '배너')
      downloadBlob(blob, `${stem}-${String(spec.width)}x${String(spec.height)}.png`)
      return current
    })
  }, [getDocument])

  const dismiss = useCallback(() => {
    setState((current) => {
      if (current.kind === 'done') URL.revokeObjectURL(current.result.url)
      return { kind: 'idle' }
    })
  }, [])

  if (studio === null) return null
  return { state, make, save, dismiss }
}
