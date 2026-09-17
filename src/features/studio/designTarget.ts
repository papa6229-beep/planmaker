/**
 * 도구 막대가 지금 다루는 것 (도구 막대 Patch, 2026-09-17).
 *
 * 완성본을 보고 있으면 완성본에서 고른 조각이, 아니면 기획서 캔버스에서 고른 블록이
 * 대상이다. 둘 다 없으면 `null` — 막대는 도구만 보여 준다.
 */

import { useBriefEditor } from '../editor/useBriefEditor'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'
import { useImageGeneration } from './useImageGeneration'
import { getBlockTypeMeta, isShapeBlock } from '../../domain/blockTypes'
import { imageObjectsOf, textObjectsOf } from '../../domain/studioJob'
import type { BriefBlock } from '../../domain/briefSchema'
import type { StudioTextObject } from '../../domain/textObjects'

export interface DesignTarget {
  kind: 'text' | 'shape' | 'image'
  blockId: string
  pageId: string
  /** 어디서 골랐나. 완성본이면 바꿀 때마다 되돌리기 칸을 남긴다. */
  source: 'brief' | 'result'
  /** 기획서 블록 — 배너 조각처럼 없을 수도 있다. */
  block?: BriefBlock
  /** 완성본의 조각 — 기획서에서 골랐으면 없을 수도 있다. */
  object?: StudioTextObject
}

export function useDesignTarget(): DesignTarget | null {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const editor = useBriefEditor()
  const { activePageId: pageId } = useBriefDocument()
  if (studio === null) return null
  const blocks = editor.state.brief.blocks
  const compare = generation !== null && generation.view === 'compare' && generation.hasResult

  const texts = textObjectsOf(studio.job, pageId)
  const images = imageObjectsOf(studio.job, pageId)
  const picked = compare ? studio.selectedObjectBlockId : null
  if (picked !== null) {
    const block = blocks.find((b) => b.id === picked)
    const image = images.find((o) => o.blockId === picked)
    if (image !== undefined) {
      return { kind: 'image', blockId: picked, pageId, source: 'result', object: image, ...(block ? { block } : {}) }
    }
    const text = texts.find((o) => o.blockId === picked)
    if (text !== undefined) {
      return {
        kind: text.kind === 'shape' ? 'shape' : 'text',
        blockId: picked,
        pageId,
        source: 'result',
        object: text,
        ...(block ? { block } : {}),
      }
    }
  }

  const block = editor.selected
  if (block === null) return null
  const meta = getBlockTypeMeta(block.type)
  const object = texts.find((o) => o.blockId === block.id)
  const base = { blockId: block.id, pageId, source: 'brief' as const, block, ...(object ? { object } : {}) }
  if (isShapeBlock(block.type)) return { kind: 'shape', ...base }
  if (meta.hasText && !meta.requiresAsset) return { kind: 'text', ...base }
  return null
}
