/**
 * Factory helpers for constructing well-formed domain objects with sensible
 * defaults. Kept in the domain layer so both the UI and tests build blocks the
 * same way.
 */

import { getBlockTypeMeta, isImageBlock, type BlockType } from './blockTypes'
import {
  NEW_PAGE_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  SCHEMA_VERSION,
  type BriefBlock,
  type EventBrief,
  type LayoutHint,
  type Project,
} from './briefSchema'

let idCounter = 0

/**
 * 어디서도 겹치지 않는 id 한 개 (id 충돌 Patch, 2026-09-16).
 *
 * 앞선 판은 `crypto.randomUUID`가 없으면 **모듈 안의 카운터**로 떨어졌다.
 * `randomUUID`는 보안 컨텍스트(HTTPS 또는 localhost)에서만 존재하는데, 회사 서버
 * 배포 주소는 `http://192.168.0.128:3000` — 평문 HTTP라 보안 컨텍스트가 아니다.
 * 그래서 이 배포에서는 **언제나** 카운터였고, 카운터는 새로고침마다 0부터 다시
 * 셌다. 그 결과 새로고침 뒤 처음 만든 자산이 `asset_1`을 다시 받아 **작업자가
 * 올린 스타일 레퍼런스의 내용을 덮어썼다** — 화면의 레퍼런스 그림이 방금 만든
 * 결과물로 바뀌고, 그 다음 생성부터는 AI가 자기 결과를 보고 다시 그렸다.
 * Vercel(HTTPS)에서는 `randomUUID`가 살아 있어 드러나지 않던 버그다.
 *
 * `crypto.getRandomValues`는 보안 컨텍스트를 요구하지 않는다. 그것을 먼저 쓰고,
 * 그마저 없을 때만 시각과 난수를 섞는다. 어느 쪽이든 **새로고침을 넘어 이어지는
 * 값**이어야 한다는 것이 이 함수의 조건이다.
 */
export function createId(prefix = 'blk'): string {
  const globalCrypto = (globalThis as { crypto?: Crypto }).crypto
  if (globalCrypto?.randomUUID) {
    return `${prefix}_${globalCrypto.randomUUID()}`
  }
  if (globalCrypto?.getRandomValues) {
    const bytes = globalCrypto.getRandomValues(new Uint8Array(16))
    let hex = ''
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
    return `${prefix}_${hex}`
  }
  // 저장소도 난수도 없는 환경(구형 SSR 등). 시각을 섞어 적어도 실행끼리는 겹치지
  // 않게 한다. 카운터만 쓰던 예전 값이 여기로 돌아오지 않도록 접두사를 붙인다.
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export interface CreateBlockOptions {
  id?: string
  label?: string
  content?: string
  required?: boolean
  priority?: BriefBlock['priority']
  position?: Partial<BriefBlock['position']>
  layoutHint?: LayoutHint
  assetId?: string
  groupId?: string
  notes?: string
}

/**
 * Builds a new block for a given type, applying the type's default label and
 * AI visibility (WORK_PLAN §7, §8). Optional fields are only set when provided
 * so the object stays compatible with `exactOptionalPropertyTypes`.
 */
export function createBlock(type: BlockType, options: CreateBlockOptions = {}): BriefBlock {
  const meta = getBlockTypeMeta(type)

  const block: BriefBlock = {
    id: options.id ?? createId(),
    type,
    label: options.label ?? meta.label,
    required: options.required ?? false,
    priority: options.priority ?? 3,
    aiVisibility: meta.defaultVisibility,
    position: {
      x: options.position?.x ?? 0,
      y: options.position?.y ?? 0,
      width: options.position?.width ?? 300,
      height: options.position?.height ?? 100,
    },
    layoutHint: options.layoutHint ?? {},
  }

  if (options.content !== undefined) block.content = options.content
  if (options.assetId !== undefined) block.assetId = options.assetId
  if (options.groupId !== undefined) block.groupId = options.groupId
  if (options.notes !== undefined) block.notes = options.notes
  if (isImageBlock(type)) block.image = { allowTransform: type !== 'existing_full_image' }

  return block
}

/** Creates an empty project with default canvas geometry (WORK_PLAN §10, §12). */
export function createEmptyProject(title = ''): Project {
  return {
    title,
    outputType: 'event_page',
    canvasWidth: DEFAULT_CANVAS_WIDTH,
    // A brief starts one page long at the new-page length; every page carries
    // its own length from there (손검수 2 §3). `DEFAULT_CANVAS_HEIGHT` stays the
    // height a v1 document is migrated with.
    canvasHeight: NEW_PAGE_HEIGHT,
  }
}

/** Creates an empty brief ready for editing. */
export function createEmptyBrief(title = ''): EventBrief {
  return {
    schemaVersion: SCHEMA_VERSION,
    project: createEmptyProject(title),
    blocks: [],
    assets: [],
  }
}
