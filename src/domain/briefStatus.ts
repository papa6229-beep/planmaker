/**
 * Delivery status of a brief for the 보관함 list (§7, 판정 §2).
 *
 * Decided by comparing the brief's *content* against the snapshot that was
 * delivered — never by a save timestamp. Opening a brief, autosaving it
 * unchanged, or importing it must not make it look edited, and reverting an
 * edit back to the delivered wording must return it to 전달 완료.
 */

import { sameDocumentContent } from './documentFingerprint'
import type { BriefDocument } from './pageSchema'
import type { WorkRequest } from './workRequest'

export type BriefDeliveryStatus = 'draft' | 'delivered' | 'editedAfterDelivery'

export const BRIEF_STATUS_LABELS: Record<BriefDeliveryStatus, string> = {
  draft: '작성 중',
  delivered: '전달 완료',
  editedAfterDelivery: '전달 후 수정 중',
}

/**
 * The most recent delivery of a brief, or `undefined` when it has never been
 * delivered. Requests without a `documentId` are ignored on purpose: matching
 * them by title would mix up two briefs that happen to share a name.
 */
export function latestDeliveryOf(
  requests: readonly WorkRequest[],
  documentId: string | undefined,
): WorkRequest | undefined {
  if (documentId === undefined) return undefined
  const mine = requests.filter((r) => r.documentId === documentId)
  if (mine.length === 0) return undefined
  return mine.reduce((latest, r) => (r.submittedAt > latest.submittedAt ? r : latest))
}

/**
 * Status of a brief given its current content and the delivery history.
 *
 * `doc` may be `undefined` when the list has not loaded the full document —
 * a delivered brief then reads as 전달 완료 rather than claiming an edit that
 * has not been verified.
 */
export function briefStatus(
  requests: readonly WorkRequest[],
  documentId: string | undefined,
  doc: BriefDocument | undefined,
): BriefDeliveryStatus {
  const latest = latestDeliveryOf(requests, documentId)
  if (!latest) return 'draft'
  if (!doc) return 'delivered'
  return sameDocumentContent(doc, latest.submittedDoc) ? 'delivered' : 'editedAfterDelivery'
}

/** ISO timestamp of the latest delivery, when there is one. */
export function lastDeliveredAt(
  requests: readonly WorkRequest[],
  documentId: string | undefined,
): string | undefined {
  return latestDeliveryOf(requests, documentId)?.submittedAt
}
