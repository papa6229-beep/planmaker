/**
 * 살아 있는 조각을 지금 값에 맞춰 둔다 (살아 있는 문구 Patch · 문자·도형 도구 Patch, 2026-09-17).
 *
 * 완성본이 나온 뒤에도 문구와 도형은 그림이 아니다. 글꼴·색·테두리·그림자·글자별
 * 모양, 문구 자체, 도형의 모양과 크기가 바뀌면 그 조각만 브라우저가 다시 그리고
 * 완성본을 한 번 다시 합친다. AI 호출은 0건이다.
 *
 * 판단은 지문 하나로 한다: 지금 값으로 만든 지문(`liveKeyOf`)이 조각에 적힌 지문과
 * 다르면 다시 그린다. 그래서 되돌리기로 값과 그림이 함께 돌아오면 아무 일도 없고,
 * 파일을 다시 열어도 같은 판단이 선다.
 *
 * 하는 일이 하나 더 있다. **글자별 모양을 문구에 맞춰 옮긴다** — 문구를 고치면
 * 앞뒤의 같은 부분은 제 모양을 지키고 새 글자는 앞 글자의 모양을 잇는다.
 *
 * 화면에 아무것도 그리지 않는다.
 */

import { useEffect, useRef } from 'react'
import { useStudioJob } from './useStudioJob'
import { useImageGeneration } from './useImageGeneration'
import { useBriefDocument } from '../document/useBriefDocument'
import { blockOrderOf, pageResultOf, type StudioJob } from '../../domain/studioJob'
import { drawsBareText, textAlignOf } from '../../domain/simpleBlocks'
import { planLines } from '../../domain/textLayers'
import { realignCharStyles } from '../../domain/textArt'
import { normalizeTextLook } from '../../domain/textLook'
import { fontOrDefault } from '../../domain/fontCatalog'
import type { BriefDocument } from '../../domain/pageSchema'
import type { StudioTextObject } from '../../domain/textObjects'
import { liveKeyOf, paintLive, placeInFrame, type LiveInput } from './liveText'

/** 이 조각을 지금 값으로 그릴 재료. 그릴 수 없으면(빈 문구) `null`. */
export function liveInputOf(object: StudioTextObject, job: StudioJob, doc: BriefDocument): LiveInput | null {
  const order = blockOrderOf(job, object.blockId)
  if (object.kind === 'shape') return { kind: 'shape', blockId: object.blockId, look: order.shape }
  const block = doc.pages.flatMap((p) => p.blocks).find((b) => b.id === object.blockId)
  // 기획서에 블록이 있으면 그 문구와 줄이 기준이다. 없으면(배너 조각) 그릴 때 적어 둔 것.
  const text = block === undefined ? (object.text ?? '') : (block.content ?? '')
  if (text.trim().length === 0) return null
  const lines =
    block === undefined ? (object.lines ?? [text]) : planLines(text, block.position, drawsBareText(block))
  const align = block === undefined ? (object.align ?? 'center') : textAlignOf(block)
  return {
    kind: 'text',
    blockId: object.blockId,
    text,
    lines,
    // 고르지 않았으면 기본 글꼴.
    family: fontOrDefault(order.fontFamily),
    weight: order.fontWeight,
    look: order.look,
    chars: order.chars,
    align,
  }
}

export function LiveTextSync() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { getDocument } = useBriefDocument()
  const running = useRef(new Map<string, { again: boolean }>())
  const job = studio?.job ?? null
  const doc = getDocument()

  // ── 글자별 모양을 문구에 맞춘다 ─────────────────────────────────────────
  useEffect(() => {
    if (studio === null || job === null) return
    for (const block of doc.pages.flatMap((p) => p.blocks)) {
      const order = blockOrderOf(job, block.id)
      if (order.chars === undefined) continue
      const content = block.content ?? ''
      if (order.charsFor === content) continue
      const moved = realignCharStyles(order.charsFor ?? content, content, order.chars)
      void studio.setBlockOrder(block.id, { chars: moved, charsFor: content })
    }
  }, [studio, job, doc])

  // ── 값이 바뀐 조각을 다시 그린다 ────────────────────────────────────────
  useEffect(() => {
    if (studio === null || generation === null || job === null) return
    for (const [pageId, list] of Object.entries(job.textObjects ?? {})) {
      for (const object of list) {
        if (object.live !== true || object.frame === undefined) continue
        const input = liveInputOf(object, job, doc)
        if (input === null || liveKeyOf(input, object.frame) === object.liveKey) continue
        const id = `${pageId}:${object.blockId}`
        const slot = running.current.get(id)
        if (slot !== undefined) {
          slot.again = true
          continue
        }
        const mine = { again: false }
        running.current.set(id, mine)
        void (async () => {
          try {
            do {
              mine.again = false
              const now = studio.currentJob()
              const current = (now.textObjects?.[pageId] ?? []).find((o) => o.blockId === object.blockId)
              if (current?.live !== true || current.frame === undefined) break
              const fresh = liveInputOf(current, now, getDocument())
              if (fresh === null || liveKeyOf(fresh, current.frame) === current.liveKey) break
              const painted = await paintLive(fresh, current.frame)
              if (painted === null) break
              // 그리는 사이 조각을 옮겼을 수 있다 — 지금 틀에 앉힌다.
              const latest = (studio.currentJob().textObjects?.[pageId] ?? []).find(
                (o) => o.blockId === object.blockId,
              )
              if (latest?.live !== true || latest.frame === undefined) break
              const frame = latest.frame
              const rect =
                fresh.kind === 'shape'
                  ? {
                      x: frame.x + (painted.rect.x - current.frame.x),
                      y: frame.y + (painted.rect.y - current.frame.y),
                      width: frame.width + (painted.rect.width - current.frame.width),
                      height: frame.height + (painted.rect.height - current.frame.height),
                    }
                  : placeInFrame(painted.size, frame, fresh.align, normalizeTextLook(fresh.look).vertical)
              await studio.setLiveText(pageId, object.blockId, {
                assetId: painted.assetId,
                rect,
                frame,
                liveKey: fresh.kind === 'shape' ? liveKeyOf(fresh, frame) : painted.liveKey,
              })
              if (pageResultOf(studio.currentJob(), pageId) !== undefined) await generation.recomposePage(pageId)
            } while (mine.again)
          } finally {
            running.current.delete(id)
          }
        })()
      }
    }
  }, [studio, generation, job, doc, getDocument])

  return null
}
