/**
 * 참고용 그림을 보내기 전에 줄인다 (부분수정 실패 Patch).
 *
 * 규칙은 `domain/uploadImage.ts`에 있고 순수하다. 여기서는 그 규칙이 시키는 대로
 * 캔버스에 다시 그릴 뿐이다.
 *
 * **원본 자산은 손대지 않는다.** 여기서 만든 것은 이 요청 한 번에만 쓰이고
 * 사라진다 — 저장소에 들어가지 않으므로, 작업자가 올린 레퍼런스는 언제나 원본
 * 그대로 남는다.
 *
 * 줄이지 못하면 원본을 그대로 돌려준다. 참고 그림 하나 때문에 요청 전체를
 * 세우지 않는다.
 */

import { referenceTarget } from '../domain/uploadImage'
import { drawToSize, measureImage } from './canvasImageOps'

export async function shrinkReference(blob: Blob): Promise<Blob> {
  try {
    const size = await measureImage(blob)
    const target = referenceTarget(size, blob.size)
    if (target === null) return blob
    return await drawToSize(blob, target.width, target.height)
  } catch {
    return blob
  }
}
