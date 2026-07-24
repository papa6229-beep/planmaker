/**
 * Renders the whole planning canvas to a preview PNG (WORK_PLAN §7).
 *
 * Draws at logical scale 1 (840px wide, full canvas height) — independent of
 * the 0.6 on-screen zoom — into an offscreen <canvas>, so the preview is the
 * full plan, not a 504px slice of the editor DOM. No editor chrome (selection
 * borders, resize handles, toolbar). No external network resources. Fails
 * loudly (throws) so the export flow can stop rather than ship a blank file.
 */

import { getBlockTypeMeta } from '../domain/blockTypes'
import type { BriefBlock, EventBrief } from '../domain/briefSchema'
import { EventBriefError } from './eventBriefArchive'

const AREA_COLOR: Record<BriefBlock['aiVisibility'], string> = {
  design: '#2563eb',
  reference: '#b45309',
  publishing: '#7c3aed',
}
const AREA_BG: Record<BriefBlock['aiVisibility'], string> = {
  design: '#ffffff',
  reference: '#fff7ed',
  publishing: '#f4f0ff',
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  bmp: CanvasImageSource,
  bw: number,
  bh: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scale = Math.min(w / bw, h / bh)
  const dw = bw * scale
  const dh = bh * scale
  ctx.drawImage(bmp, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

async function toBitmap(blob: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const ch of text) {
    const test = current + ch
    if (ctx.measureText(test).width > maxWidth && current.length > 0) {
      lines.push(current)
      current = ch
      if (lines.length >= maxLines) return lines
    } else {
      current = test
    }
  }
  if (current.length > 0 && lines.length < maxLines) lines.push(current)
  return lines
}

/**
 * Renders the brief to a PNG Blob. `blobs` maps assetId → image binary.
 */
export async function renderPreviewPng(brief: EventBrief, blobs: Map<string, Blob>): Promise<Blob> {
  const width = brief.project.canvasWidth
  const height = brief.project.canvasHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new EventBriefError('PREVIEW_FAILED', '미리보기 캔버스를 생성할 수 없습니다.')
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  for (const block of brief.blocks) {
    const { x, y, width: w, height: h } = block.position
    const meta = getBlockTypeMeta(block.type)

    ctx.fillStyle = AREA_BG[block.aiVisibility]
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = '#d8dce3'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    // Left area bar.
    ctx.fillStyle = AREA_COLOR[block.aiVisibility]
    ctx.fillRect(x, y, 4, h)

    const padX = x + 12
    const bmp = meta.requiresAsset ? await toBitmap(blobs.get(block.assetId ?? '') ?? new Blob()) : null

    // Title.
    ctx.fillStyle = '#1f2430'
    ctx.font = '600 15px system-ui, "Malgun Gothic", sans-serif'
    ctx.textBaseline = 'top'
    ctx.fillText(block.label, padX, y + 10, w - 20)

    if (bmp) {
      drawContain(ctx, bmp, bmp.width, bmp.height, x + 8, y + 34, w - 16, h - 44)
    } else {
      const body = block.content?.trim() || (meta.requiresAsset ? '(이미지 미지정)' : '')
      if (body) {
        ctx.fillStyle = '#6b7280'
        ctx.font = '13px system-ui, "Malgun Gothic", sans-serif'
        const lines = wrapText(ctx, body, w - 24, Math.max(1, Math.floor((h - 40) / 18)))
        lines.forEach((line, i) => ctx.fillText(line, padX, y + 34 + i * 18))
      }
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) {
    throw new EventBriefError('PREVIEW_FAILED', '미리보기 PNG 생성에 실패했습니다.')
  }
  return blob
}
