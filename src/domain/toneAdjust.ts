/**
 * 완성 결과 전체의 톤 조절 (톤 조절 Patch).
 *
 * 포토샵의 레벨·곡선을 그대로 옮기지 않는다. 곡선은 그래프를 손으로 끌어야
 * 쓸모가 있고, 그 화면은 지금까지 만든 어떤 패널보다 크다. 그보다 먼저 슬라이더
 * 넷을 둔다 — 실무에서 손대는 것의 대부분이 여기서 끝나기 때문이다.
 *
 * 원본 결과 그림은 바뀌지 않는다. 여기 적히는 것은 **다시 그릴 때 곱할 값**이고,
 * 전부 0으로 내리면 손대기 전 그림이 그대로 돌아온다 — 되돌릴 것이 없으므로.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

/** 네 손잡이. 전부 -1..+1이고 0이 손대지 않은 상태다. */
export interface ToneAdjust {
  /** 밝기. +면 밝아진다. */
  brightness: number
  /** 대비. +면 밝은 곳과 어두운 곳이 벌어진다. */
  contrast: number
  /** 채도. -1이면 흑백, +면 쨍해진다. */
  saturation: number
  /** 색온도. -면 푸르게, +면 노랗게. */
  temperature: number
}

export const NO_TONE: ToneAdjust = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 }

export const TONE_FIELDS: readonly { key: keyof ToneAdjust; label: string }[] = [
  { key: 'brightness', label: '밝기' },
  { key: 'contrast', label: '대비' },
  { key: 'saturation', label: '채도' },
  { key: 'temperature', label: '색온도' },
]

function clamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(-1, value))
}

/** 모르는 값은 0으로 읽는다 — 예전 작업이 열리기만 해도 달라지지 않게. */
export function normalizeTone(value: unknown): ToneAdjust {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof ToneAdjust, unknown>>
  return {
    brightness: clamp(raw.brightness),
    contrast: clamp(raw.contrast),
    saturation: clamp(raw.saturation),
    temperature: clamp(raw.temperature),
  }
}

/** 넷 다 0인가. 참이면 픽셀을 훑을 이유가 없다. */
export function toneIsFlat(tone: ToneAdjust): boolean {
  return tone.brightness === 0 && tone.contrast === 0 && tone.saturation === 0 && tone.temperature === 0
}

/** 밝기·대비의 최대 폭 — 슬라이더 끝에서 어디까지 갈 것인가. */
export const TONE_BRIGHTNESS_RANGE = 60
export const TONE_CONTRAST_RANGE = 0.6
export const TONE_TEMPERATURE_RANGE = 30

/** 사람 눈이 느끼는 밝기 — 채도를 낮출 때 남기는 값이다. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function toByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
}

/**
 * 픽셀 배열을 **제자리에서** 고친다.
 *
 * 순서가 곧 결과다. 대비를 먼저 걸고 밝기를 더하면 어두운 쪽이 먼저 뭉개진다.
 * 그래서 밝기 → 대비 → 채도 → 색온도 차례로 간다 — 사진 보정 도구들이 쓰는
 * 그 차례다.
 */
export function applyTone(data: Uint8ClampedArray, tone: ToneAdjust): void {
  if (toneIsFlat(tone)) return
  const lift = tone.brightness * TONE_BRIGHTNESS_RANGE
  const gain = 1 + tone.contrast * TONE_CONTRAST_RANGE
  const sat = 1 + tone.saturation
  const warm = tone.temperature * TONE_TEMPERATURE_RANGE

  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) === 0) continue
    let r = (data[i] ?? 0) + lift
    let g = (data[i + 1] ?? 0) + lift
    let b = (data[i + 2] ?? 0) + lift

    // 대비는 가운데(128)를 축으로 벌리거나 좁힌다.
    r = 128 + (r - 128) * gain
    g = 128 + (g - 128) * gain
    b = 128 + (b - 128) * gain

    // 채도는 밝기를 남기고 색만 벌린다 — -1이면 그 밝기의 회색이 된다.
    const y = luma(r, g, b)
    r = y + (r - y) * sat
    g = y + (g - y) * sat
    b = y + (b - y) * sat

    // 색온도는 붉은 쪽과 푸른 쪽을 반대로 민다.
    r += warm
    b -= warm

    data[i] = toByte(r)
    data[i + 1] = toByte(g)
    data[i + 2] = toByte(b)
  }
}
