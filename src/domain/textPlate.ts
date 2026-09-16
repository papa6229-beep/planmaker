/**
 * 문구 한 판을 어떻게 앉힐 것인가 (문구 판 Patch).
 *
 * ## 왜 코드가 글자를 그리는가
 *
 * 로컬 엔진(FLUX.2 Klein)은 **한글을 쓰지 못한다.** 2026-09-16에 확인했다:
 * `여름 시즌오프 / 최대 50% 할인`을 그려 달라고 하면 `메롱 시셩므무 / 첩떠 50%
 * 험연`이 돌아온다. 글자처럼 생긴 것을 그릴 뿐 우리가 준 글자가 아니다. 같은
 * 판에서 영문은 정확했으므로 실력의 문제가 아니라 **한글 자모를 모르는** 것이다.
 *
 * 규칙으로 부탁해서 될 일이 아니다. 그래서 글자는 브라우저가 폰트로 그린다 —
 * 이 제품이 제품 사진에 대해 내린 결론과 같다: **틀리면 안 되는 것은 말로
 * 부탁하지 않고 구조로 막는다.**
 *
 * 그린 판을 모델에게 넘겨 **재질만** 입히는 길은 열려 있다. 그때도 글자 모양은
 * 지켜졌다(금색 그라데이션·3D 플라스틱 모두 정확). 다만 조건이 있었다.
 *
 * ## 왜 판을 꽉 채우는가
 *
 * 같은 글자를 판의 78%만 채워 보냈을 때, 모델은 **없던 줄 하나를 더 그렸다.**
 * 94%를 채운 판에서는 그러지 않았다. 빈 자리를 채우려 드는 것이다. 그래서 이
 * 모듈이 하는 일의 절반은 "판에 빈 자리를 남기지 않는 것"이다.
 *
 * 순수 모듈이다. 캔버스도 폰트도 모른다 — 글자의 너비를 재는 일은 `measure`로
 * 받는다. 그래야 브라우저 없이도 이 규칙을 그대로 검사할 수 있다.
 */

/** 글자가 판에서 차지해야 하는 비율. 이 아래로 내려가면 모델이 빈 자리를 채운다. */
export const PLATE_FILL = 0.94

/** 줄 간격 — 글자 크기의 배수. */
export const LINE_GAP = 1.22

/** 크기를 찾을 때의 위아래 끝. 판보다 큰 글자는 의미가 없고, 4px 아래는 읽히지 않는다. */
export const MIN_SIZE = 4
export const MAX_SIZE = 2000

export interface PlateLine {
  text: string
  /** 줄의 가로 중심 (판 좌표). */
  cx: number
  /** 글자 윗변 (판 좌표). */
  top: number
}

export interface PlateLayout {
  fontSize: number
  lineHeight: number
  lines: PlateLine[]
  /** 글자 덩어리가 판을 실제로 채운 비율 (가로/세로 중 큰 쪽). 검사와 로그용. */
  fill: number
}

/** 이 글자들이 이 크기로 얼마나 넓은가. 브라우저에서는 `measureText`가 답한다. */
export type Measure = (text: string, fontSize: number) => number

/**
 * 판에 글자를 앉힌다 — 판을 꽉 채우는 가장 큰 크기로.
 *
 * 가로도 세로도 넘치지 않는 가장 큰 크기를 찾는다. 줄 수는 이미 정해져 있다
 * (`planLines`가 화면에서 실제로 끊기는 줄을 계산해 둔다) — 여기서 줄을 다시
 * 나누지 않는 것은, 작업자가 화면에서 본 줄 나눔과 결과가 어긋나지 않게 하기
 * 위해서다.
 */
export function fitPlate(
  lines: readonly string[],
  plate: { width: number; height: number },
  measure: Measure,
  fill: number = PLATE_FILL,
): PlateLayout | null {
  const rows = lines.map((line) => line.trim()).filter((line) => line.length > 0)
  if (rows.length === 0) return null
  if (!(plate.width > 0) || !(plate.height > 0)) return null

  const room = { width: plate.width * fill, height: plate.height * fill }
  const fits = (size: number): boolean => {
    if (rows.length * size * LINE_GAP > room.height) return false
    return rows.every((row) => measure(row, size) <= room.width)
  }

  // 가장 큰 크기를 이분법으로 찾는다. 재는 일이 비싸므로 횟수를 정해 둔다.
  let lo = MIN_SIZE
  let hi = Math.min(MAX_SIZE, plate.height)
  if (!fits(lo)) return null
  for (let i = 0; i < 40 && hi - lo > 0.5; i += 1) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  const fontSize = Math.floor(lo)
  if (fontSize < MIN_SIZE) return null

  const lineHeight = fontSize * LINE_GAP
  const block = rows.length * lineHeight
  const top = (plate.height - block) / 2
  const widest = Math.max(...rows.map((row) => measure(row, fontSize)))

  return {
    fontSize,
    lineHeight,
    lines: rows.map((text, i) => ({ text, cx: plate.width / 2, top: top + i * lineHeight })),
    fill: Math.max(widest / plate.width, block / plate.height),
  }
}
