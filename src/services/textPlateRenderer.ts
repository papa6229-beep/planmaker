/**
 * 문구 판을 브라우저가 그린다 (문구 판 Patch).
 *
 * 규칙은 `domain/textPlate.ts`에 있고 순수하다. 여기서는 그 규칙이 시키는 대로
 * 캔버스에 글자를 얹을 뿐이다 — 재는 일(`measureText`)과 그리는 일이 이 자리에 있다.
 *
 * 만들어진 판은 두 갈래로 쓰인다:
 *
 *  - **그대로 얹는다**: 배경이 비어 있는 그림이라 합성기가 바로 쓴다. AI 호출 0건
 *  - **재질을 입힌다**: 마젠타 단색을 깔아 모델에게 보내고, 돌아온 그림에서
 *    마젠타를 지운다. 지우는 일은 이미 있던 장치가 한다
 *
 * 어느 쪽이든 **글자는 여기서 정해지고 모델이 바꾸지 못한다.** 로컬 엔진은 한글을
 * 쓰지 못하기 때문이다 (2026-09-16 확인: `여름 시즌오프` → `메롱 시셩므무`).
 *
 * 그리지 못하면 `null`을 돌려준다. 문구 하나 때문에 페이지 전체를 세우지 않는다.
 */

import { fitPlate, type PlateLayout } from '../domain/textPlate'

/** 모델에게 보낼 때 까는 바탕. 이미 쓰고 있는 값과 같아야 지우는 쪽이 알아본다. */
export const PLATE_KEY_HEX = '#ff00ff'

export interface TextPlateStyle {
  /** 웹폰트 이름. 없으면 화면 기본 글꼴. */
  fontFamily?: string
  /** 100~900. 폰트가 그 굵기를 갖고 있을 때만 뜻이 있다. */
  fontWeight?: number
  color?: string
  /** 외곽선 — 글자 크기에 대한 비율(0.04 = 4%). 0이면 그리지 않는다. */
  strokeRatio?: number
  strokeColor?: string
  /** 그림자 — 글자 크기에 대한 비율. 0이면 그리지 않는다. */
  shadowRatio?: number
  shadowColor?: string
  /**
   * 몸통을 칠하는 법 (문구 꾸미기 Patch). 없으면 `color` 한 가지.
   *
   *  - `colorful`: 글자마다 `fills`를 돌려 가며
   *  - `gradient`: 줄마다 위→아래로 `fills`
   *  - `solid`: `fills[0]`
   */
  fill?: 'colorful' | 'gradient' | 'solid'
  fills?: readonly string[]
  /**
   * 그림자를 흐리지 않고 **밀어서** 찍는다 (문구 꾸미기 Patch).
   *
   * 마젠타 바탕에 흐린 그림자를 깔면 가장자리가 바탕색과 섞여, 바탕을 지울 때
   * 분홍 얼룩으로 남는다. 모델에게 보내는 판은 언제나 이쪽이다.
   */
  hardShadow?: boolean
}

export interface TextPlateRequest {
  lines: readonly string[]
  /** 판의 크기(픽셀). 블록 모양과 같은 비율이어야 한다. */
  plate: { width: number; height: number }
  /** 바탕을 마젠타로 채울 것인가 — 모델에게 보낼 때만 참. */
  keyed: boolean
  style?: TextPlateStyle
}

const DEFAULT_STYLE: Required<Pick<TextPlateStyle, 'color' | 'strokeColor' | 'shadowColor'>> = {
  color: '#111111',
  strokeColor: '#ffffff',
  shadowColor: 'rgba(0, 0, 0, 0.35)',
}

function fontOf(size: number, style: TextPlateStyle | undefined): string {
  const weight = style?.fontWeight ?? 700
  const family = style?.fontFamily
  const stack = family === undefined ? '' : `"${family}", `
  return `${weight} ${size}px ${stack}"Pretendard", "Noto Sans KR", system-ui, sans-serif`
}

export interface TextPlateResult {
  blob: Blob
  layout: PlateLayout
}

export async function renderTextPlate(request: TextPlateRequest): Promise<TextPlateResult | null> {
  const width = Math.round(request.plate.width)
  const height = Math.round(request.plate.height)
  if (!(width > 0) || !(height > 0)) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // 재는 자와 그리는 붓이 **같은 캔버스**여야 한다. 다른 곳에서 잰 너비로 그리면
  // 판을 넘치거나 덜 차고, 덜 찬 판에서는 모델이 빈 자리를 채운다.
  // 테두리와 그림자도 판 안에 들어와야 한다 — 가장자리에서 잘린 테두리는 지울 때
  // 바탕과 이어져 버린다. 그래서 그 두께만큼 넓게 잰다.
  const style = request.style
  const extra = 2 * (style?.strokeRatio ?? 0) + (style?.hardShadow === true ? (style.shadowRatio ?? 0) : 0)
  const layout = fitPlate(request.lines, { width, height }, (text, size) => {
    ctx.font = fontOf(size, request.style)
    return ctx.measureText(text).width + extra * size
  })
  if (layout === null) return null

  if (request.keyed) {
    ctx.fillStyle = PLATE_KEY_HEX
    ctx.fillRect(0, 0, width, height)
  }

  ctx.font = fontOf(layout.fontSize, style)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const size = layout.fontSize
  const stroke = (style?.strokeRatio ?? 0) * size
  const shadow = (style?.shadowRatio ?? 0) * size

  /** 한 줄을 글자 단위로 — 글자마다 다른 색을 칠하려면 자리를 알아야 한다. */
  const glyphs = (line: { text: string; cx: number; top: number }) => {
    const total = ctx.measureText(line.text).width
    let x = line.cx - total / 2
    return [...line.text].map((ch) => {
      const at = x
      x += ctx.measureText(ch).width
      return { ch, x: at, y: line.top }
    })
  }
  const lines = layout.lines.map((line) => ({ line, glyphs: glyphs(line) }))
  const drawAll = (paint: (g: { ch: string; x: number; y: number }, lineIndex: number, k: number) => void) => {
    let k = 0
    lines.forEach(({ glyphs: row }, li) => {
      for (const g of row) {
        paint(g, li, k)
        if (g.ch.trim().length > 0) k += 1
      }
    })
  }
  const outline = (color: string, dx: number, dy: number) => {
    ctx.lineWidth = stroke * 2
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.strokeStyle = color
    ctx.fillStyle = color
    drawAll((g) => {
      if (stroke > 0) ctx.strokeText(g.ch, g.x + dx, g.y + dy)
      ctx.fillText(g.ch, g.x + dx, g.y + dy)
    })
  }

  // ① 그림자
  if (shadow > 0) {
    const color = style?.shadowColor ?? DEFAULT_STYLE.shadowColor
    if (style?.hardShadow === true) {
      outline(color, shadow, shadow)
    } else {
      ctx.save()
      ctx.shadowColor = color
      ctx.shadowBlur = shadow
      ctx.shadowOffsetY = shadow * 0.35
      // 캔버스 그림자는 그리는 것의 알파를 따른다. 불투명한 것을 그려야 그림자가 진다 —
      // 테두리(없으면 몸통) 색으로 그린다. 그 위에 ②·③이 다시 덮는다.
      outline(stroke > 0 ? (style?.strokeColor ?? DEFAULT_STYLE.strokeColor) : (style?.fills?.[0] ?? style?.color ?? DEFAULT_STYLE.color), 0, 0)
      ctx.restore()
    }
  }

  // ② 테두리 — 먼저 굵게 그리고 그 위에 글자를 얹는다. 획 안쪽으로 파고들어
  //    글자가 가늘어지는 것을 막는다.
  if (stroke > 0) outline(style?.strokeColor ?? DEFAULT_STYLE.strokeColor, 0, 0)

  // ③ 몸통
  const fills = style?.fills !== undefined && style.fills.length > 0 ? style.fills : [style?.color ?? DEFAULT_STYLE.color]
  const mode = style?.fill ?? 'solid'
  drawAll((g, li, k) => {
    if (mode === 'colorful') {
      ctx.fillStyle = fills[k % fills.length]!
    } else if (mode === 'gradient' && fills.length > 1) {
      const top = layout.lines[li]!.top
      const grad = ctx.createLinearGradient(0, top, 0, top + size)
      fills.forEach((c, i) => grad.addColorStop(i / (fills.length - 1), c))
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = fills[0]!
    }
    ctx.fillText(g.ch, g.x, g.y)
  })

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png')
  })
  return blob === null ? null : { blob, layout }
}
