/**
 * 지우개로 문지르기 (지우개 Patch, 2026-09-17). 규칙은 `domain/eraseMask.ts`.
 *
 * 누르는 순간 고른 조각의 마스크(없으면 빈 판)를 꺼내 놓고, 움직이는 동안 붓 자국을
 * 찍는다. 화면은 한 프레임에 한 번 칠하는 판을 합치기에 넘겨 미리 보여 주고
 * (`previewPage`), 손을 떼면 한 장만 저장한 뒤 완성본을 다시 합친다. AI 호출은 없다.
 */

import { useCallback } from 'react'
import { useStudioJob } from './useStudioJob'
import { useImageGeneration } from './useImageGeneration'
import { eraserSettings } from './designTools'
import { createId } from '../../domain/factory'
import { dabsBetween, localPoint, maskSizeFor } from '../../domain/eraseMask'
import { getAsset, putAsset } from '../../services/assetStore'
import { setLiveMask } from '../../services/liveMasks'
import type { StudioTextObject } from '../../domain/textObjects'

type Point = { x: number; y: number }

async function loadMask(assetId: string | undefined, fallback: { width: number; height: number }): Promise<HTMLCanvasElement | null> {
  const canvas = document.createElement('canvas')
  const stored = assetId === undefined ? undefined : await getAsset(assetId)
  let bitmap: ImageBitmap | null = null
  if (stored !== undefined && typeof createImageBitmap === 'function') {
    try {
      bitmap = await createImageBitmap(stored.blob)
    } catch {
      bitmap = null
    }
  }
  canvas.width = bitmap?.width ?? fallback.width
  canvas.height = bitmap?.height ?? fallback.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  if (bitmap !== null) ctx.drawImage(bitmap, 0, 0)
  return canvas
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

export interface EraserStroke {
  /** 지면 좌표의 한 점으로 문지르기를 시작한다. 돌려준 함수들로 이어 가고 끝낸다. */
  begin: (
    pageId: string,
    object: StudioTextObject,
    at: Point,
  ) => { move: (at: Point) => void; end: () => Promise<void> }
  /** 이 조각의 지운 자리를 모두 되돌린다. */
  clear: (pageId: string, blockId: string) => Promise<void>
}

export function useEraser(): EraserStroke | null {
  const studio = useStudioJob()
  const generation = useImageGeneration()

  const begin = useCallback<EraserStroke['begin']>(
    (pageId, object, start) => {
      if (studio === null) return { move: () => {}, end: async () => {} }
      const blockId = object.blockId
      const rect = object.rect
      const settings = eraserSettings()
      // 이 문지르기 하나가 되돌리기 한 칸이다.
      studio.markStep()
      let canvas: HTMLCanvasElement | null = null
      const pending: Point[] = [start]
      let last = start
      let frame = 0
      let flushing = false
      let dirty = false
      let ended = false

      const dab = (ctx: CanvasRenderingContext2D, p: Point) => {
        const { u, v } = localPoint(rect, object.angle, p)
        const w = ctx.canvas.width
        const h = ctx.canvas.height
        const x = u * w
        const y = v * h
        const r = Math.max(0.5, (settings.size / 2) * (w / Math.max(1, rect.width)))
        if (x < -r || y < -r || x > w + r || y > h + r) return
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
        const alpha = settings.strength
        grad.addColorStop(0, `rgba(0,0,0,${String(alpha)})`)
        grad.addColorStop(Math.min(0.999, Math.max(0, settings.hardness)), `rgba(0,0,0,${String(alpha)})`)
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalCompositeOperation = settings.restore ? 'destination-out' : 'source-over'
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }

      const paint = () => {
        const ctx = canvas?.getContext('2d')
        if (ctx === undefined || ctx === null) return
        for (const p of pending.splice(0)) dab(ctx, p)
      }

      // 미리보기: 한 번에 하나만 흐르고, 그동안 더 칠했으면 끝난 뒤 한 번 더.
      const flush = async () => {
        if (canvas === null) return
        if (flushing) {
          dirty = true
          return
        }
        flushing = true
        do {
          dirty = false
          const blob = await toBlob(canvas)
          if (ended) break
          if (blob !== null) {
            setLiveMask(blockId, blob)
            generation?.previewPage(pageId)
          }
        } while (dirty && !ended)
        flushing = false
      }

      const schedule = () => {
        if (frame !== 0 || canvas === null) return
        frame = requestAnimationFrame(() => {
          frame = 0
          paint()
          void flush()
        })
      }

      const ready = loadMask(studio.currentJob().eraseMasks?.[blockId], maskSizeFor(rect)).then((c) => {
        canvas = c
        schedule()
      })

      return {
        move: (at) => {
          pending.push(...dabsBetween(last, at, settings.size))
          last = at
          schedule()
        },
        end: async () => {
          await ready
          ended = true
          if (frame !== 0) cancelAnimationFrame(frame)
          frame = 0
          paint()
          const done = canvas === null ? null : await toBlob(canvas)
          if (done !== null) {
            const assetId = createId('asset')
            await putAsset({ id: assetId, blob: done, fileName: `mask-${blockId}.png`, mimeType: 'image/png', byteSize: done.size })
            await studio.setEraseMask(blockId, assetId)
          }
          setLiveMask(blockId, null)
          await generation?.recomposePage(pageId)
        },
      }
    },
    [studio, generation],
  )

  const clear = useCallback<EraserStroke['clear']>(
    async (pageId, blockId) => {
      if (studio === null || studio.currentJob().eraseMasks?.[blockId] === undefined) return
      studio.markStep()
      await studio.setEraseMask(blockId, null)
      await generation?.recomposePage(pageId)
    },
    [studio, generation],
  )

  return studio === null ? null : { begin, clear }
}
