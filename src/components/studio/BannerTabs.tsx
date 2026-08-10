/**
 * 만들어 둔 배너로 건너가는 줄 (배너 Patch §5).
 *
 * 배너는 페이지로 살지만 **페이지 탭에는 나오지 않는다.** 작성자에게 페이지 탭은
 * "이벤트 페이지가 몇 장인가"를 뜻하는 자리이고, 이벤트 페이지가 두 장인 경우는
 * 없다고 확인받았다. 거기에 배너 다섯이 끼면 그 탭의 뜻이 흐려진다.
 *
 * 그래서 배너는 따로 선다. 누르면 그 배너 페이지로 넘어가고, 가운데 화면이 완성본과
 * 똑같이 그것을 연다 — 확대해서 보고, 끌어 옮기고, 크기를 바꾼다.
 *
 * 만든 배너가 없으면 이 줄도 없다. 빈 줄은 자리만 먹는다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { bannerSpecById } from '../../domain/bannerSpec'

export function BannerTabs() {
  const studio = useStudioJob()
  const { pages, activePageId, switchPage } = useBriefDocument()
  if (studio === null) return null

  const made = studio.bannerPageIds.filter((pageId) => pages.some((p) => p.id === pageId))
  if (made.length === 0) return null

  return (
    <div className="banner-tabs" role="group" aria-label="만든 배너">
      <span className="banner-tabs__label">배너</span>
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
            onClick={() => switchPage(pageId)}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}
