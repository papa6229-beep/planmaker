/**
 * 이 배포는 어느 공급자를 쓰는가 (로컬 provider 1차).
 *
 * 갈림길이 여기 하나뿐인 것이 이 파일의 전부다. `api/generate-image.ts`가 한 번
 * 묻고, 그 답을 이미 있던 이음매(`deps.requestImage`)에 얹는다.
 *
 * ## 아무것도 안 정한 배포는 아무것도 달라지지 않는다
 *
 * `IMAGE_PROVIDER`가 없거나 `openai`이면 `undefined`를 돌려준다. 그러면
 * `handleGenerateImage`의 `deps.requestImage ?? requestOpenAiImage`가 지금까지의
 * 길로 간다 — 새 코드가 끼어드는 자리가 아예 없다.
 *
 * ## 설정이 덜 끝난 배포는 눈에 띄게 고장 난다
 *
 * `local`이라고 해 놓고 주소를 안 적었거나, 아는 값이 아닌 것을 적었을 때
 * **조용히 OpenAI로 흐르지 않는다.** 그러면 로컬로 돌린다고 믿는 사람이 남의
 * 카드로 결제하게 된다. 대신 부를 때마다 `server_not_configured`로 실패하는
 * 공급자를 돌려준다 — 화면에는 "서버 설정이 끝나지 않아 생성할 수 없습니다"가
 * 뜨고, 서버 기록에는 무엇이 빠졌는지 남는다.
 *
 * 왜 여기서 곧장 던지지 않는가: 서버 함수에는 "켜지는 순간"이 없다. 요청마다
 * 새로 시작하므로 모듈을 읽는 중에 던지면 사람이 보는 것은 이유 없는 500 하나다.
 * 부를 때 실패하면 이미 있는 오류 경로를 그대로 타고 제 문구가 화면까지 간다.
 */

import {
  ImageProviderError,
  type ImageProvider,
} from '../domain/imageProvider.js'
import {
  createLocalImageClient,
  DEFAULT_LOCAL_TIMEOUT_MS,
  type LocalImageConfig,
} from './localImageClient.js'
import type { ServerEnv } from './serverAccess.js'

/** 아는 값. 이 밖의 값은 오타이지 새 공급자가 아니다. */
export const IMAGE_PROVIDERS = ['openai', 'local'] as const

/**
 * 환경을 읽은 결과 — **부르기 전에** 무엇이 정해졌는지 알 수 있게.
 *
 * 공급자 함수 하나만 돌려주면 "이 배포가 지금 어떤 상태인가"를 검사도 운영도 볼
 * 수 없다. 판단은 여기서 한 번 하고, 공급자를 만드는 일은 그 결과를 따른다.
 */
export type ProviderSetting =
  | { kind: 'openai' }
  | { kind: 'local'; config: LocalImageConfig }
  | { kind: 'misconfigured'; reason: MisconfigReason; detail: string }

export type MisconfigReason = 'unknown_provider' | 'missing_local_url' | 'invalid_timeout'

function readTimeout(raw: string | undefined): number | null {
  if (raw === undefined || raw.length === 0) return DEFAULT_LOCAL_TIMEOUT_MS
  const value = Number(raw)
  // 소리 없이 기본값으로 되돌리지 않는다. `30s` 같은 오타는 "30초로 맞췄다"고
  // 믿게 만들고, 실제로는 2분을 기다리게 된다.
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null
  return value
}

/** 환경변수 몇 개 → 이 배포의 상태 하나. 순수 함수다. */
export function readProviderSetting(env: ServerEnv): ProviderSetting {
  const name = env.imageProvider
  if (name === undefined || name.length === 0 || name === 'openai') return { kind: 'openai' }
  if (name !== 'local') {
    return {
      kind: 'misconfigured',
      reason: 'unknown_provider',
      detail: `IMAGE_PROVIDER must be one of ${IMAGE_PROVIDERS.join(' | ')}`,
    }
  }

  const apiUrl = env.localImageApiUrl
  if (apiUrl === undefined || apiUrl.length === 0) {
    return { kind: 'misconfigured', reason: 'missing_local_url', detail: 'LOCAL_IMAGE_API_URL is not set' }
  }
  const timeoutMs = readTimeout(env.localImageTimeoutMs)
  if (timeoutMs === null) {
    return {
      kind: 'misconfigured',
      reason: 'invalid_timeout',
      detail: 'LOCAL_IMAGE_TIMEOUT_MS must be a positive integer (ms)',
    }
  }

  return {
    kind: 'local',
    config: {
      apiUrl,
      timeoutMs,
      ...(env.localImageModel === undefined ? {} : { model: env.localImageModel }),
      ...(env.localImageApiKey === undefined ? {} : { apiKey: env.localImageApiKey }),
    },
  }
}

/** 부를 때마다 같은 이유로 실패하는 공급자. 외부로 나가는 자리가 없다. */
function refusingProvider(setting: { reason: MisconfigReason; detail: string }): ImageProvider {
  return async () => {
    throw new ImageProviderError('server_not_configured', 503, undefined, {
      code: setting.reason,
      detail: setting.detail,
    })
  }
}

/**
 * 이 요청이 쓸 공급자. `undefined`면 **지금까지의 OpenAI 경로 그대로**다.
 *
 * `undefined`를 돌려주는 것이 핵심이다. 여기서 `requestOpenAiImage`를 직접
 * 돌려주면 기본 경로가 이 파일을 지나게 되고, 이 파일이 고장 나는 날 OpenAI
 * 경로도 함께 고장 난다.
 */
export function resolveImageProvider(env: ServerEnv): ImageProvider | undefined {
  const setting = readProviderSetting(env)
  if (setting.kind === 'openai') return undefined
  if (setting.kind === 'local') return createLocalImageClient(setting.config)
  return refusingProvider(setting)
}
