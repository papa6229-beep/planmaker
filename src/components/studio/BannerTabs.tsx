/**
 * 완성본과 배너 사이를 오가는 줄 (배너 Patch §5, 되돌아가기 Patch).
 *
 * 배너는 페이지로 살지만 **페이지 탭에는 나오지 않는다.** 작성자에게 페이지 탭은
 * "이벤트 페이지가 몇 장인가"를 뜻하는 자리이고, 이벤트 페이지가 두 장인 경우는
 * 없다고 확인받았다. 거기에 배너 다섯이 끼면 그 탭의 뜻이 흐려진다.
 *
 * ## 돌아오는 길이 없었다
 *
 * 앞선 판은 배너로 **가는** 길만 놓았다. 배너를 보다가 이벤트 페이지로 돌아가려면
 * 좌상단 `기획서`를 눌러 합치기 전 화면을 본 다음, 거기서 `1페이지`를 누르고,
 * 다시 `완성본`을 눌러야 했다 — 세 번을 눌러 두 번 엉뚱한 화면을 지나야 제자리로
 * 온다. 작업자의 말이 맞다: 이미지를 만든 뒤에 오갈 곳은 **완성본과 배너 둘뿐**이다.
 *
 * 그래서 이 줄이 그 둘을 다 갖는다. 맨 앞에 이벤트 페이지가 서고 그 뒤로 배너가
 * 선다. 어느 것을 누르든 가운데 화면은 곧장 **완성본**을 연다 — 눌러 놓고 기획서가
 * 나오면, 방금 누른 것이 안 눌린 것처럼 보인다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { sourcePageIdOf } from '../../domain/bannerFit'
import { bannerSpecById } from '../../domain/bannerSpec'

export function BannerTabs() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { pages, activePageId, switchPage } = useBriefDocument()
  if (studio === null) return null

  const made = studio.bannerPageIds.filter((pageId) => pages.some((p) => p.id === pageId))
  if (made.length === 0) return null

  // 배너가 어느 이벤트 페이지에서 나왔는지 — 그 페이지가 돌아갈 자리다.
  const sourceIds: string[] = []
  for (const pageId of made) {
    const specId = studio.bannerSpecOf(pageId)
    const sourceId = specId === null ? null : sourcePageIdOf(pageId, specId)
    if (sourceId === null || sourceIds.includes(sourceId)) continue
    if (pages.some((p) => p.id === sourceId)) sourceIds.push(sourceId)
  }

  const go = (pageId: string) => {
    switchPage(pageId)
    // 이미지를 만든 뒤로는 볼 것이 완성본이다. 기획서는 다시 만들 때 찾는다.
    generation?.setView('compare')
  }

  return (
    <div className="banner-tabs" role="group" aria-label="완성본과 배너">
      <span className="banner-tabs__label">이미지</span>
      {sourceIds.map((pageId) => {
        const title = pages.find((p) => p.id === pageId)?.title ?? '이벤트 페이지'
        return (
          <button
            key={pageId}
            type="button"
            className={`banner-tabs__tab banner-tabs__tab--source${activePageId === pageId ? ' is-active' : ''}`}
            aria-pressed={activePageId === pageId}
            title={`${title} 완성본으로`}
            onClick={() => go(pageId)}
          >
            {title}
          </button>
        )
      })}
      {made.map((pageId) => {
        const specId = studio.bannerSpecOf(pageId) ?? ''
        const spec = bannerSpecById(specId)
        const name = spec === null ? specId : `${spec.width}×${spec.height}`
        return (
          <button
            key={pageId}
            type="button"
            className={`banner-tabs__tab${activePageId === pageId ? ' is-active' : ''}`}
            aria-pressed={activePageId === pageId}
            onClick={() => go(pageId)}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}
