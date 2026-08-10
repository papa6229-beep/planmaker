/**
 * 배너의 첫 화면은 배경뿐이다 (배너 Patch §3, 자동 배치 제거 Patch).
 *
 * 저장 파일에는 합쳐진 완성본 그림이 들어 있지 않다. 배경과 블록별 조각이 들어
 * 있고, `완성본 다시 합치기`가 그것들로 다시 그린다. 배너도 **같은 조각을 다른
 * 자리에 놓는 일**이라, 파일 하나만 있으면 크레딧 없이 몇 번이든 다시 뽑을 수 있다.
 *
 * 다만 **처음부터 놓아 주지는 않는다.** 배너는 작고, 자동이 놓은 자리를 고치는
 * 것이 처음부터 놓는 것보다 오래 걸린다는 것이 실물을 보고 확인된 사실이다.
 * 그래서 여기서 붙드는 것은 "조각이 하나도 실리지 않았는가"이다 — 하나라도 실리면
 * 걷어낸 자동 배치가 어딘가에서 돌아온 것이다.
 */

import { describe, it, expect } from 'vitest'
import { buildBanner } from '../domain/bannerComposite'
import { bannerPageId, sourcePageIdOf } from '../domain/bannerFit'
import { bannerSpecById, customBannerSpec } from '../domain/bannerSpec'
import { documentFingerprint } from '../domain/documentFingerprint'
import { createBlock, createEmptyProject } from '../domain/factory'
import type { BriefBlock } from '../domain/briefSchema'
import type { BlockType } from '../domain/blockTypes'
import type { BriefPage } from '../domain/pageSchema'

const SPEC = bannerSpecById('1020x70')!

function block(type: BlockType, id: string, size = { width: 300, height: 100 }): BriefBlock {
  return createBlock(type, { id, content: id, position: { x: 40, y: 40, ...size } })
}

function imageBlock(id: string, assetId: string, size = { width: 300, height: 100 }): BriefBlock {
  return createBlock('main_product_image', { id, assetId, position: { x: 0, y: 0, ...size } })
}

function page(blocks: BriefBlock[]): BriefPage {
  return {
    id: 'source',
    title: '텐가 사고 선물받자',
    blocks,
    canvasWidth: 840,
    canvasHeight: 1180,
    reference: { viewMode: 'canvas', opacity: 0.35, fit: 'width', visible: false },
  }
}

const SOURCE = page([
  block('main_headline', 'title'),
  block('cta_button', 'cta'),
  imageBlock('hero', 'asset-hero'),
])

describe('§33-1 첫 화면에는 조각이 없다', () => {
  it('아무 겹도 그리지 않는다', () => {
    // 하나라도 실리면 걷어낸 자동 배치가 돌아온 것이다.
    expect(buildBanner(SOURCE, SPEC, {}).plan.layers).toEqual([])
  })

  it('그릴 그림이 달린 블록이 있어도 실리지 않는다', () => {
    // `hero`에는 `assetId`가 달려 있다. 목록을 비워 두지 않으면 이것이 그려진다.
    const { plan } = buildBanner(SOURCE, SPEC, {})
    expect(plan.layers.some((l) => l.blockId.endsWith('__hero'))).toBe(false)
  })

  it('계획의 크기가 규격이다', () => {
    expect(buildBanner(SOURCE, SPEC, {}).plan.size).toEqual({ width: SPEC.width, height: SPEC.height })
  })

  it('배경은 그대로 깔린다', () => {
    const { plan } = buildBanner(SOURCE, SPEC, { background: { assetId: 'asset-bg', source: 'ai' } })
    expect(plan.background?.assetId).toBe('asset-bg')
  })

  it('배경이 없으면 없는 대로 간다', () => {
    expect(buildBanner(SOURCE, SPEC, {}).plan.background).toBeUndefined()
  })

  it('종이 두께는 따라온다', () => {
    // 완성본과 같은 결이어야 한다. 배너만 매끈하면 나란히 놓았을 때 튄다.
    expect(buildBanner(SOURCE, SPEC, { grain: 0.4 }).plan.grain).toBe(0.4)
  })

  it('페이지에는 블록이 전부 있다', () => {
    // 올린 조각은 0개지만 블록은 전부 있어야 서랍에서 꺼낸 이미지가 그려진다.
    expect(buildBanner(SOURCE, SPEC, {}).page.blocks).toHaveLength(SOURCE.blocks.length)
  })
})

/**
 * 배너는 기획서가 아니다 (배너 Patch §5).
 *
 * 문서 지문이 답하는 물음은 "**기획서**가 달라졌는가"이고, 그 답으로 완성본이
 * 오래되었는지를 판정한다. 배너는 완성본에서 파생된 결과물이지 기획서가 아니다.
 * 세면 배너 하나를 뽑았을 뿐인데 **메인 이벤트 페이지의 완성본까지** 오래된 것으로
 * 표시된다 — 실제로 화면에 그 경고가 떴다.
 */
describe('§33-2 배너 페이지는 기획서 지문에 들어가지 않는다', () => {
  const docOf = (pages: BriefPage[]): Parameters<typeof documentFingerprint>[0] => ({
    schemaVersion: '2.0.0',
    project: createEmptyProject('지문'),
    pages,
    activePageId: pages[0]!.id,
    assets: [],
  })
  const eventPage = page([block('main_headline', 'title')])
  const banner = (): BriefPage => ({
    ...page([block('main_headline', 'title')]),
    id: bannerPageId(eventPage.id, '1020x70'),
    canvasWidth: 1020,
    canvasHeight: 70,
  })

  it('배너를 더해도 지문이 그대로다', () => {
    expect(documentFingerprint(docOf([eventPage, banner()]))).toBe(documentFingerprint(docOf([eventPage])))
  })

  it('이벤트 페이지를 더하면 지문이 달라진다', () => {
    // 배너만 빼는 것이지 페이지를 세지 않는 것이 아니다.
    const second: BriefPage = { ...page([block('cta_button', 'cta')]), id: 'page_2' }
    expect(documentFingerprint(docOf([eventPage, second]))).not.toBe(documentFingerprint(docOf([eventPage])))
  })
})

describe('§33-3 임의 크기', () => {
  it('크기만 적으면 규격이 된다', () => {
    const spec = customBannerSpec(640, 200)!
    expect([spec.width, spec.height]).toEqual([640, 200])
    expect(spec.siblings).toEqual([])
  })

  it('말이 안 되는 크기는 만들지 않는다', () => {
    for (const [w, h] of [[0, 100], [100, 0], [-5, 5], [99_999, 100], [Number.NaN, 10]]) {
      expect(customBannerSpec(w!, h!)).toBeNull()
    }
  })

  it('번호로 되찾을 수 있다', () => {
    const spec = customBannerSpec(640, 200)!
    expect(bannerSpecById(spec.id)).toEqual(spec)
    expect(sourcePageIdOf(bannerPageId('page_abc', spec.id), spec.id)).toBe('page_abc')
  })

  it('임의 크기도 캔버스가 그 크기다', () => {
    const spec = customBannerSpec(640, 200)!
    expect(buildBanner(SOURCE, spec, {}).plan.size).toEqual({ width: 640, height: 200 })
  })
})
