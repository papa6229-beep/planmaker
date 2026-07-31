/**
 * Canonical content fingerprint of a brief (판정 §2).
 *
 * Delivery status is decided by whether the brief's *substance* still matches
 * the snapshot that was delivered — never by a save timestamp. Merely opening a
 * brief, autosaving it unchanged, or migrating it must not make it look edited.
 *
 * This is the single place that rule lives; nothing else should re-implement
 * "are these two briefs the same".
 *
 * Included (everything that carries meaning for the design or the AI):
 *   - every wording, verbatim
 *   - page structure, block order, position and size
 *   - attached image assets and the shared asset pool
 *   - image links and button links (they live in publishing blocks)
 *   - 전체 컨셉
 *   - the reference layer a page was built against
 *
 * Excluded (screen state, not work):
 *   - `activePageId` — which page the user happens to be looking at
 *   - the reference layer's view controls (view mode / visibility / opacity /
 *     fit), which only affect how the reference is displayed while editing
 */

import type { BriefDocument, BriefPage } from './pageSchema'

/** Stable stringify: object keys are sorted so key order can never matter. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).toSorted()) {
      if (source[key] === undefined) continue
      out[key] = stable(source[key])
    }
    return out
  }
  return value
}

/**
 * Page, block, and group ids are generated at random, so identical work built
 * twice would compare unequal. Pages and blocks are therefore compared in order
 * with their ids dropped, and group ids are renumbered by first appearance so
 * that "these two blocks are paired" is compared, not which random id says so.
 */
function pageContent(page: BriefPage, groupKey: (groupId: string) => string) {
  return {
    title: page.title,
    canvasWidth: page.canvasWidth,
    canvasHeight: page.canvasHeight,
    blocks: page.blocks.map((b) => ({
      type: b.type,
      label: b.label,
      content: b.content,
      required: b.required,
      priority: b.priority,
      aiVisibility: b.aiVisibility,
      position: b.position,
      layoutHint: b.layoutHint,
      notes: b.notes,
      assetId: b.assetId,
      group: b.groupId === undefined ? undefined : groupKey(b.groupId),
      image: b.image,
    })),
    // The reference *image* is part of the work; how it is being viewed is not.
    referenceAssetId: page.reference.assetId,
  }
}

/**
 * Reduces a brief to the content that decides whether it changed. Two briefs
 * with the same fingerprint are the same piece of work.
 */
export function documentFingerprint(doc: BriefDocument): string {
  const { project } = doc
  const groups = new Map<string, string>()
  const groupKey = (groupId: string): string => {
    let key = groups.get(groupId)
    if (key === undefined) {
      key = `g${groups.size}`
      groups.set(groupId, key)
    }
    return key
  }
  return JSON.stringify(
    stable({
      project: {
        // `id` is deliberately included: a copy is a different brief.
        id: project.id,
        title: project.title,
        concept: project.concept,
        conceptNote: project.conceptNote,
        outputType: project.outputType,
        canvasWidth: project.canvasWidth,
        canvasHeight: project.canvasHeight,
        requestTeam: project.requestTeam,
        author: project.author,
        eventType: project.eventType,
      },
      pages: doc.pages.map((page) => pageContent(page, groupKey)),
      assets: doc.assets,
    }),
  )
}

/** True when two briefs hold the same work. */
export function sameDocumentContent(a: BriefDocument, b: BriefDocument): boolean {
  return documentFingerprint(a) === documentFingerprint(b)
}
