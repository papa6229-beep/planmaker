/**
 * 부분수정의 대상 목록 (부분수정 1단계 §2.2).
 *
 * 먼저 분명히 해 둘 것. **모델이 돌려준 것은 한 장짜리 통이미지다.** 문구도
 * 제품도 로고도 편집 가능한 레이어로 오지 않는다. 여기서 만드는 번호는 AI 내부의
 * 레이어 번호가 아니라, 사람이 "무엇을 고칠지" 가리키고 다음 편집 호출에 원
 * 기획서 정보를 다시 실어 보내기 위한 이름표다.
 *
 * 번호는 **생성된 순간에 얼어붙는다.** 왼쪽 기획서를 계속 고칠 수 있으므로,
 * 번호가 살아 있는 계산이면 "문구 3"이 어제와 오늘 다른 것을 가리키게 된다.
 * 그래서 결과에 목록을 그대로 찍어 두고, 그 결과를 고칠 때는 찍힌 목록만 쓴다.
 *
 * 순수 모듈이다. 저장소도 화면도 네트워크도 모른다.
 */

import { isImageBlock } from './blockTypes'
import { productImageOf, type StudioJob } from './studioJob'
import type { BriefDocument, BriefPage } from './pageSchema'

/** 배경은 블록이 아니다. 그래서 블록 id를 지어내 붙이지 않는다 (§6-6). */
export const BACKGROUND_TARGET_ID = 'background'

export type EditTargetKind = 'text' | 'image' | 'background'

export interface EditTargetBox {
  x: number
  y: number
  width: number
  height: number
}

export interface EditTarget {
  /** 선택과 요청에 쓰는 식별자. 블록이면 `blockId`와 같고, 배경이면 `background`. */
  targetId: string
  /** 배경에는 없다 — 없는 블록을 가리키는 id를 만들지 않기 위해서다. */
  blockId?: string
  kind: EditTargetKind
  /** 사람이 읽는 이름. `문구 3 — 출시기념` 처럼. */
  label: string
  /** 문구 원문 그대로, 또는 이미지 자리 설명. */
  content?: string
  /** 생성 당시 위치·크기. */
  box?: EditTargetBox
  /** 페이지 크기에 대한 0~1 비율. */
  ratio?: EditTargetBox
  /** 작성자가 붙인 참고 캡처. */
  referenceAssetId?: string
  /** 디자인팀이 연결한 실제 사용 제품·로고 원본. */
  productAssetId?: string
  pageId: string
}

function ratioOf(box: EditTargetBox, width: number, height: number): EditTargetBox {
  return {
    x: width === 0 ? 0 : box.x / width,
    y: height === 0 ? 0 : box.y / height,
    width: width === 0 ? 0 : box.width / width,
    height: height === 0 ? 0 : box.height / height,
  }
}

/** 짧은 꼬리표 — 목록에서 무엇인지 알아볼 만큼만. */
function shortly(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}…` : trimmed
}

/**
 * 이 페이지의 편집 대상 목록.
 *
 * 순서는 위에서 아래로, 같은 높이면 왼쪽에서 오른쪽으로. 화면에서 눈이 움직이는
 * 순서와 같아야 "문구 3"을 세어 찾을 수 있다. 번호는 종류별로 따로 매긴다.
 * 마지막은 언제나 `전체 배경`이다.
 */
export function buildEditTargets(doc: BriefDocument, job: StudioJob, pageId: string): EditTarget[] {
  const page: BriefPage = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0]!
  const { canvasWidth: width, canvasHeight: height } = page

  const ordered = [...page.blocks]
    // 연결 주소는 이미지에 인쇄되지 않으므로 고칠 대상도 아니다.
    .filter((b) => b.aiVisibility !== 'publishing')
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)

  let textNo = 0
  let imageNo = 0
  const targets: EditTarget[] = ordered.map((block) => {
    const box: EditTargetBox = {
      x: block.position.x,
      y: block.position.y,
      width: block.position.width,
      height: block.position.height,
    }
    const kind: EditTargetKind = isImageBlock(block.type) ? 'image' : 'text'
    const content = block.content?.trim()
    const productAssetId = productImageOf(job, block.id)

    let label: string
    if (kind === 'image') {
      imageNo += 1
      label = `이미지 ${String(imageNo)}${content ? ` — ${shortly(content)}` : ''}`
    } else {
      textNo += 1
      label = `문구 ${String(textNo)}${content ? ` — ${shortly(content)}` : ''}`
    }

    return {
      targetId: block.id,
      blockId: block.id,
      kind,
      label,
      ...(content === undefined || content.length === 0 ? {} : { content }),
      box,
      ratio: ratioOf(box, width, height),
      ...(block.assetId === undefined ? {} : { referenceAssetId: block.assetId }),
      ...(productAssetId === undefined ? {} : { productAssetId }),
      pageId: page.id,
    }
  })

  targets.push({
    targetId: BACKGROUND_TARGET_ID,
    kind: 'background',
    label: '전체 배경',
    pageId: page.id,
  })
  return targets
}

/** 고른 것들만. 없는 id는 조용히 버리지 않고 빠진 채로 드러난다. */
export function selectedTargets(targets: readonly EditTarget[], ids: readonly string[]): EditTarget[] {
  return targets.filter((t) => ids.includes(t.targetId))
}

/** 고른 대상들이 필요로 하는 실제 제품·로고 원본 — 중복 없이, 목록 순서대로. */
export function selectedProductAssetIds(targets: readonly EditTarget[]): string[] {
  return [...new Set(targets.map((t) => t.productAssetId).filter((id): id is string => id !== undefined))]
}
