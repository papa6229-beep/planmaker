/**
 * 버튼이 깜빡이는 두 번째 프레임 (깜빡이는 버튼 Patch).
 *
 * 쇼핑몰의 CTA 버튼은 1초마다 색이 바뀐다. 작업자가 보여 준 예는 같은 버튼의
 * 진한 보라 ↔ 연한 라벤더였고, **글자는 흰색 그대로**였다.
 *
 * ## 색을 지정하지 않는다
 *
 * "버튼마다 디자인은 천차만별 색상도 천차만별"이다. 두 색을 코드가 정하면 어떤
 * 디자인에서는 배경과 붙고 어떤 디자인에서는 글자가 묻힌다. 그래서 **색을 정하지
 * 않고 그 색을 흔든다** — 버튼 몸통의 밝기를 위나 아래로 민다. 그라데이션은
 * 그라데이션인 채로 함께 밀리므로 원래 디자인이 살아 있다.
 *
 * ## 밝은 것은 건드리지 않는다
 *
 * 버튼 안에는 글자가 있고, 대개 `▶`나 `>` 같은 아이콘도 함께 있다. 그것들은 두
 * 프레임에서 그대로여야 샘플과 같은 모양이 된다. 그래서 **몸통 밝기에서 멀리 떨어진
 * 픽셀은 그대로 둔다.** 어둡게 미는 쪽에서 이 규칙이 없으면 흰 글자가 회색이 된다.
 *
 * ## 방향은 자동으로
 *
 * 어두운 버튼은 밝히고, 밝은 버튼은 어둡게 한다. 반대로 하면 밝은 버튼이 더 밝아져
 * 흰 글자가 사라진다. 몸통 밝기로 정한다 — 평균이 아니라 **가장 많이 나온 값**이다.
 * 평균은 흰 글자에 끌려 올라가서, 글자가 많은 작은 버튼이 "밝은 버튼"으로 읽힌다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

/**
 * 몸통 밝기에서 이만큼 벗어난 픽셀은 글자·아이콘으로 보고 건드리지 않는다.
 *
 * 처음에는 "밝기 200 위는 글자"로 잡았다. 어두운 버튼에서는 맞지만 **연한 버튼이
 * 통째로 글자로 읽혀** 아무것도 안 움직였다. 기준은 절대값이 아니라 **그 버튼의
 * 몸통에서 얼마나 떨어졌는가**여야 한다.
 *
 * 되지 않는 경우가 하나 남는다 — 몸통과 글자의 밝기가 이 값 안쪽으로 붙어 있는
 * 디자인. 그런 버튼은 원래도 글자가 잘 안 보이므로 실제로 오는 일이 드물고, 오면
 * 글자도 함께 밀린다. 실물을 보고 판단할 자리다.
 */
export const BLINK_KEEP_GAP = 70
/** 이 알파 이하는 빈 자리다. */
export const BLINK_ALPHA_FLOOR = 8
/** 기본 세기 — 눈에 보이되 디자인이 무너지지 않는 정도. 화면에서 조절한다. */
export const BLINK_DEFAULT_STRENGTH = 0.25

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * 이 버튼 **몸통**의 밝기.
 *
 * 평균이 아니라 **가장 많이 나온 값**을 쓴다. 몸통이 면적의 대부분이라 최빈값이 곧
 * 몸통이고, 평균은 흰 글자에 끌려 올라간다.
 */
export function bodyLuma(pixels: { data: Uint8ClampedArray }): number {
  const bins = new Int32Array(256)
  let seen = 0
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i + 3]! <= BLINK_ALPHA_FLOOR) continue
    const bin = Math.round(luma(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!))
    bins[bin] = (bins[bin] ?? 0) + 1
    seen += 1
  }
  if (seen === 0) return 0
  let best = 0
  for (let v = 1; v < 256; v += 1) if (bins[v]! > bins[best]!) best = v
  return best
}

/** 이 버튼을 밝힐 것인가. 몸통이 가운데보다 어두우면 밝힌다. */
export function blinkGoesBrighter(pixels: {
  data: Uint8ClampedArray
  width: number
  height: number
}): boolean {
  return bodyLuma(pixels) < 128
}

/**
 * 두 번째 프레임의 픽셀 — 버튼 몸통만 밝기가 밀린 것.
 *
 * 받은 것을 고치지 않고 새 배열을 돌려준다. 첫 프레임이 원본이므로, 원본을 고치면
 * 두 프레임이 같아진다.
 *
 * 미는 양은 **남은 여유에 비례**한다. 밝힐 때는 흰색까지의 거리를, 어둡게 할 때는
 * 검정까지의 거리를 쓴다. 그러면 어떤 색에서 시작하든 넘치거나 뭉개지지 않고
 * 비슷한 정도로 움직인다.
 */
export function blinkFrame(
  pixels: { data: Uint8ClampedArray; width: number; height: number },
  strength = BLINK_DEFAULT_STRENGTH,
  brighter = blinkGoesBrighter(pixels),
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.data)
  const amount = Math.max(0, Math.min(1, strength))
  if (amount === 0) return out
  const body = bodyLuma(pixels)

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3]! <= BLINK_ALPHA_FLOOR) continue
    const r = out[i]!
    const g = out[i + 1]!
    const b = out[i + 2]!
    // 글자와 아이콘은 두 프레임에서 그대로다 — 몸통에서 멀리 떨어진 밝기가 그것이다.
    if (Math.abs(luma(r, g, b) - body) > BLINK_KEEP_GAP) continue
    out[i] = brighter ? r + (255 - r) * amount : r * (1 - amount)
    out[i + 1] = brighter ? g + (255 - g) * amount : g * (1 - amount)
    out[i + 2] = brighter ? b + (255 - b) * amount : b * (1 - amount)
  }
  return out
}

/**
 * 모양 틀 안쪽만 흔든다 (깜빡이는 버튼 Patch, 손검수 2차).
 *
 * 앞선 판은 버튼이 앉은 **사각형을 통째로** 밀었다. 둥근 버튼인데 깜빡이는 자리는
 * 네모여서 버튼 밖의 배경까지 함께 어두워졌다 — "저렇게 라운드된 버튼을 만들었으면서
 * 깜빡 라인은 사각임."
 *
 * 합쳐진 완성본에는 버튼의 둥근 모서리를 알 방법이 없다. 다행히 버튼 조각은 투명도를
 * 가진 그림으로 따로 남아 있으므로, 그것을 틀로 쓴다. 색은 여전히 완성본에서 읽으니
 * 톤·종이 테두리 같은 후처리가 그대로 살아 있다.
 *
 * 방향과 몸통 밝기도 **틀 안쪽만** 보고 정한다. 바깥 배경까지 세면 배경이 몸통으로
 * 읽혀 엉뚱한 쪽으로 민다.
 *
 * 틀이 없으면 예전처럼 사각형 전체다 — 그래도 깜빡이기는 한다.
 */
export function blinkInsideMask(
  patch: Uint8ClampedArray,
  mask: Uint8ClampedArray | null,
  size: { width: number; height: number },
  strength: number,
): Uint8ClampedArray {
  const inside = new Uint8ClampedArray(patch)
  if (mask !== null) {
    for (let i = 0; i < inside.length; i += 4) {
      if ((mask[i + 3] ?? 0) <= BLINK_ALPHA_FLOOR) inside[i + 3] = 0
    }
  }
  const region = { data: inside, width: size.width, height: size.height }
  const shifted = blinkFrame(region, strength, blinkGoesBrighter(region))

  // 틀 밖은 첫 프레임 그대로 되돌린다 — 그래야 둥근 모서리가 산다.
  if (mask !== null) {
    for (let i = 0; i < shifted.length; i += 4) {
      if ((mask[i + 3] ?? 0) > BLINK_ALPHA_FLOOR) continue
      shifted[i] = patch[i]!
      shifted[i + 1] = patch[i + 1]!
      shifted[i + 2] = patch[i + 2]!
    }
  }
  // 알파는 첫 프레임의 것으로 되돌린다 — 위에서 틀 밖을 투명으로 표시해 두었다.
  for (let i = 3; i < shifted.length; i += 4) shifted[i] = patch[i]!
  return shifted
}
