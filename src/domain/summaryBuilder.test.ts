import { describe, it, expect } from 'vitest'
import { buildBriefFile, buildDesignSummary, buildPublishingInfo } from './summaryBuilder'
import { sampleDiscountBrief } from '../fixtures/sampleBrief'
import { createBlock, createEmptyBrief } from './factory'
import type { BriefBlock } from './briefSchema'

describe('buildDesignSummary', () => {
  const summary = buildDesignSummary(sampleDiscountBrief)

  it('extracts the main headline, period and discount rate', () => {
    expect(summary.mainHeadline).toBe('롬프 1+1 EVENT')
    expect(summary.period).toBe('2026.08.01 ~ 08.14')
    expect(summary.discountRate).toBe('최대 50% + 1개 추가 증정')
  })

  it('lists product images with their required flag', () => {
    expect(summary.requiredProducts).toHaveLength(2)
    const main = summary.requiredProducts.find((p) => p.blockId === 'blk_product_main')
    expect(main?.required).toBe(true)
    expect(main?.assetId).toBe('asset_rompf_switch_x')
  })

  it('collects benefits and CTA buttons', () => {
    expect(summary.requiredBenefits.map((b) => b.content)).toContain('1개 구매 시 동일 상품 1개 추가 증정')
    expect(summary.ctaButtons).toHaveLength(1)
    expect(summary.ctaButtons[0]?.text).toBe('지금 구매하기')
  })

  it('orders layout hints by order', () => {
    const orders = summary.layoutHints.map((h) => h.order)
    expect(orders).toEqual(orders.toSorted((a, b) => a - b))
  })
})

describe('publishing separation (WORK_PLAN Phase 5 gate)', () => {
  it('marks the CTA as linked without exposing the URL', () => {
    const summary = buildDesignSummary(sampleDiscountBrief)
    expect(summary.ctaButtons[0]?.hasLink).toBe(true)
    // The design summary must contain no publishing URL anywhere.
    expect(JSON.stringify(summary)).not.toContain('shop.example.com')
  })

  it('keeps the publishing URL only in PublishingInfo', () => {
    const publishing = buildPublishingInfo(sampleDiscountBrief)
    expect(publishing.links).toHaveLength(1)
    expect(publishing.links[0]?.url).toBe('https://shop.example.com/rompf-1plus1')
    expect(publishing.links[0]?.purpose).toBe('CTA 버튼 연결')
    expect(publishing.notes.map((n) => n.content)).toContain('기존 8월 배너와 톤 맞춰주세요.')
  })
})

describe('buildBriefFile', () => {
  it('produces a JSON-serializable payload that round-trips', () => {
    const file = buildBriefFile(sampleDiscountBrief)
    const roundTripped = JSON.parse(JSON.stringify(file))
    expect(roundTripped.project.title).toBe('롬프 1+1 EVENT')
    expect(roundTripped.blocks).toHaveLength(sampleDiscountBrief.blocks.length)
    expect(roundTripped.designSummary.mainHeadline).toBe('롬프 1+1 EVENT')
    expect(roundTripped.publishing.links).toHaveLength(1)
  })
})

describe('제품명은 작성자가 정한 것만 (v1 마감 교정)', () => {
  const imageBlock = (over: Partial<BriefBlock> = {}): BriefBlock => ({
    ...createBlock('main_product_image', {
      id: 'blk_img',
      label: '이미지',
      content: '아크웨이브 신제품 누끼 이미지',
    }),
    ...over,
  })

  const summarize = (blocks: BriefBlock[]) =>
    buildDesignSummary({ ...createEmptyBrief('의미 교정'), blocks })

  it('never turns the block\'s default name into a product', () => {
    const design = summarize([imageBlock()])
    // The wording the planner wrote belongs to the image slot, once.
    expect(design.imageSlots[0]!.description).toBe('아크웨이브 신제품 누끼 이미지')
    expect(design.requiredProducts).toHaveLength(0)
    expect(JSON.stringify(design)).not.toContain('"productName"')
  })

  it('never turns a reference capture\'s file name into a product', () => {
    const design = summarize([
      imageBlock({ assetId: 'asset_ref', image: { productName: 'capture', referenceOnly: true } }),
    ])
    expect(design.imageSlots[0]!.referenceAssetId).toBe('asset_ref')
    expect(design.imageSlots[0]!.referenceOnly).toBe(true)
    expect(design.requiredProducts).toHaveLength(0)
    expect(JSON.stringify(design)).not.toContain('capture')
    expect(design.verbatimImages.some((i) => i.assetId === 'asset_ref')).toBe(false)
  })

  it('keeps a product name a legacy document actually recorded', () => {
    const design = summarize([
      imageBlock({ assetId: 'asset_real', image: { productName: '아크웨이브 스위치X' } }),
    ])
    const product = design.requiredProducts[0]!
    expect(product.productName).toBe('아크웨이브 스위치X')
    expect(product.assetId).toBe('asset_real')
  })
})
