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
  const layout = fitPlate(request.lines, { width, height }, (text, size) => {
    ctx.font = fontOf(size, request.style)
    return ctx.measureText(text).width
  })
  if (layout === null) return null

  if (request.keyed) {
    ctx.fillStyle = PLATE_KEY_HEX
    ctx.fillRect(0, 0, width, height)
  }

  const style = request.style
  ctx.font = fontOf(layout.fontSize, style)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  const shadow = (style?.shadowRatio ?? 0) * layout.fontSize
  if (shadow > 0) {
    ctx.shadowColor = style?.shadowColor ?? DEFAULT_STYLE.shadowColor
    ctx.shadowBlur = shadow
    ctx.shadowOffsetY = shadow * 0.35
  }

  const stroke = (style?.strokeRatio ?? 0) * layout.fontSize
  if (stroke > 0) {
    // 외곽선을 먼저 굵게 그리고 그 위에 글자를 얹는다. 획 안쪽으로 파고들어
    // 글자가 가늘어지는 것을 막는다.
    ctx.lineWidth = stroke * 2
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.strokeStyle = style?.strokeColor ?? DEFAULT_STYLE.strokeColor
    for (const line of layout.lines) ctx.strokeText(line.text, line.cx, line.top)
  }

  // 글자 자체에는 그림자를 두 번 걸지 않는다 — 외곽선에서 이미 걸렸다.
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.fillStyle = style?.color ?? DEFAULT_STYLE.color
  for (const line of layout.lines) ctx.fillText(line.text, line.cx, line.top)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png')
  })
  return blob === null ? null : { blob, layout }
}
