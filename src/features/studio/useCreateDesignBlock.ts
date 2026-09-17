/**
 * 도구로 끌어서 블록을 만든다 (도구 막대 Patch, 2026-09-17).
 *
 * 문자 도구는 문구 블록을, 도형·선 도구는 도형 블록을 끌어 놓은 자리에 만든다.
 * 기획서 캔버스에서든 완성본에서든 같다.
 *
 * 완성본이 이미 있는 페이지라면 **그 자리에 조각도 바로 그려 얹는다** — 브라우저가
 * 그리는 것이라 다시 생성할 이유가 없다. 이때 완성본이 기획서와 어긋났다고 하지
 * 않는다 (만들기 전에 이미 어긋나 있던 경우만 빼고).
 *
 * 하나를 만들면 선택 도구로 돌아온다 — 다음 누름이 또 하나를 만들지 않게.
 */

import { useCallback } from 'react'
import { useBriefEditor } from '../editor/useBriefEditor'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'
import { useImageGeneration } from './useImageGeneration'
import { createId } from '../../domain/factory'
import { FALLBACK_FAMILY, fontOrDefault } from '../../domain/fontCatalog'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import { drawsBareText, textAlignOf } from '../../domain/simpleBlocks'
import type { StudioTextObject } from '../../domain/textObjects'
import type { LayoutRect } from '../../domain/imageLayout'
import { DEFAULT_SHAPE_LOOK, SHADOW_LAYER_LOOK, SHAPE_KINDS, lineFromDrag, type ShapeLook } from '../../domain/shapeLook'
import {
  imageObjectsOf,
  pageResultIsStale,
  pageResultOf,
  resultFingerprint,
  textObjectsOf,
} from '../../domain/studioJob'
import { planLines } from '../../domain/textLayers'
import { lastFamily, requestEdit, setTool, type CreateTool } from './designTools'
import { paintLiveShape, paintLiveText } from './liveText'

export const NEW_TEXT = '텍스트를 입력하세요'
/** 누르기만 했을 때의 크기. */
const TEXT_SIZE = { width: 320, height: 80 }
const SHAPE_SIZE = { width: 160, height: 160 }
const LINE_SIZE = { width: 220, height: 12 }
/** 이보다 작게 끌었으면 누른 것으로 본다. */
const TINY = 6

export interface CreateDrag {
  from: { x: number; y: number }
  to: { x: number; y: number }
  /** Shift — 정사각·수평수직으로 맞춘다. */
  snap: boolean
}

/** 끌어 놓은 두 점을 블록 상자로. */
export function dragBox(tool: CreateTool, drag: CreateDrag): { rect: LayoutRect; line?: ShapeLook['line'] } {
  const dx = drag.to.x - drag.from.x
  const dy = drag.to.y - drag.from.y
  const tiny = Math.abs(dx) < TINY && Math.abs(dy) < TINY
  if (tool === 'line') {
    if (tiny) {
      return {
        rect: { x: Math.round(drag.from.x), y: Math.round(drag.from.y - LINE_SIZE.height / 2), ...LINE_SIZE },
        line: 'h',
      }
    }
    const made = lineFromDrag(drag.from, drag.to, drag.snap)
    return { rect: made.rect, line: made.line }
  }
  const size = tool === 'text' ? TEXT_SIZE : SHAPE_SIZE
  if (tiny) return { rect: { x: Math.round(drag.from.x), y: Math.round(drag.from.y), ...size } }
  let w = Math.abs(dx)
  let h = Math.abs(dy)
  if (drag.snap && tool !== 'text') {
    const m = Math.max(w, h)
    w = m
    h = m
  }
  const x = dx < 0 ? drag.from.x - w : drag.from.x
  const y = dy < 0 ? drag.from.y - h : drag.from.y
  return {
    rect: {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.max(tool === 'text' ? 40 : 8, Math.round(w)),
      height: Math.max(tool === 'text' ? 24 : 8, Math.round(h)),
    },
  }
}

export function useCreateDesignBlock(): ((tool: CreateTool, drag: CreateDrag) => Promise<string | null>) | null {
  const editor = useBriefEditor()
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { activePageId, getDocument } = useBriefDocument()

  const create = useCallback(
    async (tool: CreateTool, drag: CreateDrag): Promise<string | null> => {
      if (studio === null) return null
      const pageId = activePageId
      const id = createId('blk')
      const { rect, line } = dragBox(tool, drag)
      const before = studio.currentJob()
      const hadResult = pageResultOf(before, pageId) !== undefined
      const wasStale = hadResult && pageResultIsStale(before, getDocument(), pageId)
      studio.markStep()

      if (tool === 'text') {
        const family = lastFamily() ?? FALLBACK_FAMILY
        editor.addBlockAt('free_text', id, rect, { content: NEW_TEXT, label: '문구' })
        await studio.setBlockOrder(id, { fontFamily: family })
      } else {
        const label = tool === 'shadow' ? '그림자' : (SHAPE_KINDS.find((k) => k.kind === tool)?.label ?? '도형')
        editor.addBlockAt('design_shape', id, rect, { label })
        // 그림자는 맨 뒤에서 시작한다 — 제품·문구 밑에 까는 것이 거의 언제나의 쓰임이다.
        if (tool === 'shadow') editor.reorderBlock(id, 'back')
        await studio.setBlockOrder(id, {
          shape:
            tool === 'shadow'
              ? { ...SHADOW_LAYER_LOOK }
              : { ...DEFAULT_SHAPE_LOOK, kind: tool, ...(line === undefined ? {} : { line }) },
        })
      }
      setTool('select')

      if (!hadResult) {
        if (tool === 'text') requestEdit(id)
        return id
      }

      // ── 완성본에도 바로 얹는다 ───────────────────────────────────────────
      const job = studio.currentJob()
      const layers = [...imageObjectsOf(job, pageId), ...textObjectsOf(job, pageId)].map((o) => o.layer)
      const layer =
        tool === 'shadow'
          ? (layers.length === 0 ? 0 : Math.min(...layers)) - 1
          : (layers.length === 0 ? 0 : Math.max(...layers)) + 1
      const painted =
        tool === 'text'
          ? await paintLiveText(
              {
                kind: 'text',
                blockId: id,
                text: NEW_TEXT,
                lines: planLines(NEW_TEXT, rect, true),
                family: studio.currentJob().blockOrders?.[id]?.fontFamily ?? FALLBACK_FAMILY,
                align: 'left',
              },
              rect,
            )
          : await paintLiveShape({ kind: 'shape', blockId: id, look: studio.currentJob().blockOrders?.[id]?.shape }, rect)
      if (painted !== null) {
        const object = {
          blockId: id,
          assetId: painted.assetId,
          rect: painted.rect,
          layer,
          live: true as const,
          frame: { ...rect },
          liveKey: painted.liveKey,
          ...(tool === 'text'
            ? { text: NEW_TEXT, lines: planLines(NEW_TEXT, rect, true), align: 'left' as const }
            : { kind: 'shape' as const }),
        }
        await studio.setTextObjects(pageId, [...textObjectsOf(studio.currentJob(), pageId), object])
        studio.selectObject(id)
      }

      // 기획서에 블록이 들어간 뒤 지문을 새로 적는다 — 만들기 전부터 어긋나 있었으면 두고.
      if (!wasStale) {
        for (let i = 0; i < 30; i += 1) {
          const doc = getDocument()
          if (doc.pages.some((p) => p.blocks.some((b) => b.id === id))) {
            const result = pageResultOf(studio.currentJob(), pageId)
            if (result !== undefined) await studio.recordResult({ ...result, sourceFingerprint: resultFingerprint(doc) })
            break
          }
          await new Promise((r) => setTimeout(r, 16))
        }
      }
      if (generation !== null) await generation.recomposePage(pageId)
      return id
    },
    [studio, editor, activePageId, getDocument, generation],
  )

  return studio === null ? null : create
}

/**
 * 완성본에 빠진 문구·도형 조각을 얹는다 (2026-09-17).
 *
 * 글꼴을 고르지 않아 문구가 빠진 채 만들어진 완성본이 있었다 — 문구는 브라우저가
 * 그리므로 다시 생성할 이유가 없다. 사람이 누를 때만 채운다: 일부러 지운 조각을
 * 저절로 되살리면 안 되기 때문이다. AI 호출은 0건이다.
 */
export function useFillMissingPieces(): { missing: number; fill: () => Promise<void> } | null {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { activePageId, getDocument } = useBriefDocument()
  if (studio === null || pageResultOf(studio.job, activePageId) === undefined) return null
  // 배너 조각은 기획서 블록과 번호가 달라 "빠졌다"를 셀 수 없다 — 배너는 서랍에서 꺼낸다.
  if (studio.bannerSpecOf(activePageId) !== null) return null
  const page = getDocument().pages.find((p) => p.id === activePageId)
  const have = new Set([...textObjectsOf(studio.job, activePageId), ...imageObjectsOf(studio.job, activePageId)].map((o) => o.blockId))
  const wanted = (page?.blocks ?? []).filter(
    (b) =>
      !have.has(b.id) &&
      b.aiVisibility === 'design' &&
      (b.type === 'design_shape' ||
        (getBlockTypeMeta(b.type).hasText && !getBlockTypeMeta(b.type).requiresAsset && (b.content ?? '').trim().length > 0)),
  )
  return {
    missing: wanted.length,
    fill: async () => {
      const job = studio.currentJob()
      const layers = [...imageObjectsOf(job, activePageId), ...textObjectsOf(job, activePageId)].map((o) => o.layer)
      let layer = layers.length === 0 ? 0 : Math.max(...layers)
      const made: StudioTextObject[] = []
      for (const block of wanted) {
        const order = studio.currentJob().blockOrders?.[block.id] ?? {}
        const rect = { ...block.position }
        layer += 1
        if (block.type === 'design_shape') {
          const painted = await paintLiveShape({ kind: 'shape', blockId: block.id, look: order.shape }, rect)
          if (painted !== null) {
            made.push({ blockId: block.id, assetId: painted.assetId, rect: painted.rect, layer, kind: 'shape', live: true, frame: rect, liveKey: painted.liveKey })
          }
          continue
        }
        const text = block.content ?? ''
        const lines = planLines(text, rect, drawsBareText(block))
        const align = textAlignOf(block)
        const painted = await paintLiveText(
          { kind: 'text', blockId: block.id, text, lines, family: fontOrDefault(order.fontFamily), weight: order.fontWeight, look: order.look, chars: order.chars, align },
          rect,
        )
        if (painted !== null) {
          made.push({ blockId: block.id, assetId: painted.assetId, rect: painted.rect, layer, live: true, frame: rect, liveKey: painted.liveKey, text, lines, align })
        }
      }
      if (made.length === 0) return
      studio.markStep()
      await studio.setTextObjects(activePageId, [...textObjectsOf(studio.currentJob(), activePageId), ...made])
      if (generation !== null) await generation.recomposePage(activePageId)
    },
  }
}
