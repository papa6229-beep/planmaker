/**
 * 만든 이미지를 내보낼 때의 이름과 목록 (실작업 UI 마감 §5).
 *
 * 저장은 화면 캡처가 아니고 기획서 캔버스도 아니다. Studio에 정착한 **840px
 * 작업본 자산 그대로**를 내놓는 일이다. 그래서 이 모듈이 하는 일은 "어느 페이지의
 * 어느 자산을, 무슨 이름으로"까지이고, 바이트를 만지는 일은 하지 않는다.
 *
 * 이름은 기획서 제목과 페이지 번호로 짓는다. 다운로드 폴더에서 어느 이벤트의 몇
 * 페이지인지 파일명만으로 알 수 있어야 하기 때문이다. 페이지 번호는 **기획서의
 * 실제 번호**다 — 1·3페이지만 만들었으면 `page-01`과 `page-03`이 나온다. 여기서
 * 1·2로 다시 매기면 파일과 기획서가 서로 다른 이야기를 하게 된다.
 *
 * 결과가 없는 페이지는 목록에 아예 들어가지 않는다. 빈 이미지도, 기획서 캔버스를
 * 대신 그린 그림도 만들지 않는다 — 만든 적 없는 것을 만든 척하는 파일이 된다.
 *
 * 순수 모듈이다. ZIP도 저장소도 화면도 모른다.
 */

import { pageResultOf, type StudioJob } from './studioJob'
import { sanitizeFileName } from '../features/export/exportFileName'
import type { BriefDocument } from './pageSchema'

export const IMAGE_EXTENSION = '.png'
export const IMAGE_ZIP_SUFFIX = '_images.zip'

/**
 * 파일명 밑동. 파일 시스템이 거부하는 글자를 먼저 걷어낸 뒤, 남은 공백을 밑줄로
 * 바꾼다 — 파일명 안의 공백은 명령줄과 링크에서 계속 문제를 만든다.
 */
export function imageBaseName(title: string): string {
  return sanitizeFileName(title).replace(/\s+/g, '_')
}

/** `아크웨이브_여름감사제_page-01.png` — 번호는 기획서의 실제 페이지 번호. */
export function pageImageFileName(title: string, pageNumber: number): string {
  const padded = String(Math.max(1, Math.round(pageNumber))).padStart(2, '0')
  return `${imageBaseName(title)}_page-${padded}${IMAGE_EXTENSION}`
}

/** 여러 장일 때의 묶음 이름. */
export function imageZipFileName(title: string): string {
  return `${imageBaseName(title)}${IMAGE_ZIP_SUFFIX}`
}

export interface ImageSavePlanFile {
  pageId: string
  /** 지금 보고 있는 결과의 자산 — 되돌아가 있으면 그 자리의 것. */
  assetId: string
  /** 기획서에서의 페이지 번호 (1부터). */
  pageNumber: number
  fileName: string
}

export interface ImageSavePlan {
  files: ImageSavePlanFile[]
  /** 기획서의 전체 페이지 수 — "3페이지 중 2페이지"를 말하기 위해. */
  totalPages: number
}

/** 몇 장을, 어느 이름으로 내보낼 것인가. */
export function planImageSave(doc: BriefDocument, job: StudioJob): ImageSavePlan {
  const title = doc.project.title
  const files: ImageSavePlanFile[] = []
  doc.pages.forEach((page, index) => {
    const result = pageResultOf(job, page.id)
    if (result === undefined) return
    files.push({
      pageId: page.id,
      assetId: result.assetId,
      pageNumber: index + 1,
      fileName: pageImageFileName(title, index + 1),
    })
  })
  return { files, totalPages: doc.pages.length }
}

/** 전부 만들었는가 — 아니면 사람에게 먼저 물어야 한다. */
export function isPartialSave(plan: ImageSavePlan): boolean {
  return plan.files.length > 0 && plan.files.length < plan.totalPages
}
