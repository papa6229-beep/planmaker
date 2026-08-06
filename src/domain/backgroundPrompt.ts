/**
 * 빈 배경 한 장을 주문하는 글 (배경 합성 1차 §8).
 *
 * 이 글에 들어가는 것은 두 종류뿐이다: 작업자가 적은 배경 분위기와, 브라우저가
 * 원본에서 **읽어 낸 숫자**. 파일명도 바이트도 data URL도 여기 오지 않는다 —
 * 애초에 이 모듈에 그런 값을 넘길 수 있는 인자가 없다.
 *
 * 업무 설명은 사실대로 쓴다. 이 기능은 판매용 광고의 빈 배경을 만들고, 제품·
 * 인물·로고는 브라우저에서 원본 그대로 합성하는 일이다. 정책을 우회하려는 말,
 * 역할을 부여하는 말, 안전 판정을 흔들려는 말은 쓰지 않는다 — 필요가 없고,
 * 한 번 쓰면 이 코드를 읽는 다음 사람이 그것을 관행으로 여긴다.
 */

import type { ImageAnalysis } from './imageAnalysis'
import type { LayoutRect } from './imageLayout'

/**
 * 배경에 절대 나타나면 안 되는 것 (§8).
 *
 * 제품·인물·로고·문구는 전부 원본 레이어로 얹히므로, 모델이 그것들을 그리면
 * 같은 것이 두 번 나온다. 글자와 가격과 버튼은 기획서가 정하는 것이지 모델이
 * 지어낼 것이 아니다.
 */
export const BACKGROUND_BANNED: readonly string[] = [
  '사람',
  '제품',
  '손',
  '로고',
  '글자',
  '가격',
  '버튼',
  '워터마크',
]

export interface BackgroundPromptInput {
  /** 작업자가 적은 배경 분위기. 비어 있어도 배경은 만들 수 있다. */
  wish: string
  /** 최종 작업 이미지 크기 — 840 × 페이지 높이. */
  size: { width: number; height: number }
  /** 페이지 종합 분석값. 연결한 이미지가 하나도 없으면 `null`. */
  analysis: ImageAnalysis | null
  /** 제품·문구·로고가 놓일, 비워 두어야 할 사각형들 (캔버스 좌표). */
  reserved: readonly LayoutRect[]
  /** 제품이 바닥에 닿는 높이 (캔버스 y). 없으면 접지선을 지정하지 않는다. */
  groundY?: number
  /**
   * 디자인 스타일 레퍼런스를 함께 보내는가.
   *
   * 참일 때만 아래 `## 함께 보낸 스타일 레퍼런스` 문단이 붙는다. 레퍼런스가
   * 없는데 그 말을 하면 모델이 있지도 않은 그림을 찾는다.
   */
  styleReference?: boolean
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function lightWord(x: number, y: number): string {
  const horizontal = x < -0.12 ? '왼쪽' : x > 0.12 ? '오른쪽' : '정면'
  const vertical = y < -0.12 ? '위' : y > 0.12 ? '아래' : '가운데 높이'
  return `${horizontal} ${vertical}`
}

function region(rect: LayoutRect, size: { width: number; height: number }): string {
  const left = percent(rect.x / size.width)
  const top = percent(rect.y / size.height)
  const w = percent(rect.width / size.width)
  const h = percent(rect.height / size.height)
  return `가로 ${left} 지점부터 ${w}, 세로 ${top} 지점부터 ${h}`
}

/**
 * 주문 한 편.
 *
 * 순서는 모델이 읽는 순서다: 무엇을 만드는가 → 어떤 분위기인가 → 어떤 색과
 * 빛인가 → 어디를 비워야 하는가 → 무엇을 그리면 안 되는가. 금지가 맨 뒤인 것은
 * 그것이 마지막까지 남아야 하는 조건이기 때문이다.
 */
export function buildBackgroundPrompt(input: BackgroundPromptInput): string {
  const { wish, size, analysis, reserved, groundY } = input
  const lines: string[] = []

  lines.push(
    '광고에 쓸 **빈 배경 이미지** 한 장을 만들어 주세요.',
    '제품과 인물과 문구는 이 배경 위에 나중에 따로 얹습니다. 그러니 배경만 그려 주세요.',
    `크기는 가로 ${size.width}, 세로 ${size.height} 비율입니다.`,
  )

  const trimmed = wish.trim()
  if (trimmed.length > 0) lines.push('', '## 원하는 분위기', trimmed)

  if (input.styleReference === true) {
    // **참고**라고만 말한다. 베끼라는 말은 쓰지 않는다 — 레퍼런스는 남의 디자인
    // 이고, 우리가 원하는 것도 그 분위기이지 그 그림이 아니다.
    lines.push(
      '',
      '## 함께 보낸 스타일 레퍼런스',
      '첨부한 그림의 색감·질감·그래픽 밀도, 그리고 콜라주와 매거진 편집의 결을 참고해 주세요.',
      '참고만 하는 것입니다. 같은 그림을 만들어 달라는 뜻이 아니고, 거기 있는 물건·글자·구성을 옮겨 오지 말아 주세요.',
      '만드는 것은 배경과 추상적인 장식, 프레임, 질감, 여백입니다.',
    )
  }

  if (analysis !== null) {
    const colours = analysis.palette.map((p) => `${p.hex} (${percent(p.share)})`).join(', ')
    lines.push(
      '',
      '## 함께 놓일 원본의 색·빛 (측정값)',
      `대표 색: ${colours}`,
      `평균 명도 ${percent(analysis.brightness)}, 명암 대비 ${percent(analysis.contrast)}, 채도 ${percent(analysis.saturation)}`,
      analysis.temperature > 0.05
        ? '색온도: 따뜻한 쪽'
        : analysis.temperature < -0.05
          ? '색온도: 차가운 쪽'
          : '색온도: 중간',
      `빛이 오는 쪽: ${lightWord(analysis.light.x, analysis.light.y)} (밝기 기울기로 짐작한 값이라 정확하지 않습니다. 배경의 빛을 이 방향과 크게 어긋나지 않게만 맞춰 주세요.)`,
      '이 배경 위에 얹힐 원본과 색과 빛이 어울리게 해 주세요.',
    )
  }

  if (reserved.length > 0) {
    lines.push('', '## 비워 두어야 하는 자리')
    for (const rect of reserved) lines.push(`- ${region(rect, size)} 자리는 단순하게 비워 주세요.`)
    lines.push(
      '이 자리에는 나중에 제품과 문구가 놓입니다. 무늬나 밝은 대비를 넣지 말아 주세요.',
      '그 위에 글이 올라가므로 가독성을 방해하지 않아야 합니다.',
    )
  }

  if (groundY !== undefined) {
    lines.push(
      '',
      `## 바닥면`,
      `세로 ${percent(groundY / size.height)} 지점에 바닥과 배경이 만나는 선이 오게 해 주세요. 그 위에 제품이 놓입니다.`,
    )
  }

  lines.push(
    '',
    '## 넣지 말 것',
    ...BACKGROUND_BANNED.map((item) => `- ${item}`),
    '- 화면 가운데에 눈길을 끄는 새 물체를 임의로 놓는 것',
    '',
    '가운데는 비어 있고 가장자리와 바닥만으로 공간이 느껴지는 배경이면 좋습니다.',
  )

  return lines.join('\n')
}
