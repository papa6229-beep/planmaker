/**
 * 이미지 한 장을 만드는 **공급자 포트** (로컬 provider 1차).
 *
 * 지금까지 "이미지를 만든다"는 곧 "OpenAI를 부른다"였다. 그 둘을 여기서 가른다.
 * 이 파일에 있는 것은 전부 타입과 순수 함수뿐이고, 어느 공급자도 알지 못한다 —
 * OpenAI도, 로컬 엔진도, 그 뒤의 워크플로도.
 *
 * ## 왜 기능별 함수로 나누지 않았나
 *
 * `generateBackground()` · `generateTypographyLayer()` 처럼 나누는 길도 있었다.
 * 그러지 않은 이유는 **서버 함수가 그 구분을 모르기 때문**이다. 무엇을 위한
 * 요청인지는 브라우저가 정하고, 서버 함수 아래로 내려오는 것은 언제나 같은 한
 * 벌이다 — 프롬프트 한 덩이, 이미지 몇 장, 크기 하나.
 *
 * 기능별로 나누면 프롬프트를 짓는 여덟 자리와 그것을 부르는 모든 곳이 공급자를
 * 알아야 한다. 그건 이식이 아니라 개편이다.
 *
 * 대신 `intent` 한 칸을 둔다. "이 요청은 배경용이다"라는 **중립적인 사실**만
 * 넘기고, 그것으로 무엇을 할지는 공급자가 정한다. OpenAI provider는 이 값을
 * 읽지 않는다.
 *
 * 순수 모듈이다. 네트워크도 저장소도 화면도 모른다.
 */

import type { ImageGenerationErrorCode } from './imageGeneration.js'

/**
 * 이 요청이 어느 겹을 만드는가.
 *
 * 값은 `domain/imageUsage.ts`의 `UsageKind`와 같다 — 브라우저가 장부에 적는 그
 * 갈래를 그대로 흘려보내기 때문이다. 두 목록을 한쪽으로 몰지 않은 것은 뜻이
 * 다르기 때문이다: 하나는 "돈이 어디서 나갔나"의 기록이고, 하나는 공급자에게
 * 주는 힌트다. 둘이 어긋나면 검사가 잡는다 (`localImageProvider.test.ts`).
 */
/** `light` — 빛 맞추기 (빛 층 Patch). 제품 모양의 회색 덩어리를 얹은 한 장이 간다. */
export const IMAGE_INTENTS = ['plate', 'text-layer', 'edit', 'background', 'light'] as const
export type ImageIntent = (typeof IMAGE_INTENTS)[number]

/**
 * 말 없이 레퍼런스만 왔을 때, 그 레퍼런스를 어떻게 볼 것인가.
 *
 * `preserve` = 배경 구성까지 그대로, `style` = 색감·질감만 가져오고 구성은 새로.
 * PLANMAKER의 체크박스 두 상태이고, 값은 공급자에게 넘기는 **사실**이다.
 */
export const REFERENCE_MODES = ['preserve', 'style'] as const
export type ReferenceMode = (typeof REFERENCE_MODES)[number]

/** 폼에서 읽은 값을 아는 상태로 좁힌다. 모르는 값은 없는 것으로 본다. */
/**
 * 문구 판 재질 이름 (문구 꾸미기 Patch). `domain/textStyle.ts`의 목록 중 AI를 부르는 것만.
 * 서버 함수가 읽으므로 여기 따로 둔다 — 서버 빌드는 이 파일만 가져간다.
 */
export const TEXT_FINISH_NAMES = ['glossy', 'plastic', 'metal', 'glitter', 'neon'] as const
export type TextFinishName = (typeof TEXT_FINISH_NAMES)[number]

export function readTextFinishName(value: unknown): TextFinishName | undefined {
  return typeof value === 'string' && (TEXT_FINISH_NAMES as readonly string[]).includes(value)
    ? (value as TextFinishName)
    : undefined
}

export function readReferenceMode(value: unknown): ReferenceMode | undefined {
  return typeof value === 'string' && (REFERENCE_MODES as readonly string[]).includes(value)
    ? (value as ReferenceMode)
    : undefined
}

/**
 * 폼에서 읽은 값을 아는 갈래로 좁힌다.
 *
 * 모르는 값은 조용히 버린다 — 힌트 하나가 이상하다고 생성을 막을 이유가 없고,
 * 힌트가 없을 때의 동작은 어차피 정의돼 있다.
 */
export function readImageIntent(value: unknown): ImageIntent | undefined {
  return typeof value === 'string' && (IMAGE_INTENTS as readonly string[]).includes(value)
    ? (value as ImageIntent)
    : undefined
}

/** 함께 보내는 그림 한 장. 파일명이 곧 역할이다 — `style-reference.png` 처럼. */
export interface ImageProviderInput {
  fileName: string
  blob: Blob
}

export interface ImageProviderRequest {
  /**
   * 이 요청의 자격.
   *
   * OpenAI provider는 이 값을 `Authorization`에 싣는다. **로컬 provider는 이 값을
   * 읽지 않는다** — 읽는 순간 OpenAI 키가 로컬 주소로 나간다. 로컬의 자격은
   * 환경변수에서 따로 오고, 그 약속을 `localImageClient.ts`가 지킨다.
   */
  apiKey: string
  prompt: string
  /** `가로x세로` — `resolveGptImageSize`가 만든 값. */
  size: string
  images: readonly ImageProviderInput[]
  /** 배경을 투명하게 받을 것인가. 값이 없으면 아무것도 보내지 않는다. */
  background?: 'transparent'
  /** 이 요청이 어느 겹인가. 없어도 요청은 성립한다. */
  intent?: ImageIntent
  /**
   * 작업자가 쓴 말 그대로 + 레퍼런스 그림 한 장 (직접 전달 Patch).
   *
   * **레퍼런스 한 장이면 생긴다** (레퍼런스만 Patch). 로컬 provider는 이것이 있으면
   * `prompt`와 `images` 대신 이것만 보낸다. OpenAI provider는 읽지 않는다.
   *
   * 말이 비어 있을 때는 `mode`가 대신 간다 — 체크박스 상태 그대로다. 원래
   * PLANMAKER는 레퍼런스만 올려도 배경을 만들었고, 그 길이 엔진이 바뀌었다고
   * 사라지면 안 된다. 그때 무슨 말로 시킬지는 엔진을 아는 쪽이 정한다.
   */
  direct?: {
    note: string
    reference: ImageProviderInput
    mode?: ReferenceMode
    /** 제품의 대표색 — `#rrggbb` 를 쉼표로 이은 것. 숫자만 간다. */
    productTone?: string
    /** 문구 판에 입힐 재질 이름 (문구 꾸미기 Patch). 있으면 `note`는 비어 있다. */
    textFinish?: TextFinishName
  }
}

export interface ImageProviderResult {
  b64: string
  mimeType: string
  /**
   * 이 그림을 실제로 만든 모델 (로컬 provider 1차).
   *
   * 없으면 부르는 쪽이 지금까지의 상수를 쓴다. 값이 있는데 무시하면 화면이
   * 거짓말을 한다 — 로컬로 만든 그림에 `gpt-image-2`라고 적히는 자리가 그것이다.
   */
  model?: string
  /** 공급자가 준 요청 id. 오류를 조사할 때만 쓴다. */
  requestId?: string
  /** 공급자가 준 사용량 그대로. 비용을 여기서 계산하지 않는다. */
  usage?: unknown
}

/**
 * 이미지 한 장을 만드는 함수 하나.
 *
 * **자동 재시도는 어느 구현에도 없다.** 한 번 눌러 한 번 나가고, 실패하면 실패한
 * 채로 돌아온다. 로컬이 무료라 해도 마찬가지다 — 스스로 다시 부르면 실패한 이유가
 * 화면에서 사라진다.
 */
export type ImageProvider = (
  request: ImageProviderRequest,
  deps?: { fetch?: typeof fetch },
) => Promise<ImageProviderResult>

/**
 * 실패 하나. **공급자가 보낸 문장은 담지 않는다** — 그 안에 키가 그대로 들어
 * 있는 경우가 있고, 한 번 객체에 담기면 로그·화면·오류 보고 어디로든 새어 나간다.
 * 남기는 것은 우리가 분류한 코드와, 조사에 쓸 요청 id뿐이다.
 *
 * 공급자를 가르면서 이 클래스가 여기로 왔다. 공급자마다 오류 모양을 따로 두면
 * 부르는 쪽이 `instanceof`를 공급자 수만큼 쓰게 되고, 언젠가 한쪽을 빠뜨린다.
 * `openAiImageClient.ts`가 같은 이름으로 다시 내보내므로 부르는 쪽은 달라지지
 * 않는다.
 */
export class ImageProviderError extends Error {
  readonly code: ImageGenerationErrorCode
  readonly status: number
  readonly requestId?: string
  /**
   * 공급자가 붙인 분류값 (`error.code` / `error.type`) 그대로 — **짧은 이름뿐**.
   *
   * 문장은 여전히 담지 않는다. 담지 않는 이유는 그 안에 키가 섞여 나온 적이
   * 있어서이고, 그 위험은 이름표에는 없다. 이것이 없으면 400을 받았을 때
   * 무엇이 잘못됐는지 알 길이 아예 없다 — 우리 분류는 모든 400을 한 칸에 넣는다.
   */
  readonly providerCode?: string
  readonly providerType?: string
  /** 어느 요청 항목이 문제였는가 (`error.param`). 값이 아니라 **이름**이다. */
  readonly providerParam?: string
  /** 남겨도 되는 만큼만 손질한 설명 — `safeProviderDetail`을 지난 문자열. */
  readonly providerDetail?: string

  constructor(
    code: ImageGenerationErrorCode,
    status: number,
    requestId?: string,
    provider?: { code?: string; type?: string; param?: string; detail?: string },
  ) {
    super(`image provider failed: ${code}`)
    this.name = 'ImageProviderError'
    this.code = code
    this.status = status
    if (requestId !== undefined) this.requestId = requestId
    if (provider?.code !== undefined) this.providerCode = provider.code
    if (provider?.type !== undefined) this.providerType = provider.type
    if (provider?.param !== undefined) this.providerParam = provider.param
    if (provider?.detail !== undefined) this.providerDetail = provider.detail
  }
}

/**
 * 공급자 설명 중 **남겨도 되는 만큼**.
 *
 * 원문을 그대로 담지 않는 규칙은 그대로다 — 그 안에 키가 실려 온 적이 있기
 * 때문이다. 그렇다고 통째로 버리면 `invalid_value`가 어느 값을 가리키는지 알
 * 길이 없어, 다음 실제 생성에서도 같은 자리에 서게 된다.
 *
 * 그래서 지우고 남긴다.
 *
 *  - 키 모양(`sk-…`, `Bearer …`)은 통째로
 *  - 40자 넘게 이어지는 토큰은 무엇이든 (키든 base64든)
 *  - 따옴표 안이 40자 넘으면 — 우리가 보낸 글이 되돌아온 것이다
 *  - 첫 줄만, 200자까지
 *
 * 남는 것은 `Invalid value: 'transparent'. Supported values are: …` 같은 짧은
 * 문장이다. 키도, 프롬프트도, 이미지도 여기 남지 않는다.
 */
export function safeProviderDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const redacted = (value.split('\n')[0] ?? '')
    .replace(/\b(?:sk|rk|org|proj)[-_][A-Za-z0-9_-]{6,}/gi, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, '[redacted]')
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, '[redacted]')
    .replace(/(['"])[^'"]{40,}?\1/g, '$1[redacted]$1')
    .trim()
  return redacted.length === 0 ? undefined : redacted.slice(0, 200)
}
