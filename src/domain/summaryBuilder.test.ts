import { describe, it, expect } from 'vitest'
import { buildBriefFile, buildDesignSummary, buildPublishingInfo } from './summaryBuilder'
import { sampleDiscountBrief } from '../fixtures/sampleBrief'

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
