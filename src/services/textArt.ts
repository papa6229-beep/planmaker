/**
 * 문자 도구의 붓 (문자 도구 Patch, 2026-09-17).
 *
 * 자리는 `domain/textArt.ts`가 정하고, 여기서는 그 자리에 글자를 칠한다. 캔버스
 * 미리보기(기획서 블록)와 완성본 조각이 **이 함수 하나**로 그려진다 — 둘이 다른
 * 그림일 이유가 없다.
 *
 * 칠하는 차례: 그림자 → 바깥 테두리 → 안쪽 테두리 → 몸통. 테두리는 글자를 굵게
 * 그은 뒤 그 위에 다음 겹을 얹는 방식이라 글자가 가늘어지지 않는다.
 *
 * AI 호출은 없다. 글꼴 파일은 처음 쓸 때 한 번 받는다.
 */

import {
  fitTextArtSize,
  layoutTextArt,
  mapLinesToContent,
  type CharStyles,
  type GlyphFont,
  type PlacedGlyph,
  type TextArtAlign,
} from '../domain/textArt'
import { outlineReach, shadowOffset, type TextLook } from '../domain/textLook'
import { applyTone, toneIsFlat, type ToneAdjust } from '../domain/toneAdjust'
import { DEFAULT_WEIGHT, FALLBACK_FAMILY, pickWeight } from '../domain/fontCatalog'
import { fontFamilies } from '../features/studio/blockFont'
import { faceName, loadFont } from './fontLoader'

export interface TextArtRequest {
  content: string
  lines: readonly string[]
  family: string
  weight?: number | undefined
  chars?: CharStyles | undefined
  look: TextLook
  align: TextArtAlign
  /** 그림의 해상도 목표 (px). 글자가 이 안에 가장 크게 들어간다. */
  target: { width: number; height: number }
  /** 캔버스 미리보기에만 — 완성본은 합칠 때 톤을 건다. */
  tone?: ToneAdjust | undefined
}

export interface TextArtResult {
  blob: Blob
  width: number
  height: number
}

const FALLBACK_STACK = '"Pretendard", "Noto Sans KR", system-ui, sans-serif'
/** 캔버스 한 변의 한도. 이보다 크면 브라우저가 그리기를 거절한다. */
const MAX_SIDE = 4096
const ASCENT = 0.88
const DESCENT = 0.14

type FaceMap = Map<string, { face: string; weight: number } | null>

const keyOf = (family: string, weight: number) => `${family}@${String(weight)}`

/** 쓰이는 글꼴을 모두 받아 둔다. 못 받은 것은 기본 글꼴로 그린다. */
async function loadFaces(request: TextArtRequest): Promise<FaceMap> {
  const wanted = new Map<string, { family: string; weight: number }>()
  const baseWeight = request.weight ?? DEFAULT_WEIGHT
  wanted.set(keyOf(request.family, baseWeight), { family: request.family, weight: baseWeight })
  for (const style of request.chars ?? []) {
    if (style === null) continue
    const family = style.family ?? request.family
    const weight = style.weight ?? baseWeight
    wanted.set(keyOf(family, weight), { family, weight })
  }
  const families = await fontFamilies()
  const faces: FaceMap = new Map()
  for (const [key, want] of wanted) {
    const found =
      families.find((f) => f.family === want.family) ?? families.find((f) => f.family === FALLBACK_FAMILY)
    const file = found === undefined ? null : pickWeight(found, want.weight)
    faces.set(key, file !== null && (await loadFont(file)) ? { face: faceName(file), weight: file.weight } : null)
  }
  return faces
}

function cssFont(font: GlyphFont, faces: FaceMap): string {
  const face = faces.get(keyOf(font.family, font.weight))
  const size = Math.max(1, font.size)
  return face == null
    ? `${String(font.weight)} ${size.toFixed(2)}px ${FALLBACK_STACK}`
    : `${String(face.weight)} ${size.toFixed(2)}px "${face.face}", ${FALLBACK_STACK}`
}

function paint(
  ctx: CanvasRenderingContext2D,
  glyphs: readonly PlacedGlyph[],
  origin: { x: number; y: number },
  faces: FaceMap,
  each: (c: CanvasRenderingContext2D, g: PlacedGlyph) => void,
): void {
  for (const g of glyphs) {
    if (g.ch.trim().length === 0) continue
    ctx.save()
    ctx.translate(origin.x + g.x, origin.y + g.y)
    if (g.rotate !== 0) ctx.rotate(g.rotate)
    ctx.font = cssFont(g.font, faces)
    ctx.textAlign = g.anchor === 'baseline' ? 'left' : 'center'
    ctx.textBaseline = g.anchor === 'baseline' ? 'alphabetic' : 'middle'
    each(ctx, g)
    ctx.restore()
  }
}

function blank(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  return ctx === null ? null : { canvas, ctx }
}

export async function renderTextArt(request: TextArtRequest): Promise<TextArtResult | null> {
  const rows = mapLinesToContent(request.content, request.lines.length > 0 ? request.lines : [request.content]).filter(
    (row) => row.some((c) => c.ch.trim().length > 0),
  )
  if (rows.length === 0) return null
  const faces = await loadFaces(request)
  const probe = blank(1, 1)
  if (probe === null) return null
  const measure = (ch: string, font: GlyphFont) => {
    probe.ctx.font = cssFont(font, faces)
    return { width: probe.ctx.measureText(ch).width, ascent: font.size * ASCENT, descent: font.size * DESCENT }
  }
  const input = {
    rows,
    base: { family: request.family, weight: request.weight ?? DEFAULT_WEIGHT },
    chars: request.chars,
    look: request.look,
    align: request.align,
    measure,
  }
  let size = fitTextArtSize(input, request.target)
  let layout = layoutTextArt({ ...input, size })
  const extent = () => ({
    w: Math.ceil(layout.bounds.x1 - layout.bounds.x0 + layout.pad.left + layout.pad.right),
    h: Math.ceil(layout.bounds.y1 - layout.bounds.y0 + layout.pad.top + layout.pad.bottom),
  })
  let { w, h } = extent()
  if (w > MAX_SIDE || h > MAX_SIDE) {
    size = Math.max(4, Math.floor(size * Math.min(MAX_SIDE / w, MAX_SIDE / h) * 0.98))
    layout = layoutTextArt({ ...input, size })
    ;({ w, h } = extent())
  }
  if (!(w > 0) || !(h > 0)) return null

  const main = blank(w, h)
  if (main === null) return null
  const { ctx } = main
  const origin = { x: layout.pad.left - layout.bounds.x0, y: layout.pad.top - layout.bounds.y0 }
  const look = request.look
  const inner = look.outline ? look.outlineWidth * size : 0
  const outer = outlineReach(look) * size
  const lineJoin = (c: CanvasRenderingContext2D) => {
    c.lineJoin = 'round'
    c.lineCap = 'round'
    c.miterLimit = 2
  }

  // ① 그림자 — 가장 바깥 겹의 실루엣을 밀고 흐린다.
  if (look.shadow) {
    const shape = blank(w, h)
    if (shape !== null) {
      shape.ctx.fillStyle = '#000'
      shape.ctx.strokeStyle = '#000'
      paint(shape.ctx, layout.glyphs, origin, faces, (c, g) => {
        if (outer > 0) {
          lineJoin(c)
          c.lineWidth = outer * 2
          c.strokeText(g.ch, 0, 0)
        }
        c.fillText(g.ch, 0, 0)
      })
      const { dx, dy } = shadowOffset(look)
      // 멀리 그리고 그림자만 제자리로 — 흐림을 캔버스가 해 준다.
      const far = w + h + 1000
      ctx.save()
      ctx.globalAlpha = look.shadowOpacity
      ctx.shadowColor = look.shadowColor
      ctx.shadowBlur = look.shadowBlur * size
      ctx.shadowOffsetX = dx * size + far
      ctx.shadowOffsetY = dy * size
      ctx.drawImage(shape.canvas, -far, 0)
      ctx.restore()
    }
  }

  // ② 바깥 테두리
  if (look.outline2 && outer > 0) {
    ctx.strokeStyle = look.outline2Color
    ctx.fillStyle = look.outline2Color
    paint(ctx, layout.glyphs, origin, faces, (c, g) => {
      lineJoin(c)
      c.lineWidth = outer * 2
      c.strokeText(g.ch, 0, 0)
      c.fillText(g.ch, 0, 0)
    })
  }
  // ③ 안쪽 테두리
  if (inner > 0) {
    ctx.strokeStyle = look.outlineColor
    ctx.fillStyle = look.outlineColor
    paint(ctx, layout.glyphs, origin, faces, (c, g) => {
      lineJoin(c)
      c.lineWidth = inner * 2
      c.strokeText(g.ch, 0, 0)
      c.fillText(g.ch, 0, 0)
    })
  }

  // ④ 몸통 — 글자별 색이 없는 글자는 문구 색(그라데이션이면 문구 전체의 위→아래).
  const plain = layout.glyphs.filter((g) => g.color === null)
  const colored = layout.glyphs.filter((g) => g.color !== null)
  if (look.fill === 'gradient' && plain.length > 0) {
    const body = blank(w, h)
    if (body !== null) {
      body.ctx.fillStyle = '#000'
      paint(body.ctx, plain, origin, faces, (c, g) => c.fillText(g.ch, 0, 0))
      body.ctx.globalCompositeOperation = 'source-in'
      const grad = body.ctx.createLinearGradient(0, layout.pad.top, 0, h - layout.pad.bottom)
      grad.addColorStop(0, look.color)
      grad.addColorStop(1, look.color2)
      body.ctx.fillStyle = grad
      body.ctx.fillRect(0, 0, w, h)
      ctx.drawImage(body.canvas, 0, 0)
    }
  } else {
    ctx.fillStyle = look.color
    paint(ctx, plain, origin, faces, (c, g) => c.fillText(g.ch, 0, 0))
  }
  for (const g of colored) {
    ctx.fillStyle = g.color!
    paint(ctx, [g], origin, faces, (c) => c.fillText(g.ch, 0, 0))
  }

  if (request.tone !== undefined && !toneIsFlat(request.tone)) {
    const pixels = ctx.getImageData(0, 0, w, h)
    applyTone(pixels.data, request.tone)
    ctx.putImageData(pixels, 0, 0)
  }

  const blob = await new Promise<Blob | null>((resolve) => main.canvas.toBlob(resolve, 'image/png'))
  return blob === null ? null : { blob, width: w, height: h }
}
