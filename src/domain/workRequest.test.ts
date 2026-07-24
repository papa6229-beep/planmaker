import { describe, it, expect } from 'vitest'
import {
  computeStats,
  createWorkRequest,
  pageCount,
  requestAssetIds,
  withStatus,
} from './workRequest'
import { createEmptyDocument, createPage } from './pageSchema'
import { createBlock, createEmptyBrief } from './factory'

function sampleDoc() {
  const doc = createEmptyDocument(createEmptyBrief('여름 캠페인').project)
  const img = createBlock('main_product_image', { id: 'blk_i', assetId: 'asset_1', position: { x: 0, y: 0, width: 100, height: 100 } })
  doc.pages[0]!.blocks = [img]
  doc.pages[0]!.reference = { ...doc.pages[0]!.reference, assetId: 'asset_ref' }
  doc.pages.push(createPage({ title: '2페이지' }))
  doc.assets = [{ id: 'asset_1', fileName: 'a.png', mimeType: 'image/png', byteSize: 4 }]
  return doc
}

describe('createWorkRequest', () => {
  it('creates a submitted request with a deep-cloned immutable snapshot', () => {
    const doc = sampleDoc()
    const req = createWorkRequest('req_1', doc, '2026-07-24T00:00:00Z')
    expect(req.status).toBe('submitted')
    expect(req.title).toBe('여름 캠페인')
    expect(pageCount(req)).toBe(2)

    // Mutating the live doc must not touch the snapshot.
    doc.pages[0]!.blocks[0]!.content = '바뀐 내용'
    doc.project.title = '바뀐 제목'
    expect(req.submittedDoc.pages[0]!.blocks[0]!.content).not.toBe('바뀐 내용')
    expect(req.submittedDoc.project.title).toBe('여름 캠페인')
  })

  it('falls back to a placeholder title when the project title is blank', () => {
    const doc = createEmptyDocument(createEmptyBrief('').project)
    const req = createWorkRequest('r', doc, 't')
    expect(req.title).toBe('제목 없는 기획서')
  })
})

describe('withStatus', () => {
  it('changes status and stamps completedAt only on 완료', () => {
    const req = createWorkRequest('r', sampleDoc(), 't0')
    const working = withStatus(req, 'in_progress', 't1')
    expect(working.status).toBe('in_progress')
    expect(working.completedAt).toBeUndefined()
    expect(working.updatedAt).toBe('t1')

    const done = withStatus(working, 'completed', 't2')
    expect(done.completedAt).toBe('t2')

    const reopened = withStatus(done, 'in_progress', 't3')
    expect(reopened.completedAt).toBeUndefined()
  })
})

describe('computeStats', () => {
  it('counts requests by status', () => {
    const d = sampleDoc()
    const reqs = [
      createWorkRequest('1', d, 't'),
      withStatus(createWorkRequest('2', d, 't'), 'in_progress', 't'),
      withStatus(createWorkRequest('3', d, 't'), 'in_progress', 't'),
      withStatus(createWorkRequest('4', d, 't'), 'completed', 't'),
    ]
    const s = computeStats(reqs)
    expect(s).toMatchObject({ submitted: 1, in_progress: 2, completed: 1, reviewed: 0, total: 4 })
  })
})

describe('requestAssetIds', () => {
  it('collects asset ids from blocks, reference layers, and the pool of both docs', () => {
    const req = createWorkRequest('r', sampleDoc(), 't')
    req.workingDoc = req.submittedDoc
    const ids = new Set(requestAssetIds(req))
    expect(ids.has('asset_1')).toBe(true)
    expect(ids.has('asset_ref')).toBe(true)
  })
})
