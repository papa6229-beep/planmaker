/**
 * Sample fixture (WORK_PLAN §19 Phase 1, §20 Scenario A).
 *
 * A "롬프 1+1" discount event: main headline, discount rate, period, two
 * product images (one required), a CTA button, and a publishing-only button
 * URL. Demonstrates that design and publishing information are cleanly
 * separated without any fixed template (§3.5, §22).
 *
 * More scenario fixtures (텐가 할인 / 우머나이저 무료체험단 / 기존 페이지 수정) are
 * planned for Phase 7 and intentionally not built here.
 */

import { createBlock } from '../domain/factory'
import type { Asset, EventBrief } from '../domain/briefSchema'
import { SCHEMA_VERSION } from '../domain/briefSchema'

const productAsset: Asset = {
  id: 'asset_rompf_switch_x',
  fileName: 'rompf-switch-x.png',
  mimeType: 'image/png',
  width: 800,
  height: 800,
}

const secondaryAsset: Asset = {
  id: 'asset_rompf_pico',
  fileName: 'rompf-pico.png',
  mimeType: 'image/png',
  width: 800,
  height: 800,
}

export const sampleDiscountBrief: EventBrief = {
  schemaVersion: SCHEMA_VERSION,
  project: {
    title: '롬프 1+1 EVENT',
    requestTeam: '마케팅팀',
    author: '기획자',
    createdAt: '2026-07-23',
    eventType: '할인전',
    outputType: 'event_page',
    canvasWidth: 840,
    canvasHeight: 2400,
    conceptNote: '1+1 구성을 크게 강조하고 제품 2종을 나란히 배치',
  },
  blocks: [
    createBlock('main_headline', {
      id: 'blk_main',
      content: '롬프 1+1 EVENT',
      required: true,
      priority: 1,
      position: { x: 120, y: 80, width: 600, height: 160 },
      layoutHint: { region: 'top', alignment: 'center', emphasis: 'very_high', order: 0 },
    }),
    createBlock('discount_rate', {
      id: 'blk_discount',
      content: '최대 50% + 1개 추가 증정',
      required: true,
      priority: 2,
      position: { x: 220, y: 280, width: 400, height: 90 },
      layoutHint: { region: 'top', alignment: 'center', emphasis: 'high', order: 1 },
    }),
    createBlock('period', {
      id: 'blk_period',
      content: '2026.08.01 ~ 08.14',
      required: true,
      priority: 3,
      position: { x: 260, y: 390, width: 320, height: 60 },
      layoutHint: { region: 'top', alignment: 'center', order: 2 },
    }),
    createBlock('main_product_image', {
      id: 'blk_product_main',
      label: '롬프 스위치 X',
      required: true,
      priority: 2,
      assetId: productAsset.id,
      groupId: 'grp_products',
      position: { x: 80, y: 520, width: 320, height: 320 },
      layoutHint: { region: 'middle', alignment: 'left', emphasis: 'high', order: 3 },
    }),
    createBlock('sub_product_image', {
      id: 'blk_product_sub',
      label: '롬프 피코',
      required: false,
      priority: 3,
      assetId: secondaryAsset.id,
      groupId: 'grp_products',
      position: { x: 440, y: 520, width: 320, height: 320 },
      layoutHint: { region: 'middle', alignment: 'right', order: 4 },
    }),
    createBlock('benefit', {
      id: 'blk_benefit',
      content: '1개 구매 시 동일 상품 1개 추가 증정',
      required: true,
      priority: 2,
      position: { x: 120, y: 900, width: 600, height: 80 },
      layoutHint: { region: 'middle', alignment: 'center', order: 5 },
    }),
    createBlock('cta_button', {
      id: 'blk_cta',
      content: '지금 구매하기',
      required: true,
      priority: 1,
      position: { x: 260, y: 1040, width: 320, height: 90 },
      layoutHint: { region: 'bottom', alignment: 'center', emphasis: 'high', order: 6 },
    }),
    // Publishing-only: the CTA target URL is never shown to the image AI.
    createBlock('button_url', {
      id: 'blk_cta_url',
      content: 'https://shop.example.com/rompf-1plus1',
      notes: 'CTA 버튼 연결',
      position: { x: 0, y: 0, width: 300, height: 60 },
    }),
    createBlock('manager_note', {
      id: 'blk_note',
      content: '기존 8월 배너와 톤 맞춰주세요.',
      position: { x: 0, y: 0, width: 300, height: 80 },
    }),
  ],
  assets: [productAsset, secondaryAsset],
}
