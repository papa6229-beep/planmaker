/**
 * 도형의 붓 (도형 도구 Patch, 2026-09-17).
 *
 * 모양은 `domain/shapeLook.ts`가 점으로 내놓고, 여기서 칠한다. 기획서 캔버스의
 * 미리보기와 완성본 조각이 같은 함수로 그려진다. AI 호출은 없다.
 *
 * 칠하는 차례: 그림자 → 채우기 → 테두리(선). 불투명도는 다 칠한 한 장에 한 번 건다
 * — 채우기와 테두리가 겹친 곳이 두 번 옅어지지 않도록.
 */

import {
  ARROW_SCALE,
  lineEnds,
  shapePad,
  shapePath,
  type PathOp,
  type ShapeLook,
} from '../domain/shapeLook'
import { applyTone, toneIsFlat, type ToneAdjust } from '../domain/toneAdjust'

export interface ShapeArtResult {
  blob: Blob
  /** 그림의 픽셀 크기. */
  width: number
  height: number
  /** 도형 상자 밖으로 나간 여백 (지면 px). 그림은 상자를 이만큼 넓힌 자리에 앉는다. */
  pad: { left: number; top: number; right: number; bottom: number }
}

const MAX_SIDE = 2048

function trace(ctx: CanvasRenderingContext2D, ops: readonly PathOp[]): void {
  ctx.beginPath()
  for (const o of ops) {
    if (o.op === 'M') ctx.moveTo(o.x, o.y)
    else if (o.op === 'L') ctx.lineTo(o.x, o.y)
    else if (o.op === 'Q') ctx.quadraticCurveTo(o.cx, o.cy, o.x, o.y)
    else if (o.op === 'C') ctx.bezierCurveTo(o.c1x, o.c1y, o.c2x, o.c2y, o.x, o.y)
    else if (o.op === 'E') ctx.ellipse(o.cx, o.cy, Math.max(0.01, o.rx), Math.max(0.01, o.ry), 0, 0, Math.PI * 2)
    else ctx.closePath()
  }
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, fromX: number, fromY: number, size: number): void {
  const a = Math.atan2(y - fromY, x - fromX)
  ctx.beginPath()
  ctx.moveTo(x + Math.cos(a) * size * 0.35, y + Math.sin(a) * size * 0.35)
  ctx.lineTo(x + Math.cos(a + Math.PI * 0.82) * size, y + Math.sin(a + Math.PI * 0.82) * size)
  ctx.lineTo(x + Math.cos(a - Math.PI * 0.82) * size, y + Math.sin(a - Math.PI * 0.82) * size)
  ctx.closePath()
  ctx.fill()
}

/** 한 벌 칠하기 — 그림자 실루엣에도, 실제 그림에도 쓴다. */
function drawShape(ctx: CanvasRenderingContext2D, look: ShapeLook, w: number, h: number, silhouette: boolean): void {
  const ops = shapePath(look, w, h)
  const isLine = look.kind === 'line'
  if (look.fill && !isLine) {
    trace(ctx, ops)
    if (silhouette) ctx.fillStyle = '#000'
    else if (look.fillMode === 'gradient') {
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, look.fillColor)
      grad.addColorStop(1, look.fillColor2)
      ctx.fillStyle = grad
    } else ctx.fillStyle = look.fillColor
    ctx.fill()
  }
  if (look.stroke) {
    const sw = look.strokeWidth
    ctx.lineWidth = sw
    ctx.lineJoin = 'round'
    ctx.lineCap = look.dash === 'dotted' || isLine ? 'round' : 'butt'
    ctx.setLineDash(look.dash === 'dashed' ? [sw * 3, sw * 2] : look.dash === 'dotted' ? [0.01, sw * 2] : [])
    ctx.strokeStyle = silhouette ? '#000' : look.strokeColor
    trace(ctx, ops)
    ctx.stroke()
    ctx.setLineDash([])
    if (isLine && (look.arrowStart || look.arrowEnd)) {
      ctx.fillStyle = silhouette ? '#000' : look.strokeColor
      const { x1, y1, x2, y2 } = lineEnds(look, w, h)
      if (look.arrowEnd) arrowHead(ctx, x2, y2, x1, y1, sw * ARROW_SCALE)
      if (look.arrowStart) arrowHead(ctx, x1, y1, x2, y2, sw * ARROW_SCALE)
    }
  }
}

function blank(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  return ctx === null ? null : { canvas, ctx }
}

/**
 * `box`는 도형 상자의 지면 크기다. `scale`은 지면 1px을 몇 픽셀로 그릴지 —
 * 없으면 선명하게 2배, 다만 한 변 2048px을 넘지 않게.
 */
export async function renderShapeArt(
  look: ShapeLook,
  box: { width: number; height: number },
  options: { tone?: ToneAdjust | undefined; scale?: number } = {},
): Promise<ShapeArtResult | null> {
  const w = Math.max(1, box.width)
  const h = Math.max(1, box.height)
  const pad = shapePad(look)
  const fullW = w + pad.left + pad.right
  const fullH = h + pad.top + pad.bottom
  const k = Math.max(0.1, Math.min(options.scale ?? 2, MAX_SIDE / Math.max(fullW, fullH)))
  const pw = Math.max(1, Math.ceil(fullW * k))
  const ph = Math.max(1, Math.ceil(fullH * k))

  const art = blank(pw, ph)
  if (art === null) return null
  const place = (c: CanvasRenderingContext2D) => {
    c.setTransform(k, 0, 0, k, pad.left * k, pad.top * k)
  }

  if (look.shadow) {
    const shade = blank(pw, ph)
    if (shade !== null) {
      place(shade.ctx)
      drawShape(shade.ctx, look, w, h, true)
      const a = (look.shadowAngle * Math.PI) / 180
      const far = pw + ph + 1000
      art.ctx.save()
      art.ctx.globalAlpha = look.shadowOpacity
      art.ctx.shadowColor = look.shadowColor
      art.ctx.shadowBlur = look.shadowBlur * k
      art.ctx.shadowOffsetX = Math.cos(a) * look.shadowDistance * k + far
      art.ctx.shadowOffsetY = Math.sin(a) * look.shadowDistance * k
      art.ctx.drawImage(shade.canvas, -far, 0)
      art.ctx.restore()
    }
  }

  const body = blank(pw, ph)
  if (body === null) return null
  place(body.ctx)
  drawShape(body.ctx, look, w, h, false)
  art.ctx.save()
  art.ctx.globalAlpha = look.opacity
  art.ctx.drawImage(body.canvas, 0, 0)
  art.ctx.restore()

  if (options.tone !== undefined && !toneIsFlat(options.tone)) {
    const pixels = art.ctx.getImageData(0, 0, pw, ph)
    applyTone(pixels.data, options.tone)
    art.ctx.putImageData(pixels, 0, 0)
  }

  const blob = await new Promise<Blob | null>((resolve) => art.canvas.toBlob(resolve, 'image/png'))
  return blob === null ? null : { blob, width: pw, height: ph, pad }
}
