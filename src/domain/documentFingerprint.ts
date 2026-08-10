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
 *   - `layoutHint.emphasis`, which is derived from the wording and the block
 *     size — both already compared here
 */

import type { LayoutHint } from './briefSchema'
import { BANNER_PAGE_PREFIX } from './bannerFit'
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
/**
 * Emphasis is written by the editor from the wording and the block size, so a
 * brief that was never touched since it was delivered can still gain the hint
 * the moment it is opened and edited back to the same words. Comparing it would
 * report work that did not happen; the wording and size it comes from are
 * compared instead.
 */
function layoutHintContent(hint: LayoutHint): Omit<LayoutHint, 'emphasis'> {
  const { emphasis: _emphasis, ...rest } = hint
  return rest
}

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
      layoutHint: layoutHintContent(b.layoutHint),
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
/**
 * 이 페이지가 배너인가.
 *
 * 번호로 안다. 작업(`StudioJob.bannerPages`)이 정본이지만 이 모듈은 순수하고
 * 작업을 모른다 — 그래서 `bannerPageId`가 붙이는 머리말을 여기서도 읽는다.
 */
function isBannerPage(pageId: string): boolean {
  return pageId.startsWith(BANNER_PAGE_PREFIX)
}

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
        // 작성자가 디자인팀에게 남긴 말은 기획서의 내용이다. 반면 작업판에서
        // 작업자가 적는 AI 지시(`aiNote`)는 기획서가 달라진 것이 아니므로
        // 여기 없다 — 그것까지 세면 메모 한 줄에 "원본이 바뀌었다"가 된다.
        designerNote: project.designerNote,
        outputType: project.outputType,
        canvasWidth: project.canvasWidth,
        canvasHeight: project.canvasHeight,
        requestTeam: project.requestTeam,
        author: project.author,
        eventType: project.eventType,
      },
      // 배너 페이지는 세지 않는다 (배너 Patch §5).
      //
      // 이 지문이 답하는 물음은 "**기획서**가 달라졌는가"이고, 그 답으로 완성본이
      // 오래되었는지를 판정한다. 배너는 완성본에서 파생된 결과물이지 기획서가
      // 아니다. 세면 배너 하나를 뽑았을 뿐인데 **메인 이벤트 페이지의 완성본까지**
      // 오래된 것으로 표시된다 — 실제로 그랬다.
      pages: doc.pages.filter((page) => !isBannerPage(page.id)).map((page) => pageContent(page, groupKey)),
      assets: doc.assets,
    }),
  )
}

/** True when two briefs hold the same work. */
export function sameDocumentContent(a: BriefDocument, b: BriefDocument): boolean {
  return documentFingerprint(a) === documentFingerprint(b)
}

/**
 * The same judgement as a short opaque string.
 *
 * `documentFingerprint` is the brief's whole content, so it is a perfect
 * comparison key and a terrible thing to hand to anyone: it carries every
 * wording — including the publishing URLs the image AI must never see. Where
 * the identity of a document has to travel (the GPT 제작 요청 §5.1), this digest
 * goes instead. FNV-1a over the canonical string: no dependency, stable across
 * runs, and it says nothing about what the brief contains.
 */
export function documentDigest(doc: BriefDocument): string {
  const text = documentFingerprint(doc)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `d${hash.toString(16).padStart(8, '0')}${text.length.toString(16)}`
}
