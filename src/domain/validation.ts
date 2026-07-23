/**
 * Pre-export validation (WORK_PLAN §14).
 *
 * Errors block export; warnings are shown but the user may proceed. All rules
 * are semantic — there is no color/shape inference anywhere (§3.4, §22).
 */

import { isImageBlock, isReferenceBlock } from './blockTypes'
import type { BriefBlock, EventBrief } from './briefSchema'

export type IssueSeverity = 'error' | 'warning'

/** Machine-readable codes so the UI can localize / link to the offending block. */
export type ValidationCode =
  // errors
  | 'PROJECT_TITLE_MISSING'
  | 'NO_DESIGN_BLOCK'
  | 'REQUIRED_CONTENT_MISSING'
  | 'IMAGE_ASSET_MISSING'
  | 'DUPLICATE_BLOCK_ID'
  | 'ASSET_REFERENCE_MISSING'
  // warnings
  | 'NO_MAIN_HEADLINE'
  | 'NO_REQUIRED_PRODUCT'
  | 'CTA_WITHOUT_LINK'
  | 'LINK_IN_DESIGN_AREA'
  | 'EXISTING_IMAGE_TRANSFORM_ON'
  | 'BLOCK_OUTSIDE_CANVAS'

export interface ValidationIssue {
  severity: IssueSeverity
  code: ValidationCode
  message: string
  /** Block the issue relates to, when applicable. */
  blockId?: string
}

export interface ValidationResult {
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  /** Convenience flag; export is blocked when false. */
  ok: boolean
}

function error(code: ValidationCode, message: string, blockId?: string): ValidationIssue {
  return blockId === undefined
    ? { severity: 'error', code, message }
    : { severity: 'error', code, message, blockId }
}

function warning(code: ValidationCode, message: string, blockId?: string): ValidationIssue {
  return blockId === undefined
    ? { severity: 'warning', code, message }
    : { severity: 'warning', code, message, blockId }
}

/** A block that will actually appear in the design (visible to the image AI). */
function isDesignBlock(block: BriefBlock): boolean {
  return block.aiVisibility === 'design'
}

function hasContent(block: BriefBlock): boolean {
  return typeof block.content === 'string' && block.content.trim().length > 0
}

function isOutsideCanvas(block: BriefBlock, width: number, height: number): boolean {
  const { x, y, width: w, height: h } = block.position
  return x < 0 || y < 0 || x + w > width || y + h > height
}

/**
 * Validates a brief and returns errors and warnings. Pure and side-effect free
 * so it can run on every edit as well as at export time.
 */
export function validateBrief(brief: EventBrief): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  const { project, blocks, assets } = brief
  const assetIds = new Set(assets.map((a) => a.id))

  // ── Errors ────────────────────────────────────────────────────────────────

  if (project.title.trim().length === 0) {
    errors.push(error('PROJECT_TITLE_MISSING', '프로젝트명이 없습니다.'))
  }

  const designBlocks = blocks.filter(isDesignBlock)
  if (designBlocks.length === 0) {
    errors.push(error('NO_DESIGN_BLOCK', '디자인 블록이 하나도 없습니다.'))
  }

  const seenIds = new Set<string>()
  for (const block of blocks) {
    if (seenIds.has(block.id)) {
      errors.push(error('DUPLICATE_BLOCK_ID', `블록 ID가 중복됩니다: ${block.id}`, block.id))
    }
    seenIds.add(block.id)

    if (block.required && isImageBlock(block.type) && block.assetId === undefined) {
      errors.push(error('IMAGE_ASSET_MISSING', `필수 이미지 블록에 이미지가 없습니다: ${block.label}`, block.id))
    } else if (block.required && !isImageBlock(block.type) && !hasContent(block)) {
      errors.push(error('REQUIRED_CONTENT_MISSING', `필수 블록의 내용이 비어 있습니다: ${block.label}`, block.id))
    }

    if (block.assetId !== undefined && !assetIds.has(block.assetId)) {
      errors.push(error('ASSET_REFERENCE_MISSING', `참조 이미지 파일이 누락되었습니다: ${block.label}`, block.id))
    }
  }

  // ── Warnings ────────────────────────────────────────────────────────────

  const hasMainHeadline = blocks.some((b) => b.type === 'main_headline' && hasContent(b))
  if (!hasMainHeadline) {
    warnings.push(warning('NO_MAIN_HEADLINE', '메인 문구가 없습니다.'))
  }

  const hasRequiredProduct = blocks.some(
    (b) => b.required && (b.type === 'main_product_image' || b.type === 'product_group_image' || b.type === 'sub_product_image'),
  )
  if (!hasRequiredProduct) {
    warnings.push(warning('NO_REQUIRED_PRODUCT', '필수 제품이 하나도 없습니다.'))
  }

  const hasAnyLink = blocks.some((b) => b.type === 'button_url' || b.type === 'product_detail_link' || b.type === 'application_form_link')
  for (const block of blocks) {
    if (block.type === 'cta_button' && hasContent(block) && !hasAnyLink) {
      warnings.push(warning('CTA_WITHOUT_LINK', `버튼 문구는 있으나 연결 정보가 없습니다: ${block.label}`, block.id))
    }

    if (isReferenceBlock(block.type) && block.aiVisibility === 'design') {
      warnings.push(warning('LINK_IN_DESIGN_AREA', `링크/참고 블록이 디자인 영역에 배치되었습니다: ${block.label}`, block.id))
    }

    if (block.type === 'existing_full_image' && block.image?.allowTransform === true) {
      warnings.push(warning('EXISTING_IMAGE_TRANSFORM_ON', `기존 통이미지에 변형 허용이 켜져 있습니다: ${block.label}`, block.id))
    }

    if (isOutsideCanvas(block, project.canvasWidth, project.canvasHeight)) {
      warnings.push(warning('BLOCK_OUTSIDE_CANVAS', `캔버스 밖에 있는 블록입니다: ${block.label}`, block.id))
    }
  }

  return { errors, warnings, ok: errors.length === 0 }
}
