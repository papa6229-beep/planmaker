/**
 * `.eventbrief` 안에 남기는 Studio 상태 (Studio 파일 결함 마감 §4.2).
 *
 * 디자인팀이 연결한 실제 사용 제품 이미지는 기획서 문서가 아니라 Studio 작업에만
 * 적힌다. 그것이 원본을 지키는 경계지만, 파일로 저장할 때 그 경계 바깥을 빼고
 * 쓰면 작업을 이어갈 수 없는 파일이 나온다 — 실제로 그랬다. 그래서 파일에
 * `studio.json` 한 장을 더 넣는다.
 *
 * `StudioJob`을 통째로 직렬화하지 않는다. 파일에 남겨야 하는 것만 여기 이름으로
 * 적고, 나머지(작업본 문서는 `document.json`이, 히스토리는 화면이 갖는다)는
 * 들어가지 않는다.
 *
 * 원본 문서 자체는 파일에 두 번 담지 않는다. 남기는 것은 **원본의 지문**이고,
 * 그것으로 "불러온 원본과 지금 작업본이 달라졌는가"를 그대로 판정할 수 있다.
 *
 * 순수 모듈이다. ZIP도 저장소도 화면도 모른다.
 */

import type { StudioJob } from './studioJob'

export const STUDIO_FILE_VERSION = '0.1.0'

/** 파일이 기억하는 "이 작업이 어느 원본에서 시작했는가". */
export interface StudioFileSource {
  /** 채택 시점 원본의 지문 (`documentFingerprint`). */
  fingerprint: string
  fileName?: string
  importedAt: number
}

export interface StudioFileState {
  version: string
  /** 아직 어떤 파일도 원본으로 채택하지 않았으면 `null`. */
  source: StudioFileSource | null
  /** 블록 id → 실제 사용 제품 이미지의 자산 id. */
  productImages: Record<string, string>
}

/** 지금 작업에서 파일에 남길 것만 추린다. */
export function toStudioFileState(job: StudioJob): StudioFileState {
  const source: StudioFileSource | null =
    job.source === null
      ? null
      : {
          fingerprint: job.source.fingerprint,
          importedAt: job.source.importedAt,
          ...(job.source.fileName === undefined ? {} : { fileName: job.source.fileName }),
        }
  return {
    version: STUDIO_FILE_VERSION,
    source,
    productImages: { ...job.productImages },
  }
}

/** 이 상태가 필요로 하는 이미지 자산 id — 같은 이미지는 한 번만. */
export function studioFileAssetIds(state: StudioFileState): string[] {
  return [...new Set(Object.values(state.productImages))]
}

/**
 * 불러오기에서 자산 id가 새로 발급됐을 때, 연결정보도 같은 매핑으로 함께 옮긴다.
 * 기획서 참조만 옮기고 여기를 빼면 연결이 사라진 그림을 가리키게 된다.
 */
export function remapStudioFileState(
  state: StudioFileState,
  mapping: ReadonlyMap<string, string>,
): StudioFileState {
  if (mapping.size === 0) return state
  const productImages: Record<string, string> = {}
  for (const [blockId, assetId] of Object.entries(state.productImages)) {
    productImages[blockId] = mapping.get(assetId) ?? assetId
  }
  return { ...state, productImages }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 신뢰할 수 없는 `studio.json`을 좁힌다. 형태가 어긋나면 `null`.
 *
 * 버전은 이 빌드가 아는 그 하나여야 한다. 모르는 버전을 "문자열이니 통과"로
 * 받아들이면, 뒤 판의 다른 뜻으로 적힌 연결을 이 판의 뜻으로 읽어 엉뚱한 그림을
 * 연결하거나 연결을 잃는다. 읽을 수 없다고 말하는 편이 낫다.
 */
export function parseStudioFileState(raw: unknown): StudioFileState | null {
  if (!isRecord(raw)) return null
  if (raw.version !== STUDIO_FILE_VERSION) return null

  const links = raw.productImages
  if (!isRecord(links)) return null
  const productImages: Record<string, string> = {}
  for (const [blockId, assetId] of Object.entries(links)) {
    // 값이 문자열이 아닌 연결은 가리키는 곳이 없다 — 조용히 버리지 않고 실패로 본다.
    if (typeof assetId !== 'string' || assetId.length === 0) return null
    productImages[blockId] = assetId
  }

  let source: StudioFileSource | null = null
  if (isRecord(raw.source)) {
    if (typeof raw.source.fingerprint !== 'string') return null
    source = {
      fingerprint: raw.source.fingerprint,
      importedAt: typeof raw.source.importedAt === 'number' ? raw.source.importedAt : 0,
      ...(typeof raw.source.fileName === 'string' ? { fileName: raw.source.fileName } : {}),
    }
  }

  return { version: STUDIO_FILE_VERSION, source, productImages }
}
