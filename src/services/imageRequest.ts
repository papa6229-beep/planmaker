/**
 * 이미지 한 장을 서버 함수에 청하고 받는다 (배경 후보 Patch에서 떼어 냄, 2026-09-17).
 *
 * 문구·배경 판·부분수정(`useImageGeneration`)과 배경 후보(`useBackgroundLab`)가 같은 길을
 * 쓴다. 받는 법과 장부 적는 법이 둘로 갈리면, 한쪽만 고쳐지고 다른 쪽이 조용히 틀린다.
 */

import { GENERATE_IMAGE_PATH, httpFailureCode } from '../domain/imageGeneration'
import { readImageUsage, type UsageKind } from '../domain/imageUsage'
import { recordCall } from './usageStore'

export type ImageReply =
  | { blob: Blob; mimeType: string; requestedSize?: string; model?: string; requestId?: string }
  | { code?: string }

/** base64 → 이미지 한 장. 이 문자열은 여기서 끝나고 어디에도 저장되지 않는다. */
function blobFromBase64(b64: string, mimeType: string): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

export async function postImageRequest(
  form: FormData,
  /** 이 요청에 붙일 자격 헤더 — 자기 키이거나 암구호다. */
  auth: Record<string, string>,
  /** 장부에 적을 갈래. */
  kind: UsageKind,
): Promise<ImageReply> {
  // 자격은 이 요청의 헤더에만 실린다 — 주소에도, 본문에도 없다.
  const response = await fetch(GENERATE_IMAGE_PATH, {
    method: 'POST',
    headers: auth,
    body: form,
  })

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = (payload as { error?: { code?: string } } | null)?.error
    // 우리 서버 함수는 실패해도 코드를 담는다. 코드가 없으면 그 함수까지
    // 가지도 못한 요청이므로, 상태 코드로 이름을 붙인다 (부분수정 실패 Patch).
    return failure?.code === undefined ? { code: httpFailureCode(response.status) } : { ...failure }
  }
  const body = payload as {
    image?: { b64?: string; mimeType?: string }
    metadata?: { model?: string; requestedSize?: string; requestId?: string; usage?: unknown }
  } | null

  // 여기까지 왔으면 값은 이미 치렀다 — 그림을 못 받았더라도. 그래서 장부는
  // 그림을 확인하기 **전에** 적는다. 던져 놓고 잊는다: 못 적었다고 방금 만든
  // 것을 잃을 이유가 없다.
  const used = readImageUsage(body?.metadata?.usage)
  void recordCall({ at: Date.now(), kind, ...(used === null ? {} : { usage: used }) })

  const b64 = body?.image?.b64
  if (typeof b64 !== 'string' || b64.length === 0) return { code: 'no_image' }

  const mimeType = body?.image?.mimeType ?? 'image/png'
  return {
    blob: blobFromBase64(b64, mimeType),
    mimeType,
    ...(body?.metadata?.requestedSize === undefined ? {} : { requestedSize: body.metadata.requestedSize }),
    // 서버가 말해 준 모델 이름. 없으면 부르는 쪽이 지금까지의 상수를 쓴다.
    ...(body?.metadata?.model === undefined ? {} : { model: body.metadata.model }),
    ...(body?.metadata?.requestId === undefined ? {} : { requestId: body.metadata.requestId }),
  }
}
