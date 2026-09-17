/**
 * 살아 있는 조각을 그린다 — 문구와 도형 (살아 있는 문구 Patch · 문자·도형 도구 Patch, 2026-09-17).
 *
 * 문구와 도형은 AI를 거치지 않는다. 브라우저가 고른 글꼴·색·테두리·그림자로 한 장을
 * 그려 완성본의 앞 겹에 얹는다. 생성할 때 한 번, 그 뒤로는 **값이 바뀔 때마다**
 * 다시 그린다 (`LiveTextSync`). 외부 호출은 0건이다.
 *
 * 무엇으로 그렸는지는 지문(`liveKeyOf`)으로 남긴다. 지금 값의 지문이 다르면 다시
 * 그릴 때가 된 것이다 — 파일을 다시 열어도 같은 판단이 선다.
 */

import { createId } from '../../domain/factory'
import type { LayoutRect } from '../../domain/imageLayout'
import { normalizeCharStyles, type CharStyles, type TextArtAlign } from '../../domain/textArt'
import { normalizeTextLook, type TextLook } from '../../domain/textLook'
import { normalizeShapeLook, type ShapeLook } from '../../domain/shapeLook'
import type { ToneAdjust } from '../../domain/toneAdjust'
import { putAsset } from '../../services/assetStore'
import { renderTextArt } from '../../services/textArt'
import { renderShapeArt } from '../../services/shapeArt'
import { trimToContent } from '../../services/trimToContent'

export interface LiveTextInput {
  kind?: 'text'
  blockId: string
  text: string
  lines: readonly string[]
  family: string
  weight?: number | undefined
  look?: TextLook | undefined
  chars?: CharStyles | undefined
  align?: TextArtAlign | undefined
}

export interface LiveShapeInput {
  kind: 'shape'
  blockId: string
  look?: ShapeLook | undefined
}

export type LiveInput = LiveTextInput | LiveShapeInput

/** 이 값으로 그린 그림의 지문. 하나라도 다르면 다르다. 도형은 상자 크기도 모양이다. */
export function liveKeyOf(input: LiveInput, frame?: { width: number; height: number }): string {
  if (input.kind === 'shape') {
    return JSON.stringify([
      'shape',
      normalizeShapeLook(input.look),
      Math.round(frame?.width ?? 0),
      Math.round(frame?.height ?? 0),
    ])
  }
  return JSON.stringify([
    input.text.trim(),
    input.lines,
    input.family,
    input.weight ?? null,
    normalizeTextLook(input.look),
    normalizeCharStyles(input.chars) ?? null,
    input.align ?? 'center',
  ])
}

export interface LivePaint {
  assetId: string
  /** 그림의 픽셀 크기. */
  size: { width: number; height: number }
  /** 지면에서 그림이 앉는 자리. */
  rect: LayoutRect
  liveKey: string
}

/**
 * 문구 그림을 틀 안에 앉힌다 — 비율을 지키며 가장 크게. 가로쓰기는 정렬 쪽으로,
 * 세로쓰기는 위·가운데·아래로 기댄다.
 */
export function placeInFrame(
  size: { width: number; height: number },
  frame: LayoutRect,
  align: TextArtAlign = 'center',
  vertical = false,
): LayoutRect {
  if (!(size.width > 0) || !(size.height > 0)) return { ...frame }
  const k = Math.min(frame.width / size.width, frame.height / size.height)
  const width = Math.max(1, Math.round(size.width * k))
  const height = Math.max(1, Math.round(size.height * k))
  const lean = (room: number) => (align === 'left' ? 0 : align === 'right' ? room : room / 2)
  return {
    x: Math.round(frame.x + (vertical ? (frame.width - width) / 2 : lean(frame.width - width))),
    y: Math.round(frame.y + (vertical ? lean(frame.height - height) : (frame.height - height) / 2)),
    width,
    height,
  }
}

/** 틀 크기에 맞춘 그림 해상도 — 약 1.2MP, 지면의 1.5~4배. */
export function artTarget(frame: { width: number; height: number }, density?: number): { width: number; height: number } {
  const area = Math.max(1, frame.width * frame.height)
  const k = density ?? Math.min(4, Math.max(1.5, Math.sqrt(1_200_000 / area)))
  return { width: Math.max(16, Math.round(frame.width * k)), height: Math.max(16, Math.round(frame.height * k)) }
}

async function store(kind: 'text' | 'shape', blockId: string, blob: Blob): Promise<string> {
  const assetId = createId('asset')
  await putAsset({
    id: assetId,
    blob,
    fileName: `${kind}-${blockId}.png`,
    mimeType: 'image/png',
    byteSize: blob.size,
  })
  return assetId
}

/** 문구 한 장. 그리지 못하면 `null`. */
export async function paintLiveText(input: LiveTextInput, frame: LayoutRect): Promise<LivePaint | null> {
  const look = normalizeTextLook(input.look)
  const drawn = await renderTextArt({
    content: input.text,
    lines: input.lines,
    family: input.family,
    weight: input.weight,
    chars: input.chars,
    look,
    align: input.align ?? 'center',
    target: artTarget(frame),
  })
  if (drawn === null) return null
  const trimmed = await trimToContent(drawn.blob)
  if (trimmed === null) return null
  const assetId = await store('text', input.blockId, trimmed.blob)
  const size = { width: trimmed.width, height: trimmed.height }
  return {
    assetId,
    size,
    rect: placeInFrame(size, frame, input.align ?? 'center', look.vertical),
    liveKey: liveKeyOf(input),
  }
}

/** 도형 한 장. 그림은 상자보다 테두리·그림자만큼 넓다. */
export async function paintLiveShape(input: LiveShapeInput, frame: LayoutRect, tone?: ToneAdjust): Promise<LivePaint | null> {
  const look = normalizeShapeLook(input.look)
  const drawn = await renderShapeArt(look, frame, tone === undefined ? {} : { tone })
  if (drawn === null) return null
  const assetId = await store('shape', input.blockId, drawn.blob)
  return {
    assetId,
    size: { width: drawn.width, height: drawn.height },
    rect: {
      x: frame.x - drawn.pad.left,
      y: frame.y - drawn.pad.top,
      width: frame.width + drawn.pad.left + drawn.pad.right,
      height: frame.height + drawn.pad.top + drawn.pad.bottom,
    },
    liveKey: liveKeyOf(input, frame),
  }
}

export function paintLive(input: LiveInput, frame: LayoutRect): Promise<LivePaint | null> {
  return input.kind === 'shape' ? paintLiveShape(input, frame) : paintLiveText(input, frame)
}
