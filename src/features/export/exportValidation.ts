/**
 * Export-time validation (WORK_PLAN §5, §6). Builds on the domain's
 * `validateBrief` (unchanged) and adds checks that only matter for packaging:
 *  - an image block referencing a blob that is not available (error),
 *  - orphaned asset metadata not referenced by any block (warning).
 *
 * The domain layer stays pure; this wrapper lives in the feature layer.
 */

import { validateBrief } from '../../domain/validation'
import type { EventBrief } from '../../domain/briefSchema'

export interface ExportIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  blockId?: string
}

export interface ExportValidationResult {
  errors: ExportIssue[]
  warnings: ExportIssue[]
  ok: boolean
}

export function validateForExport(brief: EventBrief, availableAssetIds: ReadonlySet<string>): ExportValidationResult {
  const base = validateBrief(brief)
  const errors: ExportIssue[] = base.errors.map((i) => ({ ...i }))
  const warnings: ExportIssue[] = base.warnings.map((i) => ({ ...i }))

  // Error: a block points at an image whose binary is missing.
  for (const block of brief.blocks) {
    if (block.assetId !== undefined && !availableAssetIds.has(block.assetId)) {
      errors.push({
        severity: 'error',
        code: 'ASSET_BLOB_MISSING',
        message: `이미지 데이터를 찾을 수 없습니다: ${block.label}`,
        blockId: block.id,
      })
    }
  }

  // Warning: asset metadata that no block uses (orphan).
  const usedAssetIds = new Set(brief.blocks.map((b) => b.assetId).filter((id): id is string => id !== undefined))
  for (const asset of brief.assets) {
    if (!usedAssetIds.has(asset.id)) {
      warnings.push({
        severity: 'warning',
        code: 'ORPHAN_ASSET',
        message: `사용되지 않는 이미지 자산이 있습니다: ${asset.fileName}`,
      })
    }
  }

  return { errors, warnings, ok: errors.length === 0 }
}
