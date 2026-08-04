/**
 * 이미지 생성 한 건의 계약 (1단계 §10).
 *
 * 브라우저와 서버 함수가 같은 말을 쓰기 위한 곳이다. 여기 있는 것은 전부
 * 직렬화되는 값뿐이고, 이미지 자체(bytes)는 들어오지 않는다 — 결과 이미지는
 * 기존 자산 저장 경계에 저장하고, 작업 행에는 그 번호와 이 메타데이터만 남는다.
 * base64 문자열을 작업 상태에 그대로 넣으면 저장소가 한 번의 생성으로 부풀고,
 * 새로고침마다 그 덩어리를 다시 읽게 된다.
 */

import type { EditTarget } from './editTargets.js'

/** 이번 단계에서 쓰는 모델과 품질 — 화면에도 이 값을 그대로 보여 준다. */
export const IMAGE_MODEL = 'gpt-image-2'
export const IMAGE_QUALITY = 'medium'
export const IMAGE_OUTPUT_FORMAT = 'png'
/** 한 번 누르면 한 번 나간다. 자동 재시도는 없다. */
export const IMAGE_CALLS_PER_CLICK = 1

/** 브라우저가 서버 함수를 부르는 곳. */
export const GENERATE_IMAGE_PATH = '/api/generate-image'
/** 키는 이 요청 하나에만 실린다 (§3). */
export const API_KEY_HEADER = 'X-OpenAI-API-Key'

/**
 * 브라우저가 form에 실어 보내는 이름들. 양쪽이 같은 이름을 쓰기 위한 값이므로
 * 계약과 함께 둔다 — 브라우저가 서버 함수 모듈을 import하지 않게 하기 위해서다.
 */
export const FIELD_PROMPT = 'prompt'
export const FIELD_SIZE = 'size'
export const FIELD_IMAGES = 'images[]'

export interface ImageGenerationMetadata {
  model: typeof IMAGE_MODEL
  quality: typeof IMAGE_QUALITY
  /** 모델에게 요청한 크기 — 두 변이 16의 배수라 840이 될 수 없다. */
  requestedSize: string
  /**
   * Studio가 실제로 쓰는 크기 — `840 × 페이지 세로길이` (마감 교정 §3).
   *
   * 예전 판에서 저장된 결과에는 없다. 그때는 모델이 준 크기를 그대로 썼다.
   */
  workingSize?: string
  /** 생성 당시 기획서의 지문 — 뒤에 기획서가 바뀌면 이 값으로 알아본다. */
  sourceFingerprint: string
  createdAt: number
  /** 공급자가 준 요청 id. 오류를 조사할 때만 쓴다. */
  requestId?: string
}

export interface GeneratedPageResult extends ImageGenerationMetadata {
  pageId: string
  /** 지금 보고 있는 결과. 이미지 자체는 여기 들어오지 않는다. */
  assetId: string
  /**
   * 부분수정을 위한 세 상태 (부분수정 §4). 이전 판에서 저장된 결과에는 없다.
   *
   *  - `originalAssetId` — 맨 처음 만든 것. 몇 번을 고쳐도 여기로 돌아올 수 있다.
   *  - `previousAssetId` — 바로 직전 것. 방금 한 수정이 마음에 안 들 때.
   *
   * 되돌리기는 이 번호들을 가리키기만 한다. 외부를 다시 부르지 않는다.
   */
  originalAssetId?: string
  previousAssetId?: string
  /**
   * 생성 순간에 얼려 둔 편집 대상 목록.
   *
   * 왼쪽 기획서는 계속 바뀌므로, 이 결과를 고칠 때 쓰는 번호와 원문은 살아 있는
   * 문서가 아니라 여기서 나온다 — 그러지 않으면 "문구 3"이 가리키는 것이 조용히
   * 달라진다.
   */
  targets?: EditTarget[]
  /** 이 결과가 몇 번의 부분수정을 거쳤는가. 이력을 담지는 않는다. */
  editCount?: number
}

/** 서버 함수가 성공했을 때 돌려주는 것. */
export interface GenerateImageSuccess {
  image: { b64: string; mimeType: string }
  metadata: {
    model: string
    quality: string
    requestedSize: string
    requestId?: string
    /** 공급자가 사용량을 돌려주면 그대로. 비용을 여기서 계산하지 않는다. */
    usage?: unknown
  }
}

/**
 * 실패했을 때의 코드. 사용자에게 보일 문장은 화면 쪽에서 이 코드로 고른다 —
 * 공급자가 보낸 원문을 그대로 내보내지 않기 위해서다 (§12).
 */
export type ImageGenerationErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'model_not_found'
  | 'insufficient_quota'
  | 'moderation_blocked'
  | 'invalid_size'
  | 'function_timeout'
  | 'network_error'
  | 'no_image'
  | 'save_failed'
  | 'too_many_inputs'
  | 'target_not_found'
  | 'rate_limited'
  | 'aspect_out_of_range'
  | 'unknown'

export interface GenerateImageFailure {
  error: { code: ImageGenerationErrorCode; message: string; requestId?: string }
}

/** 짧은 원인과 다음 행동. 공급자 원문은 절대 여기 오지 않는다. */
export const ERROR_TEXT: Record<ImageGenerationErrorCode, string> = {
  missing_api_key: 'OpenAI API 키를 먼저 입력해 주세요.',
  invalid_api_key: 'API 키가 올바르지 않습니다. 키를 다시 입력해 주세요.',
  model_not_found: '이 키로는 해당 이미지 모델을 사용할 수 없습니다. 조직의 모델 사용 권한을 확인해 주세요.',
  insufficient_quota: '크레딧 또는 결제에 문제가 있어 생성하지 못했습니다. OpenAI 결제 상태를 확인해 주세요.',
  moderation_blocked: '안전 정책 판정으로 이 요청은 생성할 수 없습니다. 문구나 이미지를 조정해 다시 시도해 주세요.',
  invalid_size: '입력 이미지나 요청 크기에 문제가 있습니다. 페이지 크기와 연결한 이미지를 확인해 주세요.',
  function_timeout: '생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
  network_error: '네트워크 문제로 요청을 마치지 못했습니다. 연결을 확인하고 다시 시도해 주세요.',
  no_image: '응답에서 이미지를 받지 못했습니다. 다시 시도해 주세요.',
  save_failed: '생성은 되었지만 결과를 저장하지 못했습니다. 다시 시도해 주세요.',
  too_many_inputs: '한 번에 보낼 수 있는 이미지 수를 넘었습니다. 연결한 이미지를 줄여 주세요.',
  target_not_found:
    '수정할 대상을 현재 결과에서 찾지 못했습니다. 기존 이미지로 돌아갑니다. 어느 문구·이미지인지 더 구체적으로 적어 다시 시도해 주세요.',
  rate_limited: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
  aspect_out_of_range: '현재 페이지는 1장 생성이 가능한 최대 세로 비율을 넘었습니다. 페이지를 나누어 다시 시도해 주세요.',
  unknown: '이미지를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
}

export function errorTextFor(code: string | undefined): string {
  return ERROR_TEXT[(code ?? 'unknown') as ImageGenerationErrorCode] ?? ERROR_TEXT.unknown
}
