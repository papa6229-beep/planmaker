/**
 * 도형과 선 (도형 도구 Patch, 2026-09-17).
 *
 * 사용자: "사각형, 다각형, 원형의 도형 레이어를 만들어 배치하고 그 위에 텍스트를
 * 얹는 것 … 드래그로 만들 수 있고 색깔·그림자·테두리를 넣을 수 있다면." 그리고
 * "직선·점선 정도는 가능했으면."
 *
 * 도형의 **자리와 크기**는 기획서 블록 상자가 갖고, **모양**은 여기 값이다 (문구와
 * 같은 나눔 — 모양은 작업판의 것, 자리는 기획서의 것). 순수 모듈이다: 그리는 길을
 * 점과 곡선 명령으로만 내놓고, 캔버스는 `services/shapeArt.ts`가 쓴다.
 */

import { hexOr, rangeOr } from './textLook'

export type ShapeKind =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'heart'
  | 'bubble'
  | 'sparkle'
  | 'line'

export const SHAPE_KINDS: readonly { kind: ShapeKind; label: string; icon: string }[] = [
  { kind: 'rect', label: '사각형', icon: '▭' },
  { kind: 'roundRect', label: '둥근 사각형', icon: '▢' },
  { kind: 'ellipse', label: '원', icon: '◯' },
  { kind: 'polygon', label: '다각형', icon: '⬠' },
  { kind: 'star', label: '별', icon: '☆' },
  { kind: 'heart', label: '하트', icon: '♡' },
  { kind: 'bubble', label: '말풍선', icon: '💬' },
  { kind: 'sparkle', label: '반짝이', icon: '✦' },
  { kind: 'line', label: '선', icon: '╱' },
]

/** 선이 상자 안에서 어느 방향으로 가는가. */
export type LineDirection = 'h' | 'v' | 'down' | 'up'
export type StrokeDash = 'solid' | 'dashed' | 'dotted'

export interface ShapeLook {
  kind: ShapeKind
  /** 둥근 사각형·말풍선의 모서리 — 짧은 변에 대한 비율 (0 … 0.5). */
  radius: number
  /** 다각형의 변 수 · 별의 꼭짓점 수 (3 … 12). */
  sides: number
  /** 별의 안쪽 반지름 비율 (0.15 … 0.95). */
  inner: number
  fill: boolean
  fillMode: 'solid' | 'gradient'
  fillColor: string
  fillColor2: string
  stroke: boolean
  strokeColor: string
  /** 테두리·선 두께 (지면 px, 0.5 … 60). */
  strokeWidth: number
  dash: StrokeDash
  shadow: boolean
  shadowColor: string
  /** 지면 px. */
  shadowDistance: number
  shadowAngle: number
  /** 지면 px. */
  shadowBlur: number
  shadowOpacity: number
  /** 도형 전체의 불투명도 (0 … 1). */
  opacity: number
  line: LineDirection
  arrowStart: boolean
  arrowEnd: boolean
}

export const DEFAULT_SHAPE_LOOK: ShapeLook = {
  kind: 'rect',
  radius: 0.2,
  sides: 5,
  inner: 0.45,
  fill: true,
  fillMode: 'solid',
  fillColor: '#ffd84d',
  fillColor2: '#ff9f1c',
  stroke: false,
  strokeColor: '#111111',
  strokeWidth: 3,
  dash: 'solid',
  shadow: false,
  shadowColor: '#000000',
  shadowDistance: 6,
  shadowAngle: 45,
  shadowBlur: 6,
  shadowOpacity: 0.35,
  opacity: 1,
  line: 'h',
  arrowStart: false,
  arrowEnd: false,
}

const KINDS = new Set<string>(SHAPE_KINDS.map((k) => k.kind))

export function normalizeShapeLook(raw: unknown): ShapeLook {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_SHAPE_LOOK
  const kind = typeof v.kind === 'string' && KINDS.has(v.kind) ? (v.kind as ShapeKind) : d.kind
  const angle = typeof v.shadowAngle === 'number' && Number.isFinite(v.shadowAngle) ? v.shadowAngle : d.shadowAngle
  return {
    kind,
    radius: rangeOr(v.radius, [0, 0.5], d.radius),
    sides: Math.round(rangeOr(v.sides, [3, 12], d.sides)),
    inner: rangeOr(v.inner, [0.15, 0.95], d.inner),
    // 선은 채우지 않고 긋기만 한다 — 새로 만든 선이 보이지 않으면 안 된다.
    fill: kind === 'line' ? false : v.fill !== false,
    fillMode: v.fillMode === 'gradient' ? 'gradient' : 'solid',
    fillColor: hexOr(v.fillColor, d.fillColor),
    fillColor2: hexOr(v.fillColor2, d.fillColor2),
    stroke: kind === 'line' ? true : v.stroke === true,
    strokeColor: hexOr(v.strokeColor, d.strokeColor),
    strokeWidth: rangeOr(v.strokeWidth, [0.5, 60], d.strokeWidth),
    dash: v.dash === 'dashed' || v.dash === 'dotted' ? v.dash : 'solid',
    shadow: v.shadow === true,
    shadowColor: hexOr(v.shadowColor, d.shadowColor),
    shadowDistance: rangeOr(v.shadowDistance, [0, 200], d.shadowDistance),
    shadowAngle: ((Math.round(angle) % 360) + 360) % 360,
    shadowBlur: rangeOr(v.shadowBlur, [0, 100], d.shadowBlur),
    shadowOpacity: rangeOr(v.shadowOpacity, [0, 1], d.shadowOpacity),
    opacity: rangeOr(v.opacity, [0, 1], d.opacity),
    line: v.line === 'v' || v.line === 'down' || v.line === 'up' ? v.line : 'h',
    arrowStart: v.arrowStart === true,
    arrowEnd: v.arrowEnd === true,
  }
}

/** 그리는 명령. 좌표는 도형 상자 안(0,0 ~ w,h)이다. */
export type PathOp =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'Q'; cx: number; cy: number; x: number; y: number }
  | { op: 'C'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { op: 'E'; cx: number; cy: number; rx: number; ry: number }
  | { op: 'Z' }

function roundRectOps(x: number, y: number, w: number, h: number, r: number): PathOp[] {
  const k = Math.max(0, Math.min(r, w / 2, h / 2))
  if (k === 0) return [{ op: 'M', x, y }, { op: 'L', x: x + w, y }, { op: 'L', x: x + w, y: y + h }, { op: 'L', x, y: y + h }, { op: 'Z' }]
  return [
    { op: 'M', x: x + k, y },
    { op: 'L', x: x + w - k, y },
    { op: 'Q', cx: x + w, cy: y, x: x + w, y: y + k },
    { op: 'L', x: x + w, y: y + h - k },
    { op: 'Q', cx: x + w, cy: y + h, x: x + w - k, y: y + h },
    { op: 'L', x: x + k, y: y + h },
    { op: 'Q', cx: x, cy: y + h, x, y: y + h - k },
    { op: 'L', x, y: y + k },
    { op: 'Q', cx: x, cy: y, x: x + k, y },
    { op: 'Z' },
  ]
}

function ring(points: number, w: number, h: number, radiusAt: (i: number) => number): PathOp[] {
  const ops: PathOp[] = []
  for (let i = 0; i < points; i += 1) {
    const a = -Math.PI / 2 + (i / points) * Math.PI * 2
    const r = radiusAt(i)
    const x = w / 2 + Math.cos(a) * (w / 2) * r
    const y = h / 2 + Math.sin(a) * (h / 2) * r
    ops.push(i === 0 ? { op: 'M', x, y } : { op: 'L', x, y })
  }
  ops.push({ op: 'Z' })
  return ops
}

/** 선의 두 끝 (상자 안 좌표). */
export function lineEnds(look: ShapeLook, w: number, h: number): { x1: number; y1: number; x2: number; y2: number } {
  switch (look.line) {
    case 'v':
      return { x1: w / 2, y1: 0, x2: w / 2, y2: h }
    case 'down':
      return { x1: 0, y1: 0, x2: w, y2: h }
    case 'up':
      return { x1: 0, y1: h, x2: w, y2: 0 }
    default:
      return { x1: 0, y1: h / 2, x2: w, y2: h / 2 }
  }
}

/** 채우고 그을 길. 선은 두 점짜리 열린 길이다. */
export function shapePath(look: ShapeLook, w: number, h: number): PathOp[] {
  const short = Math.min(w, h)
  switch (look.kind) {
    case 'rect':
      return roundRectOps(0, 0, w, h, 0)
    case 'roundRect':
      return roundRectOps(0, 0, w, h, look.radius * short)
    case 'ellipse':
      return [{ op: 'E', cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 }]
    case 'polygon':
      return ring(look.sides, w, h, () => 1)
    case 'star':
      return ring(look.sides * 2, w, h, (i) => (i % 2 === 0 ? 1 : look.inner))
    case 'heart':
      return [
        { op: 'M', x: w / 2, y: h * 0.28 },
        { op: 'C', c1x: w * 0.5, c1y: h * 0.02, c2x: w * 0.02, c2y: h * 0.0, x: w * 0.02, y: h * 0.33 },
        { op: 'C', c1x: w * 0.02, c1y: h * 0.62, c2x: w * 0.4, c2y: h * 0.78, x: w / 2, y: h },
        { op: 'C', c1x: w * 0.6, c1y: h * 0.78, c2x: w * 0.98, c2y: h * 0.62, x: w * 0.98, y: h * 0.33 },
        { op: 'C', c1x: w * 0.98, c1y: h * 0.0, c2x: w * 0.5, c2y: h * 0.02, x: w / 2, y: h * 0.28 },
        { op: 'Z' },
      ]
    case 'bubble': {
      // 몸통은 위 80%, 꼬리는 왼쪽 아래로.
      const bodyH = h * 0.8
      const k = Math.max(0, Math.min(look.radius * Math.min(w, bodyH), w / 2, bodyH / 2))
      return [
        { op: 'M', x: k, y: 0 },
        { op: 'L', x: w - k, y: 0 },
        { op: 'Q', cx: w, cy: 0, x: w, y: k },
        { op: 'L', x: w, y: bodyH - k },
        { op: 'Q', cx: w, cy: bodyH, x: w - k, y: bodyH },
        { op: 'L', x: w * 0.36, y: bodyH },
        { op: 'L', x: w * 0.16, y: h },
        { op: 'L', x: w * 0.2, y: bodyH },
        { op: 'L', x: k, y: bodyH },
        { op: 'Q', cx: 0, cy: bodyH, x: 0, y: bodyH - k },
        { op: 'L', x: 0, y: k },
        { op: 'Q', cx: 0, cy: 0, x: k, y: 0 },
        { op: 'Z' },
      ]
    }
    case 'sparkle':
      return [
        { op: 'M', x: w / 2, y: 0 },
        { op: 'Q', cx: w / 2, cy: h / 2, x: w, y: h / 2 },
        { op: 'Q', cx: w / 2, cy: h / 2, x: w / 2, y: h },
        { op: 'Q', cx: w / 2, cy: h / 2, x: 0, y: h / 2 },
        { op: 'Q', cx: w / 2, cy: h / 2, x: w / 2, y: 0 },
        { op: 'Z' },
      ]
    case 'line': {
      const { x1, y1, x2, y2 } = lineEnds(look, w, h)
      return [
        { op: 'M', x: x1, y: y1 },
        { op: 'L', x: x2, y: y2 },
      ]
    }
  }
}

/** 화살촉 크기 — 선 두께의 배수. */
export const ARROW_SCALE = 4

/** 도형 상자 밖으로 나가는 여백 (지면 px) — 테두리 절반, 화살촉, 그림자. */
export function shapePad(look: ShapeLook): { left: number; top: number; right: number; bottom: number } {
  const stroke = look.stroke ? look.strokeWidth / 2 + (look.kind === 'line' && (look.arrowStart || look.arrowEnd) ? look.strokeWidth * ARROW_SCALE : 0) : 0
  const a = (look.shadowAngle * Math.PI) / 180
  const dx = look.shadow ? Math.cos(a) * look.shadowDistance : 0
  const dy = look.shadow ? Math.sin(a) * look.shadowDistance : 0
  const blur = look.shadow ? look.shadowBlur * 2 : 0
  const edge = stroke + 2
  return {
    left: Math.ceil(edge + Math.max(0, -dx) + blur),
    right: Math.ceil(edge + Math.max(0, dx) + blur),
    top: Math.ceil(edge + Math.max(0, -dy) + blur),
    bottom: Math.ceil(edge + Math.max(0, dy) + blur),
  }
}

/**
 * 끌어서 만든 선의 방향과 상자 (도형 도구). 거의 수평·수직이면 곧게 편다 —
 * Shift를 누르면 언제나 수평·수직·45° 중 가까운 쪽으로.
 */
export function lineFromDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  snap: boolean,
): { line: LineDirection; rect: { x: number; y: number; width: number; height: number } } {
  let dx = to.x - from.x
  let dy = to.y - from.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  const thin = 12
  let line: LineDirection
  if (ady < adx * 0.15 || (snap && ady < adx * 0.41)) {
    line = 'h'
    dy = 0
  } else if (adx < ady * 0.15 || (snap && adx < ady * 0.41)) {
    line = 'v'
    dx = 0
  } else {
    if (snap) {
      const m = Math.max(adx, ady)
      dx = Math.sign(dx) * m
      dy = Math.sign(dy) * m
    }
    line = Math.sign(dx) === Math.sign(dy) ? 'down' : 'up'
  }
  const x = Math.min(from.x, from.x + dx)
  const y = Math.min(from.y, from.y + dy)
  const width = Math.max(line === 'v' ? thin : 1, Math.abs(dx))
  const height = Math.max(line === 'h' ? thin : 1, Math.abs(dy))
  return {
    line,
    rect: {
      x: Math.round(line === 'v' ? x - thin / 2 : x),
      y: Math.round(line === 'h' ? y - thin / 2 : y),
      width: Math.round(width),
      height: Math.round(height),
    },
  }
}
