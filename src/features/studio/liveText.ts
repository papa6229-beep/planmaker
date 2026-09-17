/**
 * 살아 있는 문구를 그린다 (살아 있는 문구 Patch, 2026-09-17).
 *
 * 문구는 AI를 거치지 않는다. 브라우저가 고른 글꼴로 글자를 쓰고, 고른 색·테두리·
 * 그림자를 칠해 투명한 판 한 장을 만든다. 생성할 때 한 번, 그 뒤로는 **글꼴·색·
 * 문구가 바뀔 때마다** 다시 그린다 (`LiveTextSync`). 외부 호출은 0건이다.
 *
 * 무엇으로 그렸는지는 지문(`liveKeyOf`)으로 남긴다. 지금 값의 지문이 다르면 다시
 * 그릴 때가 된 것이다 — 파일을 다시 열어도 같은 판단이 선다.
 */

import { createId } from '../../domain/factory'
import { FALLBACK_FAMILY } from '../../domain/fontCatalog'
import type { LayoutRect } from '../../domain/imageLayout'
import { containRect } from '../../domain/textLayers'
import { normalizeTextLook, plateStyleOf, type TextLook } from '../../domain/textLook'
import { plateSizeFor } from '../../domain/textStyle'
import { putAsset } from '../../services/assetStore'
import { faceName, loadFamilyWeight } from '../../services/fontLoader'
import { renderTextPlate } from '../../services/textPlateRenderer'
import { trimToContent } from '../../services/trimToContent'
import { fontFamilies } from './blockFont'

export interface LiveTextInput {
  blockId: string
  text: string
  lines: readonly string[]
  family: string
  weight?: number | undefined
  look?: TextLook | undefined
}

/** 이 값으로 그린 판의 지문. 줄·글꼴·굵기·꾸밈 중 하나라도 다르면 다르다. */
export function liveKeyOf(input: LiveTextInput): string {
  return JSON.stringify([
    input.text.trim(),
    input.lines,
    input.family,
    input.weight ?? null,
    normalizeTextLook(input.look),
  ])
}

export interface LivePaint {
  assetId: string
  /** 판에서 글자만 남긴 그림의 크기. */
  size: { width: number; height: number }
  /** 틀 안에 가장 크게, 가운데로 앉힌 자리. */
  rect: LayoutRect
  liveKey: string
}

/** 그리지 못하면 `null` — 부르는 쪽이 이유를 말한다. */
export async function paintLiveText(input: LiveTextInput, frame: LayoutRect): Promise<LivePaint | null> {
  const rows = (input.lines.length > 0 ? input.lines : [input.text]).filter((l) => l.trim().length > 0)
  if (rows.length === 0) return null
  const families = await fontFamilies()
  const family =
    families.find((f) => f.family === input.family) ?? families.find((f) => f.family === FALLBACK_FAMILY)
  const file = family === undefined ? null : await loadFamilyWeight(family, input.weight)
  const plate = plateSizeFor(frame) ?? {
    width: Math.max(1, Math.round(frame.width * 3)),
    height: Math.max(1, Math.round(frame.height * 3)),
  }
  const drawn = await renderTextPlate({
    lines: rows,
    plate,
    keyed: false,
    style: {
      ...(file === null ? {} : { fontFamily: faceName(file), fontWeight: file.weight }),
      ...plateStyleOf(normalizeTextLook(input.look)),
    },
  })
  if (drawn === null) return null
  const trimmed = await trimToContent(drawn.blob)
  if (trimmed === null) return null
  const assetId = createId('asset')
  await putAsset({
    id: assetId,
    blob: trimmed.blob,
    fileName: `text-${input.blockId}.png`,
    mimeType: 'image/png',
    byteSize: trimmed.blob.size,
  })
  const size = { width: trimmed.width, height: trimmed.height }
  return { assetId, size, rect: containRect(size, frame), liveKey: liveKeyOf(input) }
}
