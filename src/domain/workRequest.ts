/**
 * Work request domain (WORK_PLAN Phase 7 §6, §13, Step 7).
 *
 * A `WorkRequest` is the delivery record created when a planner presses
 * 전달하기. Its status lives OUTSIDE the brief so editing never silently
 * rewrites a delivered request:
 *   - `submittedDoc` is the immutable multi-page snapshot at delivery time
 *     (a `BriefDocument`, since the editor is multi-page as of Step 4);
 *   - `workingDoc` is the design team's editable copy, created on first open.
 *
 * This module is pure and framework-free (timestamps are passed in), so it is
 * trivially unit-testable and easy to port later.
 */

import type { BriefDocument } from './pageSchema'
import { referencedAssetIds } from './pageOps'

/** Request lifecycle (WORK_PLAN §6, §13.3). Draft is out of scope this step. */
export type WorkRequestStatus = 'submitted' | 'reviewed' | 'in_progress' | 'completed'

export const WORK_REQUEST_STATUSES: readonly WorkRequestStatus[] = [
  'submitted',
  'reviewed',
  'in_progress',
  'completed',
]

/** Korean labels for the image-generation side (WORK_PLAN §13.1, §13.3). */
export const STATUS_LABELS: Record<WorkRequestStatus, string> = {
  submitted: '신규',
  reviewed: '확인',
  in_progress: '작업 중',
  completed: '완료',
}

export interface WorkRequest {
  id: string
  /**
   * The brief this was delivered from. Optional because requests created
   * before briefs had ids carry no link — those are reported as "연결 없음"
   * rather than guessed at by title, which would confuse same-named briefs.
   */
  documentId?: string
  title: string
  status: WorkRequestStatus
  /** Immutable delivery snapshot (never edited after creation). */
  submittedDoc: BriefDocument
  /** Design team's editable copy (created when first opened). */
  workingDoc?: BriefDocument
  createdAt: string
  submittedAt: string
  updatedAt: string
  completedAt?: string
}

/** A structuredClone-free deep copy good enough for our JSON-serializable docs. */
export function cloneDocument(doc: BriefDocument): BriefDocument {
  return JSON.parse(JSON.stringify(doc)) as BriefDocument
}

/**
 * Creates a `submitted` work request from a document snapshot. The snapshot is
 * deep-cloned so later edits to the live document never mutate it.
 */
export function createWorkRequest(id: string, doc: BriefDocument, now: string): WorkRequest {
  const documentId = doc.project.id
  return {
    id,
    ...(documentId === undefined ? {} : { documentId }),
    title: doc.project.title.trim() || '제목 없는 기획서',
    status: 'submitted',
    submittedDoc: cloneDocument(doc),
    createdAt: now,
    submittedAt: now,
    updatedAt: now,
  }
}

/** Applies a status change, stamping timestamps (completedAt only on 완료). */
export function withStatus(request: WorkRequest, status: WorkRequestStatus, now: string): WorkRequest {
  const next: WorkRequest = { ...request, status, updatedAt: now }
  if (status === 'completed') next.completedAt = now
  else delete next.completedAt
  return next
}

/** Number of pages in the delivered snapshot (WORK_PLAN §13.1 페이지 수). */
export function pageCount(request: WorkRequest): number {
  return request.submittedDoc.pages.length
}

export interface RequestStats {
  submitted: number
  reviewed: number
  in_progress: number
  completed: number
  total: number
}

/** Aggregate counts by status (drives the gate KPIs, WORK_PLAN §5.2). */
export function computeStats(requests: readonly WorkRequest[]): RequestStats {
  const stats: RequestStats = { submitted: 0, reviewed: 0, in_progress: 0, completed: 0, total: requests.length }
  for (const r of requests) stats[r.status] += 1
  return stats
}

/** Every asset id referenced by a request's snapshot(s) — so shared blobs survive pruning. */
export function requestAssetIds(request: WorkRequest): string[] {
  const ids = new Set<string>()
  // What the snapshot actually shows: a block's picture, or a page's reference
  // image. A stale metadata entry nobody points at is not part of the request
  // and must not keep a binary alive forever (v1 동결 §4).
  const collect = (doc: BriefDocument | undefined) => {
    if (!doc) return
    for (const id of referencedAssetIds(doc)) ids.add(id)
  }
  collect(request.submittedDoc)
  collect(request.workingDoc)
  return [...ids]
}
