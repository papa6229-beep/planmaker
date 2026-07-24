import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  resetAssetStoreForTests,
  clearAll,
  deleteAsset,
  getAllAssets,
  loadBrief,
  pruneAssets,
  putAsset,
  saveBrief,
  type StoredAsset,
} from './assetStore'
import { createEmptyBrief } from '../domain/factory'
import type { EventBrief } from '../domain/briefSchema'

function storedAsset(id: string): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    width: 10,
    height: 10,
    byteSize: 3,
  }
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
})

describe('brief snapshot persistence', () => {
  it('round-trips the brief and returns null when empty', async () => {
    expect(await loadBrief()).toBeNull()

    const brief: EventBrief = createEmptyBrief('테스트 기획서')
    await saveBrief(brief, 1_000)

    const loaded = await loadBrief()
    expect(loaded?.project.title).toBe('테스트 기획서')
  })

  it('overwrites the single snapshot row', async () => {
    await saveBrief(createEmptyBrief('첫번째'), 1)
    await saveBrief(createEmptyBrief('두번째'), 2)
    const loaded = await loadBrief()
    expect(loaded?.project.title).toBe('두번째')
  })
})

describe('asset binary persistence', () => {
  it('stores and returns asset blobs with metadata preserved', async () => {
    await putAsset(storedAsset('a1'))
    await putAsset(storedAsset('a2'))
    const all = await getAllAssets()
    expect(all.map((a) => a.id).toSorted()).toEqual(['a1', 'a2'])
    const a1 = all.find((a) => a.id === 'a1')!
    expect(a1.fileName).toBe('a1.png')
    expect(a1.mimeType).toBe('image/png')
    expect(a1.byteSize).toBe(3)
    // Blob binary fidelity is verified in the browser (fake-indexeddb does not
    // fully model Blob); here we only assert the record round-trips.
    expect(a1.blob).toBeDefined()
  })

  it('deletes a single asset', async () => {
    await putAsset(storedAsset('a1'))
    await deleteAsset('a1')
    expect(await getAllAssets()).toHaveLength(0)
  })

  it('prunes assets not referenced by the brief', async () => {
    await putAsset(storedAsset('keep'))
    await putAsset(storedAsset('orphan'))
    await pruneAssets(['keep'])
    const remaining = (await getAllAssets()).map((a) => a.id)
    expect(remaining).toEqual(['keep'])
  })
})
