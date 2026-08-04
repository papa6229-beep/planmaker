/**
 * Pure page operations on a `BriefDocument` (WORK_PLAN Phase 7 §9.2).
 *
 * Invariants maintained by every function:
 *  - `pages.length >= 1` (the last page cannot be deleted),
 *  - `activePageId` always references an existing page,
 *  - block ids (and group ids) are unique across the whole document — page
 *    duplication regenerates them.
 */

import { createId } from './factory'
import { NEW_PAGE_HEIGHT, type Asset, type BriefBlock } from './briefSchema'

/**
 * Title a brand-new brief is created with. A brief still carrying it has not
 * been named by anyone. Kept here rather than imported from the editor so the
 * domain does not depend on a feature module.
 */
const DEFAULT_NEW_BRIEF_TITLE = '새 기획서'
import {
  createPage,
  createReferenceLayer,
  FIRST_PAGE_TITLE,
  type BriefDocument,
  type BriefPage,
  type ReferenceLayer,
} from './pageSchema'

// ── Selectors ────────────────────────────────────────────────────────────────

export function getPage(doc: BriefDocument, pageId: string): BriefPage | undefined {
  return doc.pages.find((p) => p.id === pageId)
}

export function getActivePage(doc: BriefDocument): BriefPage {
  return getPage(doc, doc.activePageId) ?? doc.pages[0]!
}

export function pageIndex(doc: BriefDocument, pageId: string): number {
  return doc.pages.findIndex((p) => p.id === pageId)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function withPages(doc: BriefDocument, pages: BriefPage[]): BriefDocument {
  return { ...doc, pages }
}

function replacePage(doc: BriefDocument, pageId: string, update: (page: BriefPage) => BriefPage): BriefDocument {
  return withPages(doc, doc.pages.map((p) => (p.id === pageId ? update(p) : p)))
}

/** Deep-clones blocks with fresh block ids and remapped group ids (assets stay shared). */
function cloneBlocksFresh(blocks: readonly BriefBlock[]): BriefBlock[] {
  const groupMap = new Map<string, string>()
  return blocks.map((b) => {
    const clone: BriefBlock = { ...b, id: createId(), position: { ...b.position }, layoutHint: { ...b.layoutHint } }
    if (b.image) clone.image = { ...b.image }
    if (b.groupId !== undefined) {
      let g = groupMap.get(b.groupId)
      if (g === undefined) {
        g = createId('grp')
        groupMap.set(b.groupId, g)
      }
      clone.groupId = g
    }
    return clone
  })
}

// ── Page operations ──────────────────────────────────────────────────────────

/** Appends a new empty page and makes it active. */
export function addPage(doc: BriefDocument, title?: string): BriefDocument {
  const page = createPage({ title: title ?? `${doc.pages.length + 1}페이지` })
  return { ...doc, pages: [...doc.pages, page], activePageId: page.id }
}

/** Duplicates a page (fresh block/group ids) right after the original; new page becomes active. */
export function duplicatePage(doc: BriefDocument, pageId: string): BriefDocument {
  const idx = pageIndex(doc, pageId)
  if (idx === -1) return doc
  const source = doc.pages[idx]!
  const copy: BriefPage = {
    ...createPage({
      title: `${source.title} 사본`,
      canvasWidth: source.canvasWidth,
      canvasHeight: source.canvasHeight,
      reference: { ...source.reference },
    }),
    blocks: cloneBlocksFresh(source.blocks),
  }
  const pages = [...doc.pages.slice(0, idx + 1), copy, ...doc.pages.slice(idx + 1)]
  return { ...doc, pages, activePageId: copy.id }
}

/** Deletes a page. The last remaining page cannot be deleted. */
export function deletePage(doc: BriefDocument, pageId: string): BriefDocument {
  if (doc.pages.length <= 1) return doc
  const idx = pageIndex(doc, pageId)
  if (idx === -1) return doc
  const pages = doc.pages.filter((p) => p.id !== pageId)
  let activePageId = doc.activePageId
  if (activePageId === pageId) {
    const neighbor = pages[Math.min(idx, pages.length - 1)]!
    activePageId = neighbor.id
  }
  return { ...doc, pages, activePageId }
}

/** Moves a page left (delta -1) or right (delta +1) within the ordering. */
export function movePage(doc: BriefDocument, pageId: string, delta: number): BriefDocument {
  const idx = pageIndex(doc, pageId)
  if (idx === -1) return doc
  const target = idx + delta
  if (target < 0 || target >= doc.pages.length) return doc
  const pages = [...doc.pages]
  const [moved] = pages.splice(idx, 1)
  pages.splice(target, 0, moved!)
  return withPages(doc, pages)
}

export function renamePage(doc: BriefDocument, pageId: string, title: string): BriefDocument {
  return replacePage(doc, pageId, (p) => ({ ...p, title }))
}

export function setActivePage(doc: BriefDocument, pageId: string): BriefDocument {
  return pageIndex(doc, pageId) === -1 ? doc : { ...doc, activePageId: pageId }
}

// ── Reference layer operations (WORK_PLAN §8) ────────────────────────────────

function updateReference(doc: BriefDocument, pageId: string, patch: Partial<ReferenceLayer>): BriefDocument {
  return replacePage(doc, pageId, (p) => ({ ...p, reference: { ...p.reference, ...patch } }))
}

export function setReferenceImage(doc: BriefDocument, pageId: string, assetId: string): BriefDocument {
  return replacePage(doc, pageId, (p) => ({ ...p, reference: { ...p.reference, assetId } }))
}

export function removeReferenceImage(doc: BriefDocument, pageId: string): BriefDocument {
  return replacePage(doc, pageId, (p) => {
    const reference = { ...p.reference }
    delete reference.assetId
    return { ...p, reference }
  })
}

export function setReferenceViewMode(doc: BriefDocument, pageId: string, viewMode: ReferenceLayer['viewMode']): BriefDocument {
  return updateReference(doc, pageId, { viewMode })
}

export function setReferenceFit(doc: BriefDocument, pageId: string, fit: ReferenceLayer['fit']): BriefDocument {
  return updateReference(doc, pageId, { fit })
}

export function setReferenceVisible(doc: BriefDocument, pageId: string, visible: boolean): BriefDocument {
  return updateReference(doc, pageId, { visible })
}

/** Sets overlay opacity, clamped to 0..1. */
export function setReferenceOpacity(doc: BriefDocument, pageId: string, opacity: number): BriefDocument {
  const clamped = Math.min(Math.max(opacity, 0), 1)
  return updateReference(doc, pageId, { opacity: clamped })
}

/** Resets a page's reference layer to defaults (also clears the image). */
export function clearReference(doc: BriefDocument, pageId: string): BriefDocument {
  return replacePage(doc, pageId, (p) => ({ ...p, reference: createReferenceLayer() }))
}

// ── Assets a document actually uses ──────────────────────────────────────────

/**
 * Every asset the document really references: a block's picture on any page,
 * and any page's 참고 이미지.
 *
 * This is the definition of "in use". A document's `assets` list is metadata
 * *about* these, not a record of every image that ever passed through — an
 * entry nobody points at any more would keep an image in an exported file and
 * pin its binary in the store forever (v1 동결 §4).
 */
export function referencedAssetIds(doc: BriefDocument): string[] {
  const ids = new Set<string>()
  for (const page of doc.pages) {
    for (const b of page.blocks) if (b.assetId !== undefined) ids.add(b.assetId)
    if (page.reference.assetId !== undefined) ids.add(page.reference.assetId)
  }
  return [...ids]
}

/**
 * The document with its asset list trimmed to what it references, preferring
 * fresher metadata when the editor has some.
 */
export function withReferencedAssets(doc: BriefDocument, preferred: readonly Asset[] = []): BriefDocument {
  const used = new Set(referencedAssetIds(doc))
  const byId = new Map<string, Asset>()
  for (const a of doc.assets) if (used.has(a.id)) byId.set(a.id, a)
  for (const a of preferred) if (used.has(a.id)) byId.set(a.id, a)
  const assets = [...byId.values()]
  const unchanged = assets.length === doc.assets.length && assets.every((a, i) => a === doc.assets[i])
  return unchanged ? doc : { ...doc, assets }
}

/**
 * Rewrites asset ids across the whole document — metadata, block pictures, and
 * page references — so an imported file can take new ids without any reference
 * being left pointing at the old one (v1 동결 §3).
 */
export function remapAssetIds(doc: BriefDocument, mapping: ReadonlyMap<string, string>): BriefDocument {
  if (mapping.size === 0) return doc
  const to = (id: string): string => mapping.get(id) ?? id
  return {
    ...doc,
    assets: doc.assets.map((a) => (mapping.has(a.id) ? { ...a, id: to(a.id) } : a)),
    pages: doc.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((b) =>
        b.assetId !== undefined && mapping.has(b.assetId) ? { ...b, assetId: to(b.assetId) } : b,
      ),
      reference:
        page.reference.assetId !== undefined && mapping.has(page.reference.assetId)
          ? { ...page.reference, assetId: to(page.reference.assetId) }
          : page.reference,
    })),
  }
}

// ── "Is there anything here to lose?" ────────────────────────────────────────

/**
 * True when the document holds anything a person put there.
 *
 * Asked before an import replaces what is on screen. A brief that only *looks*
 * empty because it has no blocks may still hold a title, the direction for the
 * whole page, extra pages, a page dragged longer, or a reference image — losing
 * any of those without being asked is the bug this answers (v1 동결 §6). Values
 * nobody typed — the document id, the ids of its pages — are not work, so a
 * brand-new brief answers false.
 *
 * 작성팀은 더 이상 여기 없다. 팀은 게이트에서 골라 **모든 새 기획서에** 처음부터
 * 붙는 값이 되었으므로(첫 사용 흐름 §4), 그것을 일로 세면 갓 만든 빈 기획서가
 * 언제나 "지울 것이 있다"고 답하고 파일을 열 때마다 쓸데없이 물어보게 된다.
 */
export function hasUserWork(doc: BriefDocument): boolean {
  const { project } = doc
  const title = project.title.trim()
  if (title !== '' && title !== DEFAULT_NEW_BRIEF_TITLE) return true
  if ((project.concept ?? '').trim() !== '') return true
  if ((project.conceptNote ?? '').trim() !== '') return true
  if (doc.pages.length > 1) return true

  const untouched = createReferenceLayer()
  return doc.pages.some(
    (page) =>
      // Naming the page is work too: importing over it loses that name.
      page.title !== FIRST_PAGE_TITLE ||
      page.blocks.length > 0 ||
      page.canvasHeight !== NEW_PAGE_HEIGHT ||
      page.reference.assetId !== undefined ||
      page.reference.viewMode !== untouched.viewMode ||
      page.reference.opacity !== untouched.opacity ||
      page.reference.fit !== untouched.fit ||
      page.reference.visible !== untouched.visible,
  )
}
