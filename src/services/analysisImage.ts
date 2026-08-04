/**
 * 분석용 축소 이미지 한 장 (실작업 UI 마감 §9).
 *
 * 지시를 다듬는 모델에게 "지금 화면이 이렇게 생겼다"를 보여 주기 위한 것이다.
 * 원본 크기로 보낼 이유가 없다 — 판단에 필요한 것은 배치와 밀도이지 픽셀이 아니고,
 * 입력 비용은 크기에 비례한다. 그래서 가로를 정해 두고 줄여서 보낸다.
 *
 * **원본 자산은 조금도 바뀌지 않는다.** 여기서 만드는 것은 요청 안에서만 사는
 * 문자열 한 개이고, 저장소에 들어가지 않는다.
 */

import { measureImage, drawToSize } from './canvasImageOps'
import { REFINE_PREVIEW_MAX_WIDTH } from '../domain/instructionRefine'

/** 목표 크기 — 가로 상한을 넘지 않게 비율 그대로 줄인다. */
export function analysisSize(
  width: number,
  height: number,
  maxWidth = REFINE_PREVIEW_MAX_WIDTH,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: maxWidth, height: maxWidth }
  if (width <= maxWidth) return { width: Math.round(width), height: Math.round(height) }
  const scale = maxWidth / width
  return { width: maxWidth, height: Math.max(1, Math.round(height * scale)) }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 줄여서 data URL 한 개로.
 *
 * 실패하면 던지지 않고 `null`을 돌려준다 — 그림을 못 보내는 것은 다듬기를 못 하는
 * 이유가 아니다. 글만으로도 다듬을 수 있고, 여기서 막으면 사람이 이유도 모른 채
 * 버튼 앞에 선다.
 */
export async function toAnalysisDataUrl(blob: Blob, maxWidth = REFINE_PREVIEW_MAX_WIDTH): Promise<string | null> {
  try {
    const measured = await measureImage(blob)
    const target = analysisSize(measured.width, measured.height, maxWidth)
    const small = await drawToSize(blob, target.width, target.height)
    return await toDataUrl(small)
  } catch {
    return null
  }
}
