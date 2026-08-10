/**
 * 지금 만든 것들의 목록 (배너 Patch §5, 작업 목록 Patch).
 *
 * 이 줄이 곧 **작업 목록**이다. 이벤트 페이지 하나와 뽑아 둔 배너들이 여기 서고,
 * 누르면 그 작업창이 열린다. 저장하면 여기 있는 것이 파일로 나간다.
 *
 * ## 배너는 페이지 탭에 없다
 *
 * 작성자에게 페이지 탭은 "이벤트 페이지가 몇 장인가"를 뜻하는 자리이고, 이벤트
 * 페이지가 두 장인 경우는 없다고 확인받았다. 거기에 배너 다섯이 끼면 그 탭의 뜻이
 * 흐려진다. 그래서 배너는 여기 따로 선다.
 *
 * ## 이벤트 페이지와 배너를 눈으로 가른다
 *
 * 앞선 판은 `이미지` 한 이름 아래 `1페이지 · 840×640 · 500×387`을 나란히 세웠다.
 * 작업자의 말 — "뭔가 구분감이 좀 약하지?" 맞다. 셋은 같은 종류가 아니다: 하나는
 * 원본이고 둘은 그 원본에서 뽑은 것이다. 그래서 두 무리로 나누고 각각 이름을 붙인다.
 *
 * ## 저장 버튼이 여기 있다
 *
 * "결국 저기가 작업 리스트라면 이미지 저장 버튼은 여기에 있어야 하지 않을까?"
 * 그렇다. `이미지 저장`이 내놓는 것은 **지금 고른 것 하나**이므로, 고르는 자리
 * 옆에 있는 것이 맞다. 상단 바에서는 뺐다 — 한 가지 일에 들어가는 문은 하나면
 * 충분하다.
 *
 * 반대로 `작업 파일 저장`은 상단 바에 남겼다. 그쪽이 내놓는 것은 목록의 한 줄이
 * 아니라 **작업 전부**(모든 페이지·배너·조각·배경)라, 한 줄을 고르는 자리에 두면
 * 고른 것 하나가 저장되는 것처럼 읽힌다.
 *
 * 어느 것을 누르든 가운데 화면은 곧장 **완성본**을 연다 — 눌러 놓고 기획서가
 * 나오면, 방금 누른 것이 안 눌린 것처럼 보인다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { useImageSave } from '../../features/studio/useImageSave'
import { pageResultOf } from '../../domain/studioJob'
import { sourcePageIdOf } from '../../domain/bannerFit'
import { bannerSpecById } from '../../domain/bannerSpec'

export function WorkList() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const imageSave = useImageSave()
  const { pages, activePageId, switchPage } = useBriefDocument()
  if (studio === null) return null

  const banners = studio.bannerPageIds.filter((pageId) => pages.some((p) => p.id === pageId))
  // 만든 것이 하나도 없으면 목록도 없다. 빈 줄은 자리만 먹는다.
  const events = pages.filter(
    (page) => studio.bannerSpecOf(page.id) === null && pageResultOf(studio.job, page.id) !== undefined,
  )
  if (events.length === 0 && banners.length === 0) return null

  const go = (pageId: string) => {
    switchPage(pageId)
    // 이미지를 만든 뒤로는 볼 것이 완성본이다. 기획서는 다시 만들 때 찾는다.
    generation?.setView('compare')
  }

  const chip = (pageId: string, label: string, extra = '') => (
    <button
      key={pageId}
      type="button"
      className={`work-list__item${extra}${activePageId === pageId ? ' is-active' : ''}`}
      aria-pressed={activePageId === pageId}
      onClick={() => go(pageId)}
    >
      {label}
    </button>
  )

  const saving = imageSave?.state.kind === 'saving'
  const active = pages.find((p) => p.id === activePageId)
  const activeIsBanner = studio.bannerSpecOf(activePageId) !== null
  const savable = active !== undefined && pageResultOf(studio.job, activePageId) !== undefined

  return (
    <div className="work-list" role="group" aria-label="작업 목록">
      {events.length > 0 && (
        <span className="work-list__group">
          <span className="work-list__label">이벤트 페이지</span>
          {events.map((page) => chip(page.id, page.title, ' work-list__item--event'))}
        </span>
      )}
      {banners.length > 0 && (
        <span className="work-list__group">
          <span className="work-list__label">배너</span>
          {banners.map((pageId) => {
            const specId = studio.bannerSpecOf(pageId) ?? ''
            const spec = bannerSpecById(specId)
            const from = sourcePageIdOf(pageId, specId)
            const source = pages.find((p) => p.id === from)?.title
            return (
              <button
                key={pageId}
                type="button"
                className={`work-list__item${activePageId === pageId ? ' is-active' : ''}`}
                aria-pressed={activePageId === pageId}
                title={source === undefined ? undefined : `${source}에서 뽑은 배너`}
                onClick={() => go(pageId)}
              >
                {spec === null ? specId : `${String(spec.width)}×${String(spec.height)}`}
              </button>
            )
          })}
        </span>
      )}
      {imageSave !== null && savable && (
        <button
          type="button"
          className="btn work-list__save"
          disabled={saving}
          onClick={imageSave.save}
          title={
            activeIsBanner
              ? '보고 있는 배너 한 장을 PNG로 저장합니다'
              : '이벤트 페이지 완성본을 PNG로 저장합니다 — 배너는 함께 나가지 않습니다'
          }
        >
          {saving ? '저장 중…' : '이 이미지 저장'}
        </button>
      )}
      {/* 그리고 한 번에 전부 (전체 저장 Patch). 작업이 끝나면 이벤트 페이지 한 장과
          배너 대여섯 장을 한꺼번에 넘긴다 — 하나씩 눌러 내려받고 폴더에서 다시
          모으는 일은 그 자체로 실수가 난다. 한 장뿐이면 둘 버튼이 같은 일을 하므로
          내놓지 않는다. */}
      {imageSave !== null && imageSave.allCount > 1 && (
        <button
          type="button"
          className="btn btn--primary work-list__save-all"
          disabled={saving}
          onClick={imageSave.saveAll}
          title="이벤트 페이지와 배너를 한 묶음(ZIP)으로 저장합니다"
        >
          전부 저장 {imageSave.allCount}장
        </button>
      )}
      {/* 저장이 사람에게 물어야 하는 자리들. 버튼과 **같은 컴포넌트**에 있어야
          한다 — `useImageSave`는 부르는 곳마다 제 상태를 따로 갖는 훅이라, 버튼과
          창이 떨어져 있으면 눌러도 아무 창이 뜨지 않는다. */}
      {imageSave !== null && (
        <>
      {/* 이미지 저장이 사람에게 물어야 하는 두 자리. 저장 자체는 이미 손에 있는
              자산을 내놓는 일이라 외부 호출이 없다 (실작업 UI 마감 §5). */}
          {imageSave.state.kind === 'nothing' && (
            <div className="confirm-backdrop" role="presentation" onClick={imageSave.dismiss}>
              <div
                className="confirm"
                role="alertdialog"
                aria-modal="true"
                aria-label="저장할 이미지 없음"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="confirm__title">아직 저장할 이미지가 없습니다</h2>
                <p className="confirm__body">
                  먼저 <b>이미지 생성하기</b>로 결과를 만들어 주세요. 기획서 캔버스는 이미지로 저장하지 않습니다.
                </p>
                <div className="confirm__actions">
                  <button type="button" className="btn btn--primary" onClick={imageSave.dismiss}>확인</button>
                </div>
              </div>
            </div>
          )}
          {imageSave.state.kind === 'partial' && (
            <div className="confirm-backdrop" role="presentation" onClick={imageSave.dismiss}>
              <div
                className="confirm"
                role="dialog"
                aria-modal="true"
                aria-label="일부 페이지만 저장"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="confirm__title">
                  {imageSave.state.plan.totalPages}페이지 중 생성 결과가 있는 {imageSave.state.plan.files.length}페이지만
                  저장합니다
                </h2>
                <p className="confirm__body">
                  아직 만들지 않은 페이지는 빈 이미지로도, 기획서 캔버스로도 저장하지 않습니다.
                </p>
                <div className="confirm__actions">
                  <button type="button" className="btn" onClick={imageSave.dismiss}>취소</button>
                  <button type="button" className="btn btn--primary" onClick={imageSave.confirmPartial}>
                    생성된 {imageSave.state.plan.files.length}장 저장
                  </button>
                </div>
              </div>
            </div>
          )}
          {imageSave.state.kind === 'failed' && (
            <div className="confirm-backdrop" role="presentation" onClick={imageSave.dismiss}>
              <div
                className="confirm"
                role="alertdialog"
                aria-modal="true"
                aria-label="이미지 저장 실패"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="confirm__title">이미지를 저장하지 못했습니다</h2>
                <p className="confirm__body">{imageSave.state.message}</p>
                <div className="confirm__actions">
                  <button type="button" className="btn btn--primary" onClick={imageSave.dismiss}>확인</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
