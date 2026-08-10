/**
 * 배너 한 장의 첫 화면 — 배경만 (배너 Patch §3, 자동 배치 제거 Patch).
 *
 * 배너는 새로 그리는 것이 아니라 **다시 놓는 것**이다. 그래서 모델을 한 번도
 * 부르지 않는다 — 제목 조각도 버튼 조각도 상품 사진도 완성본을 만들 때 이미
 * 만들어 두었고, 저장 파일에 그대로 들어 있다.
 *
 * 저장 파일이 무엇을 담고 있는지가 이 모듈이 성립하는 근거다. `.eventbrief` 에는
 * 합쳐진 완성본 그림이 **들어 있지 않다.** 대신 배경·블록별 문구 조각·이미지
 * 조각·제품 이미지·효과·톤이 들어 있고, `완성본 다시 합치기`가 그것들로 다시
 * 그린다. 배너도 같은 조각을 다른 자리에 놓는 일이므로, 파일 하나만 있으면
 * 크레딧 없이 몇 번이든 다시 뽑을 수 있다.
 *
 * ## 첫 화면에는 조각이 없다
 *
 * 앞선 판은 여기서 조각을 자리에 꽂아 내보냈다. 지금은 **배경 한 장만** 깐다.
 * 무엇을 올릴지는 서랍에서 사람이 고른다 — 배너는 작아서, 자동이 놓은 자리를
 * 고치는 것이 처음부터 놓는 것보다 오래 걸린다.
 *
 * 순수 모듈이다. 캔버스도 저장소도 모른다.
 */

import { blankBannerPage } from './bannerFit'
import type { BannerSpec } from './bannerSpec'
import { planLocalComposite, type CompositePlan } from './composite'
import type { BriefPage } from './pageSchema'
import type { StudioBackground } from './studioJob'
import type { ToneAdjust } from './toneAdjust'

/** 완성본이 남긴 것 중 배너의 첫 화면이 쓰는 것. */
export interface BannerPieces {
  background?: StudioBackground | undefined
  grain?: number | undefined
  tone?: ToneAdjust | undefined
}

export interface BannerBuild {
  /** 배너 규격의 기획서 페이지. 편집기가 그대로 열 수 있다. */
  page: BriefPage
  plan: CompositePlan
}

export function buildBanner(source: BriefPage, spec: BannerSpec, pieces: BannerPieces): BannerBuild {
  const page = blankBannerPage(source, spec)

  const plan = planLocalComposite({
    page,
    background: pieces.background,
    textObjects: [],
    productImages: {},
    effects: {},
    // 블록은 전부 데려왔지만 **아무것도 올리지 않는다.** 빈 목록이 그 뜻이다 —
    // 이것을 빼면 페이지의 블록이 전부 그려져 첫 화면이 이벤트 페이지가 된다.
    onlyBlockIds: [],
    ...(pieces.grain === undefined ? {} : { grain: pieces.grain }),
    ...(pieces.tone === undefined ? {} : { tone: pieces.tone }),
    // 글자는 조각이 그린다. 여기서 또 그리면 같은 문구가 두 번 나온다.
    includeTexts: false,
  })

  return { page, plan }
}
