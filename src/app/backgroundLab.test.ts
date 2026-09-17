/**
 * 배경 후보의 규칙 (배경 후보 Patch, 2026-09-17). 화면 흐름은 `studioWorkspace.test.tsx` §3-5.
 */
import { describe, expect, it } from 'vitest'
import {
  SCENE_CANDIDATE_LIMIT,
  pickSceneProducts,
  readBackgroundLabs,
  remapLabs,
  sceneReference,
  withCandidate,
  dropMissingLabAssets,
  type SceneCandidate,
} from '../domain/backgroundLab'
import { createBlock } from '../domain/factory'
import { createPage } from '../domain/pageSchema'

const cand = (n: number): SceneCandidate => ({ id: `c${String(n)}`, assetId: `a${String(n)}`, note: '', basis: 'none', createdAt: n })

describe('§BL1 보여 줄 제품', () => {
  it('takes linked image blocks, largest first, at most two, each picture once', () => {
    const page = createPage({ title: 'p' })
    page.blocks = [
      createBlock('main_product_image', { id: 's', position: { x: 0, y: 0, width: 100, height: 100 } }),
      createBlock('main_product_image', { id: 'l', position: { x: 0, y: 0, width: 400, height: 400 } }),
      createBlock('main_product_image', { id: 'm', position: { x: 0, y: 0, width: 200, height: 200 } }),
      createBlock('main_product_image', { id: 'dup', position: { x: 0, y: 0, width: 300, height: 300 } }),
      createBlock('main_product_image', { id: 'none', position: { x: 0, y: 0, width: 900, height: 900 } }),
      createBlock('free_text', { id: 't', content: '글' }),
    ]
    const links = { s: 'as', l: 'al', m: 'am', dup: 'al' }
    expect(pickSceneProducts(page, links)).toEqual(['al', 'am'])
    expect(pickSceneProducts(page, {})).toEqual([])
  })
})

describe('§BL2 분위기 그림', () => {
  it('prefers the attached picture, then the style reference, else none', () => {
    expect(sceneReference({ candidates: [], referenceAssetId: 'att' }, 'sty')).toEqual({ assetId: 'att', basis: 'attached' })
    expect(sceneReference({ candidates: [] }, 'sty')).toEqual({ assetId: 'sty', basis: 'style' })
    expect(sceneReference({ candidates: [] }, undefined)).toBeNull()
  })
})

describe('§BL3 쌓기', () => {
  it('puts the newest first and drops the oldest past the limit, never the applied one', () => {
    let lab = { candidates: [] as SceneCandidate[] }
    for (let n = 0; n < SCENE_CANDIDATE_LIMIT; n += 1) lab = withCandidate(lab, cand(n), 'a0')
    expect(lab.candidates[0]!.id).toBe(`c${String(SCENE_CANDIDATE_LIMIT - 1)}`)
    lab = withCandidate(lab, cand(100), 'a0')
    expect(lab.candidates).toHaveLength(SCENE_CANDIDATE_LIMIT)
    // 가장 오래된 a0은 적용 중이라 남고, 그다음 오래된 a1이 빠졌다.
    expect(lab.candidates.some((c) => c.assetId === 'a0')).toBe(true)
    expect(lab.candidates.some((c) => c.assetId === 'a1')).toBe(false)
  })

  it('does not stack the same picture twice', () => {
    const lab = withCandidate(withCandidate({ candidates: [] }, cand(1)), { ...cand(1), id: 'again' })
    expect(lab.candidates.map((c) => c.id)).toEqual(['again'])
  })
})

describe('§BL4 작업 파일', () => {
  it('reads what it can and drops candidates that point nowhere', () => {
    const labs = readBackgroundLabs({
      p1: {
        referenceAssetId: 'r',
        candidates: [
          { id: 'x', assetId: 'a', note: '말', basis: 'attached', createdAt: 5, requestedSize: '832x1184' },
          { id: 'y', note: '그림 없음' },
          { assetId: 'b', basis: '이상한 값' },
          'junk',
        ],
      },
      p2: 'junk',
    })
    expect(labs).toEqual({
      p1: {
        referenceAssetId: 'r',
        candidates: [
          { id: 'x', assetId: 'a', note: '말', basis: 'attached', createdAt: 5, requestedSize: '832x1184' },
          { id: 'cand_b', assetId: 'b', note: '', basis: 'none', createdAt: 0 },
        ],
      },
    })
    expect(readBackgroundLabs(undefined)).toEqual({})
  })

  it('remaps and drops missing pictures together with the reference', () => {
    const labs = { p: { referenceAssetId: 'r', candidates: [cand(1), cand(2)] } }
    expect(remapLabs(labs, new Map([['a1', 'n1'], ['r', 'nr']]))).toEqual({
      p: { referenceAssetId: 'nr', candidates: [{ ...cand(1), assetId: 'n1' }, cand(2)] },
    })
    const gone: string[] = []
    const kept = dropMissingLabAssets(labs, (kind, id) => {
      const lost = id === 'a2' || id === 'r'
      if (lost) gone.push(`${kind}:${id}`)
      return lost
    })
    expect(kept).toEqual({ p: { candidates: [cand(1)] } })
    expect(gone).toEqual(['sceneReference:r', 'sceneCandidate:a2'])
  })
})
