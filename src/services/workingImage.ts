/**
 * 모델이 준 그림 → Studio가 쓰는 작업본 (마감 교정 §3).
 *
 * 두 크기는 서로 다른 것이고, 섞이면 안 된다.
 *
 *  - **AI 생성 규격** — 모델이 받아 주는 크기. 두 변이 16의 배수여야 하므로
 *    840이 될 수 없고, 그래서 832 같은 값이 된다.
 *  - **최종 작업 이미지** — 쇼핑몰과 기획서가 쓰는 크기. 가로는 언제나 840이고,
 *    세로는 지금 페이지의 `canvasHeight` 그대로다.
 *
 * 모델에게 840을 억지로 보내지 않는다. 받은 다음 이쪽에서 맞춘다.
 *
 * 맞출 때 잘라내지도 여백을 붙이지도 않는다. 832→840은 1%가 채 안 되는 가로
 * 늘림이고, 잘라내면 기획서가 요구한 자리가 사라지고 여백을 붙이면 쇼핑몰에서
 * 흰 띠가 생긴다. 전체를 그 크기에 채우는 것이 요구사항을 지키는 유일한 방법이다.
 *
 * 이미 목표 크기로 온 그림은 다시 인코딩하지 않는다 — 손해만 있고 얻을 것이 없다.
 */

import { PAGE_CANVAS_WIDTH } from '../domain/pageSchema'
import { measureImage, drawToSize } from './canvasImageOps'

/** 작업본의 가로는 언제나 기획서 캔버스와 같다. */
export const WORKING_IMAGE_WIDTH = PAGE_CANVAS_WIDTH

export interface WorkingImageTarget {
  width: number
  height: number
}

/** 이 페이지의 작업본 크기 — `840 × 페이지 세로길이`. */
export function workingImageTarget(canvasHeight: number): WorkingImageTarget {
  return { width: WORKING_IMAGE_WIDTH, height: Math.max(1, Math.round(canvasHeight)) }
}

/** `가로x세로` 한 줄 — 화면에 그대로 보여 주는 표기. */
export function sizeLabel(size: WorkingImageTarget): string {
  return `${size.width}x${size.height}`
}

export interface WorkingImageOps {
  measure: (blob: Blob) => Promise<{ width: number; height: number }>
  draw: (blob: Blob, width: number, height: number) => Promise<Blob>
}

export const browserImageOps: WorkingImageOps = { measure: measureImage, draw: drawToSize }

export interface WorkingImage {
  blob: Blob
  width: number
  height: number
  /** 다시 그렸는가. 이미 맞는 크기였으면 `false`이고 `blob`은 받은 그대로다. */
  reencoded: boolean
}

/**
 * 받은 그림을 작업본 크기로 맞춘다.
 *
 * 실패는 그대로 던진다 — 여기서 삼키면 호출부가 "이미 결제된 원본"을 붙들고
 * 있어야 한다는 사실을 모르게 된다.
 */
export async function toWorkingImage(
  source: Blob,
  target: WorkingImageTarget,
  ops: WorkingImageOps = browserImageOps,
): Promise<WorkingImage> {
  const measured = await ops.measure(source)
  if (measured.width === target.width && measured.height === target.height) {
    return { blob: source, width: target.width, height: target.height, reencoded: false }
  }
  const blob = await ops.draw(source, target.width, target.height)
  return { blob, width: target.width, height: target.height, reencoded: true }
}
