/**
 * Studio 작업 저장소 (이미지 생성기 0단계 §7).
 *
 * 작성기 보관함(`event-brief-documents`)과 물리적으로 다른 데이터베이스다.
 * Studio가 무엇을 저장하든 작성기 문서를 덮어쓸 수 없고, 반대도 마찬가지다.
 *
 * 0단계의 작업은 한 건이다(`STUDIO_JOB_ID`). 생성 결과와 버전을 담을 구조는
 * 아직 만들지 않는다 — 지금 필요한 것은 원본과 디자인팀 자료의 경계뿐이다.
 */

import Dexie, { type Table } from 'dexie'
import { watchSave } from './watchSave'
import { studioLiveAssetIds, type StudioJob } from '../domain/studioJob'
import { normalizeReferenceLayer } from '../domain/pageSchema'

/** 0단계의 단일 작업 행. */
export const STUDIO_JOB_ID = 'studio_current'

class StudioDB extends Dexie {
  jobs!: Table<StudioJob, string>

  constructor() {
    super('event-brief-studio')
    this.version(1).stores({ jobs: 'id, updatedAt' })
  }
}

let dbInstance: StudioDB | null = null

function db(): StudioDB {
  dbInstance ??= new StudioDB()
  return dbInstance
}

/** 테스트 이음매: 새 fake-indexeddb를 집도록 캐시된 핸들을 버린다. */
export function resetStudioStoreForTests(): void {
  dbInstance = null
}

export async function clearAllStudioJobs(): Promise<void> {
  await db().jobs.clear()
}

/**
 * 저장된 작업 한 건.
 *
 * 작업본 문서는 보관함을 지나지 않으므로 작성기 쪽 정규화가 닿지 않는다. 예전
 * 판에서 저장된 행에는 없어진 참고 이미지 보기 방식이 그대로 남아 있을 수 있어,
 * 읽는 자리에서 한 번 접어 준다 (1단계 §4). 저장된 값을 고쳐 쓰는 것이 아니라
 * 화면이 쓸 모양으로만 좁히는 것이므로, 참고 이미지도 연결도 그대로다.
 */
export async function loadStudioJob(id: string): Promise<StudioJob | null> {
  const row = await db().jobs.get(id)
  if (row === undefined) return null
  return {
    ...row,
    doc: {
      ...row.doc,
      pages: row.doc.pages.map((page) => ({ ...page, reference: normalizeReferenceLayer(page.reference) })),
    },
  }
}

export async function saveStudioJob(job: StudioJob): Promise<void> {
  await watchSave('studio', job.updatedAt, () => db().jobs.put(job))
}

/**
 * Studio가 아직 쓰고 있는 자산 id 전부 — 연결한 제품 이미지와, 작업본 문서가
 * 쓰는 이미지까지.
 *
 * 자산 blob 저장소는 작성기·전달 스냅숏·Studio가 함께 쓰는 하나의 풀이고,
 * 정리(prune)는 "아무도 참조하지 않는 것"을 지운다. Studio가 연결한 누끼는
 * 기획서 문서에 적히지 않고, 작업본 문서는 보관함의 어느 행도 아니다. 그래서
 * 이 목록이 없으면 다른 쪽 정리가 남의 작업물을 지운다.
 */
export async function allStudioAssetIds(): Promise<string[]> {
  const jobs = await db().jobs.toArray()
  const ids = new Set<string>()
  for (const job of jobs) for (const id of studioLiveAssetIds(job)) ids.add(id)
  return [...ids]
}
