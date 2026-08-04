/**
 * 이 브라우저의 자료 초기화 (첫 사용 흐름 §5).
 *
 * 저장은 이 브라우저 안에만 있다. 다른 컴퓨터와 공유되지 않으므로, 초기화는
 * "이 브라우저에서 지운다"는 뜻이고 되돌릴 수 없다. 그래서 지우기 전에 몇 건이
 * 사라지는지 셀 수 있어야 한다.
 *
 * 작성기는 기획서와 그 기획서만 쓰는 이미지를 지운다. 이미지 blob은 기획서와
 * 전달 스냅숏이 함께 쓰는 하나의 풀이므로, **남은 쪽이 아직 쓰는 것은 지우지
 * 않는다** — 정리는 언제나 "아무도 참조하지 않는 것"만 걷어낸다.
 *
 * 화면은 IndexedDB를 직접 만지지 않는다. 여기가 그 경계다.
 */

import { clearBriefSnapshots, pruneAssets } from './assetStore'
import { allDocumentAssetIds, clearAllDocuments, listDocuments } from './documentStore'
import { allRequestAssetIds } from './requestStore'

export interface StorageCount {
  /** 지워질 기획서(또는 작업) 수. */
  briefs: number
  /** 그 자료만 쓰고 있는 이미지 수. */
  images: number
}

/** 작성기에서 지워질 것: 이 브라우저의 기획서와, 기획서만 쓰는 이미지. */
export async function countWriterStorage(): Promise<StorageCount> {
  const briefs = await listDocuments()
  const owned = new Set(await allDocumentAssetIds())
  for (const id of await allRequestAssetIds()) owned.delete(id)
  return { briefs: briefs.length, images: owned.size }
}

/**
 * 이 브라우저의 기획서를 전부 지운다.
 *
 * 옛 단일 자동저장 행까지 함께 비운다 — 남겨 두면 다음 시작에서 그 한 건이
 * 보관함으로 다시 올라와 "지웠는데 하나 남아 있다"가 된다.
 */
export async function resetWriterStorage(): Promise<void> {
  await clearAllDocuments()
  await clearBriefSnapshots()
  const keep = new Set<string>()
  for (const id of await allRequestAssetIds()) keep.add(id)
  await pruneAssets(keep)
}
