/**
 * Export-time validation (WORK_PLAN §5, §6). Builds on the domain's
 * `validateBrief` (unchanged) and adds checks that only matter for packaging:
 *  - an image block referencing a blob that is not available (error),
 *  - orphaned asset metadata not referenced by any block (warning).
 *
 * The domain layer stays pure; this wrapper lives in the feature layer.
 */

import { validateBrief } from '../../domain/validation'
import { SCHEMA_VERSION, type EventBrief } from '../../domain/briefSchema'
import type { BriefDocument } from '../../domain/pageSchema'

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

/**
 * Multi-page export validation (Phase 7 Step 4). Validates every page (issues
 * are prefixed with the page title) and checks the shared asset pool
 * document-wide, so an asset used on any page is never flagged as an orphan.
 */
export function validateDocumentForExport(
  doc: BriefDocument,
  availableAssetIds: ReadonlySet<string>,
): ExportValidationResult {
  // Validate the whole document as one flattened brief so the "needs a design
  // block" rule is applied document-wide (individual pages may be empty or
  // reference-only), while per-block checks still run.
  const flat: EventBrief = {
    schemaVersion: SCHEMA_VERSION,
    project: doc.project,
    blocks: doc.pages.flatMap((p) => p.blocks),
    assets: doc.assets,
  }
  const base = validateBrief(flat)
  const errors: ExportIssue[] = base.errors.map((i) => ({ ...i }))
  const warnings: ExportIssue[] = base.warnings.map((i) => ({ ...i }))

  for (const block of flat.blocks) {
    if (block.assetId !== undefined && !availableAssetIds.has(block.assetId)) {
      errors.push({
        severity: 'error',
        code: 'ASSET_BLOB_MISSING',
        message: `이미지 데이터를 찾을 수 없습니다: ${block.label}`,
        blockId: block.id,
      })
    }
  }

  const used = new Set<string>()
  for (const page of doc.pages) {
    for (const b of page.blocks) if (b.assetId !== undefined) used.add(b.assetId)
    if (page.reference.assetId !== undefined) used.add(page.reference.assetId)
  }
  for (const asset of doc.assets) {
    if (!used.has(asset.id)) {
      warnings.push({
        severity: 'warning',
        code: 'ORPHAN_ASSET',
        message: `사용되지 않는 이미지 자산이 있습니다: ${asset.fileName}`,
      })
    }
  }

  return { errors, warnings, ok: errors.length === 0 }
}
