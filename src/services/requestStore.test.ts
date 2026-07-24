/**
 * Work-request repository persistence (WORK_PLAN §17.25 — the request list must
 * survive a restart). Uses a fresh fake IndexedDB per test.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  allRequestAssetIds,
  clearAllRequests,
  deleteRequest,
  getRequest,
  listRequests,
  putRequest,
  resetRequestStoreForTests,
} from './requestStore'
import { createWorkRequest, withStatus } from '../domain/workRequest'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyBrief } from '../domain/factory'

function docWithAsset() {
  const doc = createEmptyDocument(createEmptyBrief('요청 기획서').project)
  doc.pages[0]!.blocks = [createBlock('main_product_image', { id: 'b', assetId: 'asset_9' })]
  doc.assets = [{ id: 'asset_9', fileName: 'x.png', mimeType: 'image/png', byteSize: 4 }]
  return doc
}

beforeEach(async () => {
  resetRequestStoreForTests()
  await clearAllRequests()
})

describe('requestStore', () => {
  it('persists a request and reloads it (restart survival)', async () => {
    const req = createWorkRequest('req_1', docWithAsset(), '2026-07-24T00:00:00Z')
    await putRequest(req)

    // Simulate a restart: drop the cached DB handle, then read again.
    resetRequestStoreForTests()
    const all = await listRequests()
    expect(all).toHaveLength(1)
    expect(all[0]!.id).toBe('req_1')
    expect(all[0]!.status).toBe('submitted')
    expect(all[0]!.submittedDoc.project.title).toBe('요청 기획서')
  })

  it('updates status in place', async () => {
    const req = createWorkRequest('req_2', docWithAsset(), 't')
    await putRequest(req)
    await putRequest(withStatus(req, 'in_progress', 't2'))
    expect((await getRequest('req_2'))!.status).toBe('in_progress')
  })

  it('lists newest-submitted first', async () => {
    await putRequest(createWorkRequest('a', docWithAsset(), '2026-01-01T00:00:00Z'))
    await putRequest(createWorkRequest('b', docWithAsset(), '2026-03-01T00:00:00Z'))
    expect((await listRequests()).map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('reports asset ids referenced by stored requests', async () => {
    await putRequest(createWorkRequest('c', docWithAsset(), 't'))
    expect(await allRequestAssetIds()).toContain('asset_9')
  })

  it('deletes a request', async () => {
    await putRequest(createWorkRequest('d', docWithAsset(), 't'))
    await deleteRequest('d')
    expect(await listRequests()).toHaveLength(0)
  })

  it('keeps the submitted snapshot separate from an edited working copy (§17.8)', async () => {
    const req = createWorkRequest('e', docWithAsset(), 't')
    const working = { ...req.submittedDoc, project: { ...req.submittedDoc.project, title: '작업 중 제목' } }
    await putRequest({ ...req, workingDoc: working })

    const reloaded = (await getRequest('e'))!
    expect(reloaded.workingDoc!.project.title).toBe('작업 중 제목')
    expect(reloaded.submittedDoc.project.title).toBe('요청 기획서') // snapshot untouched
  })
})
