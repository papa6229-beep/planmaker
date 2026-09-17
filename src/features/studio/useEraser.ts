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
import { brushStops, dabsBetween, localPoint, maskSizeFor } from '../../domain/eraseMask'
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
      /** 저장·미리보기로 나가는 마스크 = 누르기 전 마스크 + 이번 문지르기. */
      let canvas: HTMLCanvasElement | null = null
      /** 누르기 전 마스크. */
      let base: HTMLCanvasElement | null = null
      /**
       * 이번 문지르기의 세기 판 (불투명한 회색, 밝을수록 세게).
       *
       * 붓 자국은 `lighten`으로 찍는다 — 겹친 자리는 **더 센 쪽만** 남는다. 포토샵이 한 번
       * 문지르는 동안 불투명도를 넘지 않는 것과 같은 규칙이다. 그래서 부드러운 가장자리가
       * 겹쳐도 진해지지 않는다 (지우개 부드러운 가장자리 Patch).
       */
      let strength: HTMLCanvasElement | null = null
      /** 세기 판을 알파로 옮긴 판. */
      let alpha: HTMLCanvasElement | null = null
      let dirty: { x0: number; y0: number; x1: number; y1: number } | null = null
      const stops = brushStops(settings.hardness)
      const pending: Point[] = [start]
      let last = start
      let frame = 0
      let flushing = false
      let again = false
      let ended = false

      const blank = (w: number, h: number) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        return c
      }

      const dab = (ctx: CanvasRenderingContext2D, p: Point) => {
        const { u, v } = localPoint(rect, object.angle, p)
        const w = ctx.canvas.width
        const h = ctx.canvas.height
        const x = u * w
        const y = v * h
        const r = Math.max(0.5, (settings.size / 2) * (w / Math.max(1, rect.width)))
        if (x < -r || y < -r || x > w + r || y > h + r) return
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
        for (const stop of stops) {
          const g = Math.round(255 * settings.strength * stop.value)
          grad.addColorStop(stop.at, `rgb(${String(g)},${String(g)},${String(g)})`)
        }
        ctx.globalCompositeOperation = 'lighten'
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
        const box = {
          x0: Math.max(0, Math.floor(x - r)),
          y0: Math.max(0, Math.floor(y - r)),
          x1: Math.min(w, Math.ceil(x + r)),
          y1: Math.min(h, Math.ceil(y + r)),
        }
        dirty =
          dirty === null
            ? box
            : {
                x0: Math.min(dirty.x0, box.x0),
                y0: Math.min(dirty.y0, box.y0),
                x1: Math.max(dirty.x1, box.x1),
                y1: Math.max(dirty.y1, box.y1),
              }
      }

      const paint = () => {
        const sctx = strength?.getContext('2d')
        if (sctx === undefined || sctx === null || canvas === null || base === null || alpha === null) return
        for (const p of pending.splice(0)) dab(sctx, p)
        if (dirty === null) return
        const { x0, y0, x1, y1 } = dirty
        dirty = null
        const bw = x1 - x0
        const bh = y1 - y0
        if (bw <= 0 || bh <= 0) return
        // 세기(밝기) → 알파. 바뀐 자리만 옮긴다.
        const src = sctx.getImageData(x0, y0, bw, bh)
        const actx = alpha.getContext('2d')
        if (actx === null) return
        const out = actx.createImageData(bw, bh)
        for (let i = 0; i < src.data.length; i += 4) out.data[i + 3] = src.data[i]!
        actx.putImageData(out, x0, y0)
        // 누르기 전 마스크 위에 이번 문지르기를 얹는다 (되살리기면 그만큼 뺀다).
        const ctx = canvas.getContext('2d')
        if (ctx === null) return
        ctx.globalCompositeOperation = 'copy'
        ctx.drawImage(base, 0, 0)
        ctx.globalCompositeOperation = settings.restore ? 'destination-out' : 'source-over'
        ctx.drawImage(alpha, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
      }

      // 미리보기: 한 번에 하나만 흐르고, 그동안 더 칠했으면 끝난 뒤 한 번 더.
      const flush = async () => {
        if (canvas === null) return
        if (flushing) {
          again = true
          return
        }
        flushing = true
        do {
          again = false
          const blob = await toBlob(canvas)
          if (ended) break
          if (blob !== null) {
            setLiveMask(blockId, blob)
            generation?.previewPage(pageId)
          }
        } while (again && !ended)
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
        if (c === null) return
        base = c
        canvas = blank(c.width, c.height)
        alpha = blank(c.width, c.height)
        strength = blank(c.width, c.height)
        const sctx = strength.getContext('2d')
        if (sctx === null) {
          canvas = null
          return
        }
        sctx.fillStyle = '#000'
        sctx.fillRect(0, 0, c.width, c.height)
        // 판 밖만 문질렀어도 저장되는 것은 누르기 전 그대로여야 한다.
        canvas.getContext('2d')?.drawImage(c, 0, 0)
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
