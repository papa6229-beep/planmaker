/**
 * 완성본의 조각으로 배너를 만든다 (배너 Patch §3).
 *
 * 저장 파일에는 합쳐진 완성본 그림이 들어 있지 않다. 배경과 블록별 조각이 들어
 * 있고, `완성본 다시 합치기`가 그것들로 다시 그린다. 배너도 **같은 조각을 다른
 * 자리에 놓는 일**이라, 파일 하나만 있으면 크레딧 없이 몇 번이든 다시 뽑을 수 있다.
 *
 * 그 성질이 성립하는지를 여기서 붙든다. 조각을 다시 만들면 — 자산 번호가 바뀌면 —
 * 그것은 다시 놓은 것이 아니라 다시 그린 것이고, 배너를 뽑을 때마다 돈이 든다.
 *
 * 그리고 하나 더. **조각이 없는 블록**을 조용히 넘기지 않는지. 문구 조각이 생기기
 * 전에 저장한 파일을 열면 제목의 그림이 없는데, 그때 아무 말 없이 빈 배너가
 * 나가는 것이 이 기능에서 가장 나쁜 결말이다.
 */

import { describe, it, expect } from 'vitest'
import { DEMOTED_OPACITY, DEMOTED_TONE, buildBanner, readableSlots, type BannerPieces } from '../domain/bannerComposite'
import { BANNER_1020x70 } from '../domain/bannerSpec'
import { bannerPageId } from '../domain/bannerFit'
import { documentFingerprint } from '../domain/documentFingerprint'
import { createBlock, createEmptyProject } from '../domain/factory'
import type { BriefBlock } from '../domain/briefSchema'
import type { BlockType } from '../domain/blockTypes'
import type { BriefPage } from '../domain/pageSchema'
import type { StudioTextObject } from '../domain/textObjects'

const SPEC = BANNER_1020x70

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

function piece(blockId: string, assetId: string, layer = 0): StudioTextObject {
  return { blockId, assetId, rect: { x: 100, y: 200, width: 400, height: 120 }, layer }
}

const BARE: BannerPieces = { productImages: {}, effects: {} }

describe('§33-1 조각을 다시 놓는다', () => {
  const source = page([block('main_headline', 'title'), block('cta_button', 'cta')])
  const pieces: BannerPieces = {
    ...BARE,
    textObjects: [piece('title', 'asset-title', 3), piece('cta', 'asset-cta', 5)],
  }

  it('조각을 다시 만들지 않는다 — 같은 그림이 그대로 간다', () => {
    // 자산 번호가 바뀌면 그것은 다시 놓은 것이 아니라 다시 그린 것이고, 배너를
    // 뽑을 때마다 돈이 든다.
    const { plan } = buildBanner(source, SPEC, pieces)
    expect(plan.textObjects?.map((t) => t.assetId).toSorted()).toEqual(['asset-cta', 'asset-title'])
  })

  it('조각이 배너 자리로 옮겨진다', () => {
    const { plan, fit } = buildBanner(source, SPEC, pieces)
    const placed = fit.placements.find((p) => p.blockId === 'title')!
    const drawn = plan.textObjects!.find((t) => t.assetId === 'asset-title')!
    // 원본 자리(100,200,400×120)가 아니라 배너 자리여야 한다.
    expect(drawn.rect).toEqual(placed.rect)
  })

  it('앞뒤 차례는 완성본의 것을 그대로 쓴다', () => {
    // 배너에서만 문구의 앞뒤가 뒤집히면 완성본과 다른 그림이 된다.
    const { plan } = buildBanner(source, SPEC, pieces)
    expect(plan.textObjects!.find((t) => t.assetId === 'asset-cta')!.order).toBe(5)
  })

  it('모델을 한 번도 부르지 않는다', () => {
    // 이 값이 0이 아니게 되는 날, 배너 다섯 장이 다섯 번의 호출이 된다.
    expect(buildBanner(source, SPEC, pieces).plan.externalCalls).toBe(0)
  })

  it('계획의 크기가 배너 규격이다', () => {
    const { plan, page: banner } = buildBanner(source, SPEC, pieces)
    expect(plan.size).toEqual({ width: 1020, height: 70 })
    expect([banner.canvasWidth, banner.canvasHeight]).toEqual([1020, 70])
  })

  it('같은 문구를 두 번 그리지 않는다', () => {
    // 조각이 이미 꾸며진 글자를 그린다. 합성기가 맨글씨로 한 번 더 그리면 겹친다.
    expect(buildBanner(source, SPEC, pieces).plan.texts).toEqual([])
  })
})

describe('§33-2 조각이 없으면 말한다', () => {
  it('문구 조각이 없는 파일이면 그 블록들을 이름으로 알린다', () => {
    // 문구 조각이 생기기 전(파일 0.6.0 미만)에 저장한 파일이 이렇다. 조용히
    // 넘기면 제목 없는 배너가 그대로 나간다.
    const { missingPieces } = buildBanner(page([block('main_headline', 'title')]), SPEC, BARE)
    expect(missingPieces).toEqual(['title'])
  })

  it('조각이 다 있으면 아무 말도 하지 않는다', () => {
    const source = page([block('main_headline', 'title'), imageBlock('photo', 'asset-photo')])
    const { missingPieces } = buildBanner(source, SPEC, {
      ...BARE,
      textObjects: [piece('title', 'asset-title')],
    })
    expect(missingPieces).toEqual([])
  })

  it('배너에 가지 않는 블록은 없는 조각으로 세지 않는다', () => {
    // 주의 문구는 애초에 배너에 갈 것이 아니다. 이것까지 세면 경고가 늘 켜져 있어
    // 아무도 안 읽게 된다.
    const source = page([block('main_headline', 'title'), block('caution_text', 'notice')])
    const { missingPieces } = buildBanner(source, SPEC, {
      ...BARE,
      textObjects: [piece('title', 'asset-title')],
    })
    expect(missingPieces).toEqual([])
  })

  it('그림이 연결된 이미지 블록은 조각이 있는 것으로 본다', () => {
    const source = page([imageBlock('photo', 'asset-photo')])
    expect(buildBanner(source, SPEC, BARE).missingPieces).toEqual([])
  })
})

describe('§33-3 배경과 강등', () => {
  const source = page([block('main_headline', 'title')])

  it('잘라 쓸 자리를 주면 계획에 실린다', () => {
    const crop = { x: 0, y: 520, width: 840, height: 58 }
    const { plan } = buildBanner(source, SPEC, BARE, { backgroundCrop: crop })
    expect(plan.backgroundCrop).toEqual(crop)
  })

  it('주지 않으면 지금까지와 같다', () => {
    // 없으면 합성기가 가운데를 채워 쓴다 — 배너가 아닌 길은 달라지지 않아야 한다.
    expect(buildBanner(source, SPEC, BARE).plan.backgroundCrop).toBeUndefined()
  })

  it('배경으로 내려간 조각은 눌러서, 그리고 비치게 깐다', () => {
    // 이벤트3의 가차 기계. 브라우저에서 실제로 본 것 — 톤만 눌러서는 안 된다.
    // 밝기를 올려도 불투명한 그림은 뒤를 가리고, 눌러 놓은 기계가 그대로 제목을
    // 덮었다. 배경으로 내린다는 것은 **뒤에 비친다**는 뜻이다.
    const gacha = page([imageBlock('gacha', 'asset-gacha', { width: 330, height: 470 })])
    const { plan, fit } = buildBanner(gacha, SPEC, BARE)
    expect(fit.background).toEqual(['gacha'])
    const layer = plan.layers.find((l) => l.blockId === 'gacha')!
    expect(layer.tone).toEqual(DEMOTED_TONE)
    expect(layer.opacity).toBe(DEMOTED_OPACITY)
    expect(DEMOTED_OPACITY).toBeLessThan(0.5)
  })

  it('자리를 얻은 조각은 진하기를 건드리지 않는다', () => {
    // 배경으로 내린 것에만 거는 값이다. 앞에 선 제품까지 비치면 아무것도 안 보인다.
    const { plan } = buildBanner(page([imageBlock('photo', 'asset-photo')]), SPEC, BARE)
    expect(plan.layers.find((l) => l.blockId === 'photo')!.opacity).toBeUndefined()
  })

  it('글자가 놓일 자리를 배경 고르기에 넘길 수 있다', () => {
    // `quietRegion`이 "글자 밑이 잔잔한 자리"를 고르려면 글자가 어디 놓이는지를
    // 알아야 한다. 규격의 자리가 이미 0~1 비율이라 그대로 넘어간다.
    const slots = readableSlots(SPEC)
    expect(slots).toHaveLength(SPEC.slots.length)
    for (const slot of slots) {
      expect(slot.x + slot.width).toBeLessThanOrEqual(1)
      expect(slot.y + slot.height).toBeLessThanOrEqual(1)
    }
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
describe('§33-4 배너 페이지는 기획서 지문에 들어가지 않는다', () => {
  function docOf(pages: BriefPage[]): Parameters<typeof documentFingerprint>[0] {
    return { schemaVersion: '2.0.0', project: createEmptyProject('지문'), pages, activePageId: pages[0]!.id, assets: [] }
  }
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
