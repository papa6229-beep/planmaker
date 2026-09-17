/**
 * 살아 있는 문구를 지금 값에 맞춰 둔다 (살아 있는 문구 Patch, 2026-09-17).
 *
 * 완성본이 나온 뒤에도 문구는 텍스트다. 글꼴·굵기·색·테두리·그림자나 문구 자체가
 * 바뀌면, 그 조각만 브라우저가 다시 그리고 완성본을 한 번 다시 합친다. AI 호출은
 * 0건이다.
 *
 * 판단은 지문 하나로 한다: 지금 값으로 만든 지문(`liveKeyOf`)이 조각에 적힌 지문과
 * 다르면 다시 그린다. 그래서 되돌리기로 값과 그림이 함께 돌아오면 아무 일도 없고,
 * 파일을 다시 열어도 같은 판단이 선다.
 *
 * 화면에 아무것도 그리지 않는다. 같은 조각을 두 번 겹쳐 그리지 않도록, 그리는
 * 중에 값이 또 바뀌면 끝난 뒤 한 번 더 그린다.
 */

import { useEffect, useRef } from 'react'
import { useStudioJob } from './useStudioJob'
import { useImageGeneration } from './useImageGeneration'
import { useBriefDocument } from '../document/useBriefDocument'
import { blockOrderOf, pageResultOf, type StudioJob } from '../../domain/studioJob'
import { drawsBareText } from '../../domain/simpleBlocks'
import { containRect, planLines } from '../../domain/textLayers'
import type { BriefDocument } from '../../domain/pageSchema'
import type { StudioTextObject } from '../../domain/textObjects'
import { liveKeyOf, paintLiveText, type LiveTextInput } from './liveText'

/** 이 조각을 지금 값으로 그릴 재료. 글꼴이 없거나 문구가 비었으면 `null`. */
export function liveInputOf(object: StudioTextObject, job: StudioJob, doc: BriefDocument): LiveTextInput | null {
  const order = blockOrderOf(job, object.blockId)
  if (order.fontFamily === undefined || order.fontFamily.length === 0) return null
  const block = doc.pages.flatMap((p) => p.blocks).find((b) => b.id === object.blockId)
  // 기획서에 블록이 있으면 그 문구와 줄이 기준이다. 없으면(배너 조각) 그릴 때 적어 둔 것.
  const text = block === undefined ? (object.text ?? '') : (block.content ?? '')
  if (text.trim().length === 0) return null
  const lines =
    block === undefined ? (object.lines ?? [text]) : planLines(text, block.position, drawsBareText(block))
  return { blockId: object.blockId, text, lines, family: order.fontFamily, weight: order.fontWeight, look: order.look }
}

export function LiveTextSync() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { getDocument } = useBriefDocument()
  const running = useRef(new Map<string, { again: boolean }>())
  const job = studio?.job ?? null
  const doc = getDocument()

  useEffect(() => {
    if (studio === null || generation === null || job === null) return
    for (const [pageId, list] of Object.entries(job.textObjects ?? {})) {
      for (const object of list) {
        if (object.live !== true || object.frame === undefined) continue
        const input = liveInputOf(object, job, doc)
        if (input === null || liveKeyOf(input) === object.liveKey) continue
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
              if (fresh === null || liveKeyOf(fresh) === current.liveKey) break
              const painted = await paintLiveText(fresh, current.frame)
              if (painted === null) break
              // 그리는 사이 조각을 옮겼을 수 있다 — 지금 틀에 앉힌다.
              const latest = (studio.currentJob().textObjects?.[pageId] ?? []).find(
                (o) => o.blockId === object.blockId,
              )
              if (latest?.live !== true || latest.frame === undefined) break
              await studio.setLiveText(pageId, object.blockId, {
                assetId: painted.assetId,
                rect: containRect(painted.size, latest.frame),
                frame: latest.frame,
                liveKey: painted.liveKey,
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
