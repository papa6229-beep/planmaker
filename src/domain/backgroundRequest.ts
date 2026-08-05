/**
 * 배경 생성 요청 한 건 (배경 합성 1차 §8).
 *
 * 이 모듈의 일은 하나다: **원본이 실리지 않은 요청**을 만드는 것. 그래서
 * 여기에는 두 겹의 방어가 있다.
 *
 *  1. 들어오는 인자에 바이트를 담을 자리가 없다. `BackgroundRequestInput`은
 *     숫자와 사각형만 받는다.
 *  2. 그렇게 만든 본문을 나가기 직전에 한 번 더 읽어, 이미지 실체를 가리키는
 *     흔적이 있으면 던진다.
 *
 * 두 번째가 없어도 첫 번째만으로 충분해 보이지만, "충분해 보인다"가 이 계약이
 * 조용히 깨지던 방식이다. 누군가 편의를 위해 필드를 하나 더 얹는 날, 검사는
 * 통과하고 원본은 나간다. 나가는 문에 자물쇠를 건다.
 */

import { buildBackgroundPrompt, type BackgroundPromptInput } from './backgroundPrompt'
import { mergePageAnalysis, type ImageAnalysis } from './imageAnalysis'
import type { LayoutRect } from './imageLayout'

/** 이미지 실체를 가리키는 흔적. 하나라도 본문에 있으면 요청을 보내지 않는다. */
export const FORBIDDEN_PAYLOAD_MARKS: readonly string[] = ['data:', 'base64', 'blob:', 'http']

export interface BackgroundImageInput {
  blockId: string
  /** 이 이미지의 분석값. 아직 읽지 못했으면 `null`. */
  analysis: ImageAnalysis | null
  /** 캔버스에서 이 이미지가 차지하는 자리. */
  rect: LayoutRect
}

export interface BackgroundRequestInput {
  wish: string
  /** 최종 작업 이미지 크기 — 840 × 페이지 높이. */
  size: { width: number; height: number }
  /** 이미 계산해 둔 페이지 종합값. 없으면 이미지들에서 만든다. */
  page: { images: readonly ImageAnalysis[] } | null
  images: readonly BackgroundImageInput[]
  /** 문구·로고처럼 비워 두어야 하는 다른 자리. */
  reserved?: readonly LayoutRect[]
  /** 모델에게 요청할 크기 문자열. 없으면 본문에 크기를 싣지 않는다. */
  requestedSize?: string
}

/**
 * 서버 함수로 나가는 본문.
 *
 * 글 한 편과 크기 한 줄이 전부다. 여기 필드를 늘리기 전에 위 주석을 다시 읽을 것.
 */
export interface BackgroundRequestBody {
  prompt: string
  requestedSize?: string
}

/** 제품이 바닥에 닿는 높이 — 가장 아래에 놓인 이미지의 밑변. */
export function groundLineOf(images: readonly BackgroundImageInput[]): number | undefined {
  let ground: number | undefined
  for (const image of images) {
    const bottom = image.rect.y + image.rect.height
    if (ground === undefined || bottom > ground) ground = bottom
  }
  return ground
}

/**
 * 본문에 이미지 실체가 섞였는지 본다.
 *
 * 통과하지 못하면 던진다 — 조용히 지우면 무엇이 지워졌는지 아무도 모르고,
 * 같은 실수가 다음에 또 통과한다.
 */
export function assertNoOriginalImage(body: BackgroundRequestBody): void {
  const serialized = JSON.stringify(body)
  for (const mark of FORBIDDEN_PAYLOAD_MARKS) {
    if (serialized.includes(mark)) {
      throw new Error('배경 생성 요청에 원본 이미지가 섞였습니다. 요청을 보내지 않았습니다.')
    }
  }
}

/** 숫자와 사각형만으로 요청 하나를 만든다. */
export function buildBackgroundRequest(input: BackgroundRequestInput): BackgroundRequestBody {
  const analyses = (input.page?.images ?? input.images.map((i) => i.analysis)).filter(
    (a): a is ImageAnalysis => a !== null,
  )
  const promptInput: BackgroundPromptInput = {
    wish: input.wish,
    size: input.size,
    analysis: mergePageAnalysis(analyses),
    reserved: [...input.images.map((i) => i.rect), ...(input.reserved ?? [])],
    ...(groundLineOf(input.images) === undefined ? {} : { groundY: groundLineOf(input.images)! }),
  }

  const body: BackgroundRequestBody = {
    prompt: buildBackgroundPrompt(promptInput),
    ...(input.requestedSize === undefined ? {} : { requestedSize: input.requestedSize }),
  }
  assertNoOriginalImage(body)
  return body
}
