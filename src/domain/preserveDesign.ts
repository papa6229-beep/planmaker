/**
 * 고정 오브젝트와 자유 텍스트 (한방 생성 Patch 2).
 *
 * 앞선 판은 완성 디자인 **한 장**을 모델에게 시켰다. 그 한 장 안에 배경도,
 * 장식도, 문구도, 그리고 우리가 보낸 일반 이미지까지 모델이 직접 그려 넣었고 —
 * 바로 거기서 계약이 깨졌다. 좌표를 글로 적어 보내도 모델은 구도를 자기 마음대로
 * 다시 잡고, "여기는 비워 두라"는 말에는 흰 판이나 실루엣을 그려 넣는다. 모델은
 * *아무것도 그리지 않는 것*을 출력할 수 없기 때문이다.
 *
 * 그래서 이제 그림을 세 겹으로 나눈다.
 *
 *   1. **배경 플레이트** — 배경과 장식뿐. 문구도, 인물·제품·로고도 없다.
 *   2. (브라우저) 사용자가 배치한 이미지와 종이 컷아웃 — 원본 그대로, 좌표·크기·
 *      비율·레이어 순서 그대로.
 *   3. **전경 문구 레이어** — 단색 위에 문구만. 그 단색은 브라우저가 걷어 낸다.
 *
 * 이 모듈은 1과 3의 주문을 짓는다. 두 주문 모두 **사용자 이미지를 한 장도 보내지
 * 않는다** — 보내는 순간 모델이 그것을 다시 그리기 시작하고, 그 결과가 지금 고치는
 * 결함이다. 자리는 글로만 간다. 좌표는 픽셀이 아니다.
 *
 * 순수 모듈이다. 자산 저장소도 캔버스도 모른다.
 */

import { TEXT_KEY_HEX } from './chromaKey'
import { areaShare, importanceRanks, type TextLayerBlock, type TextLayerTone } from './textLayers'
import type { GenerationInputImage } from './imageGenerationInputs'
import type { TextAlign } from './simpleBlocks'
import type { LayoutRect } from './imageLayout'

export interface PreserveTextEntry {
  blockId: string
  /** 작업자가 적은 그대로. 한 글자도 바꾸지 않는다. */
  content: string
  rect: LayoutRect
  align: TextAlign
  /** 뒤에서부터 몇 번째인가 — 클수록 앞이다. */
  layer: number
  /** 문구인가 버튼인가 (스티커판 Patch §3). */
  kind: 'text' | 'button'
  /** 이미지·컷아웃과 겹치는가 (스티커판 Patch §3). */
  overlapsImage: boolean
  /** 기획서 화면이 이 문구를 끊는 줄 (블록별 문구 2차 Patch). */
  lines: readonly string[]
}

/**
 * 브라우저가 원본 그대로 얹을 것 — 일반 이미지와 종이 컷아웃 **둘 다**.
 *
 * 모델에게는 `assetId`가 가지 않는다. 여기 담아 두는 이유는 부르는 쪽이 같은
 * 목록으로 합성까지 하기 때문이고, 그래야 "비워 달라고 말한 자리"와 "실제로 얹는
 * 자리"가 갈라지지 않는다.
 */
export interface FixedObject {
  blockId: string
  assetId: string
  rect: LayoutRect
  layer: number
  cutout: boolean
  /**
   * 이 사진이 어떤 색인가 — **숫자뿐이다** (배경 색맞춤 Patch).
   *
   * 배경은 지금까지 그 자리에 무엇이 놓일지 모르는 채로 만들어졌다. 어울리는
   * 배경이 나올 근거가 없었다는 뜻이다. 그림은 여전히 나가지 않고, 브라우저가
   * 읽은 이 값만 나간다.
   */
  tone?: FixedTone | null
}

/** 사진 한 장에서 읽은 색. `imageAnalysis`가 재는 값의 일부다. */
export interface FixedTone {
  /** 많이 쓰인 순서의 대표색 (소문자 16진수). */
  palette: readonly string[]
  average: { r: number; g: number; b: number }
  /** 0=어두움, 1=밝음. */
  brightness: number
  /** 0=평평함, 1=명암 차가 큼. */
  contrast: number
  /** 0=무채색, 1=쨍함. */
  saturation: number
  /** -1=차가움, +1=따뜻함. */
  temperature: number
}

export interface PlateInput {
  size: { width: number; height: number }
  /** 스타일 레퍼런스. 없으면 색과 결을 스스로 정하게 둔다. */
  styleReferenceAssetId?: string | undefined
  /** 나중에 실물이 놓일 자리 — 좌표만. */
  fixed: readonly FixedObject[]
  /** 작업자가 추가로 적은 말. */
  note?: string
  /**
   * 기획서가 적어 둔 **이 행사의 컨셉** (컨셉 전달 교정).
   *
   * 한방 생성 시절에는 이 말이 프롬프트에 실려 갔는데, 겹으로 나누면서 어느
   * 쪽에도 실리지 않게 됐다 — 배경도 문구도 "무슨 행사인지"를 모른 채 만들어졌다.
   * 검사가 그 자리를 잡았다. 분위기를 정하는 말이므로 배경과 문구 양쪽에 간다.
   */
  concept?: string
  /**
   * 레퍼런스의 **배경 구성 자체**를 최대한 살릴 것인가 (배경 색맞춤 Patch).
   *
   * 기본은 거짓 — 색감과 결만 참고하고 구성은 새로 잡는다. 참이면 같은 배경을
   * 다시 만들어 달라고 말한다. 어느 쪽이든 레퍼런스를 그대로 복제하라는 뜻은
   * 아니다.
   */
  keepReferenceBackground?: boolean
}

/**
 * 문구·버튼 한 장 주문의 재료 (블록별 문구 Patch).
 *
 * 블록 하나에 한 장이다. 모델에게 시키는 것은 **글자 한 덩어리를 예쁘게 그리는
 * 일**뿐이고, 그 그림을 어디에 얼마나 크게 놓을지는 브라우저가 정한다.
 */
export interface TextLayerInput {
  /** 페이지 크기. 자리·넓이를 설명할 때의 기준자다. */
  size: { width: number; height: number }
  styleReferenceAssetId?: string | undefined
  /** 1단계에서 **실제로 생성된** 배경. 사용자 이미지가 아니다. */
  backgroundAssetId?: string | undefined
  /** 이번에 그릴 블록 하나. */
  block: TextLayerBlock
  /** 이 페이지의 문구·버튼 전부 — 위계를 매기는 근거로만 쓴다. */
  siblings: readonly TextLayerBlock[]
  /** 사진이 이미 놓인 자리 — 좌표뿐이다. */
  fixed: readonly FixedObject[]
  note?: string
  /** 기획서의 컨셉 (컨셉 전달 교정). 배경과 같은 말을 문구도 듣는다. */
  concept?: string
  /** 이 블록에만 붙는 작업자 주문 (블록별 주문 Patch). */
  blockNote?: string
  /** 이 블록만 참고할 그림이 붙어 있는가. 있으면 주문이 그 그림을 가리킨다. */
  blockReference?: boolean
}

/**
 * 두 요청에 실을 수 있는 자산 번호.
 *
 * **스타일 레퍼런스 하나뿐이다.** 제품·인물·로고·컷아웃이 끼어들 인자가 이 함수에
 * 아예 없다 — 목록을 만드는 자리가 하나뿐이면, 언젠가 섞이는 일도 없다.
 */
export function preserveAttachmentIds(styleReferenceAssetId?: string | undefined): string[] {
  return styleReferenceAssetId === undefined ? [] : [styleReferenceAssetId]
}

function styleInput(assetId: string | undefined, label: string): GenerationInputImage[] {
  if (assetId === undefined) return []
  return [{ index: 1, role: 'page_reference', assetId, fileName: 'style-reference.png', label }]
}

export function planPlateInputs(input: PlateInput): GenerationInputImage[] {
  return styleInput(input.styleReferenceAssetId, '디자인 스타일 레퍼런스 — 색감·질감·그래픽 언어 참고용입니다.')
}

/**
 * 문구 한 장 요청에 붙는 그림 — 스타일 레퍼런스와 **AI가 만든 배경**뿐이다.
 *
 * 배경은 1단계에서 이 도구가 받아 온 그림이라 사용자의 사진이 아니다. 고정
 * 이미지가 얹힌 합성 페이지는 여기 낄 자리가 없다 — 인자에 아예 없다.
 */
export function planTextLayerInputs(input: {
  styleReferenceAssetId?: string | undefined
  backgroundAssetId?: string | undefined
  /** 이 블록만 참고할 그림 (블록별 주문 Patch). */
  blockReferenceAssetId?: string | undefined
}): GenerationInputImage[] {
  const images = styleInput(
    input.styleReferenceAssetId,
    '디자인 스타일 레퍼런스 — 타이포그래피 위계와 글자 효과 참고용입니다.',
  )
  if (input.backgroundAssetId !== undefined) {
    images.push({
      index: images.length + 1,
      role: 'page_reference',
      assetId: input.backgroundAssetId,
      fileName: 'background-plate.png',
      label: '1단계에서 생성된 배경 — 이 배경 위에서 글씨가 읽히도록 색과 대비를 정하기 위한 자료입니다.',
    })
  }
  if (input.blockReferenceAssetId !== undefined) {
    images.push({
      index: images.length + 1,
      role: 'page_reference',
      assetId: input.blockReferenceAssetId,
      fileName: 'block-reference.png',
      label: '이 문구만을 위한 참고 그림 — 이런 모양·구성으로 만들어 달라는 뜻입니다.',
    })
  }
  return images
}

/**
 * 부분수정 한 장 요청에 붙는 그림 (부분수정 재료 Patch).
 *
 * 지금까지 여기 실린 것은 **고칠 문구의 지금 그림 한 장**뿐이었다. 첫 생성은
 * 스타일 레퍼런스와 생성된 배경을 보고 색을 정하는데, 고치는 쪽은 그 둘을 한 번도
 * 본 적이 없었다 — "배경과 어울리게" 라고 적어도 배경이 무엇인지 모르는 채로
 * 그렸다는 뜻이다. 엉뚱한 색이 돌아온 이유가 이것이다.
 *
 * 그래서 첫 생성이 보내는 것을 **그대로** 보낸다. 호출 횟수는 늘지 않는다.
 */
export function planTextEditInputs(input: {
  /** 고칠 문구의 지금 그림. 이 요청의 주인공이라 언제나 1번이다. */
  currentAssetId: string
  styleReferenceAssetId?: string | undefined
  backgroundAssetId?: string | undefined
  blockReferenceAssetId?: string | undefined
}): GenerationInputImage[] {
  const images: GenerationInputImage[] = [
    {
      index: 1,
      role: 'page_layout',
      assetId: input.currentAssetId,
      fileName: 'current-text.png',
      label: '지금의 문구 디자인 — 이것을 고칩니다.',
    },
  ]
  if (input.styleReferenceAssetId !== undefined) {
    images.push({
      index: images.length + 1,
      role: 'page_reference',
      assetId: input.styleReferenceAssetId,
      fileName: 'style-reference.png',
      label: '디자인 스타일 레퍼런스 — 타이포그래피 위계와 글자 효과 참고용입니다.',
    })
  }
  if (input.backgroundAssetId !== undefined) {
    images.push({
      index: images.length + 1,
      role: 'page_reference',
      assetId: input.backgroundAssetId,
      fileName: 'background-plate.png',
      label: '이 글자가 실제로 놓여 있는 배경 — 그 위에서 읽히도록 색과 대비를 정하기 위한 자료입니다.',
    })
  }
  if (input.blockReferenceAssetId !== undefined) {
    images.push({
      index: images.length + 1,
      role: 'page_reference',
      assetId: input.blockReferenceAssetId,
      fileName: 'block-reference.png',
      label: '이 문구만을 위한 참고 그림 — 이런 모양·구성으로 만들어 달라는 뜻입니다.',
    })
  }
  return images
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function region(rect: LayoutRect, size: { width: number; height: number }): string {
  return [
    `가로 ${percent(rect.x / size.width)} 지점부터 ${percent(rect.width / size.width)}`,
    `세로 ${percent(rect.y / size.height)} 지점부터 ${percent(rect.height / size.height)}`,
  ].join(', ')
}

const ALIGN_WORD: Record<TextAlign, string> = { left: '왼쪽', center: '가운데', right: '오른쪽' }

/**
 * 1) 배경 플레이트 주문.
 *
 * 여기서 나오는 것은 **배경과 장식뿐**이다. 문구는 다음 겹에서 얹고, 인물·제품·
 * 로고는 브라우저가 원본으로 얹는다. 모델이 그 자리에 무언가를 그리면 같은 것이
 * 두 번 나오거나 실물 뒤에 흰 판이 깔린다 — 지금 고치는 결함이 그것이다.
 */
export function buildPlatePrompt(input: PlateInput): string {
  const { size, fixed, note, concept } = input
  const lines: string[] = []

  lines.push(
    '이벤트 페이지의 **배경 레이어** 한 장을 만들어 주세요.',
    '완성 디자인이 아니라, 완성 디자인의 맨 뒤에 깔릴 배경과 장식입니다.',
    `크기는 가로 ${size.width}, 세로 ${size.height} 비율이고 화면 전체를 채웁니다.`,
  )

  lines.push(
    '',
    '## 만들 것',
    '- 스타일 레퍼런스와 비슷한 색감·질감의 배경',
    '- 별, 꽃, 하프톤, 스티커, 라벨, 프레임, 종이 질감, 낙서처럼 그 스타일에 어울리는 장식',
    '- 아래 "비워 둘 자리"를 고려한 여백과 흐름',
  )

  if (fixed.length > 0) {
    lines.push('', '## 비워 둘 자리 (나중에 실물 사진이 그대로 놓입니다)')
    for (const item of fixed) {
      lines.push(`- ${item.cutout ? '오려 붙인 컷아웃' : '사진'} · ${region(item.rect, size)}`)
      // 그림은 나가지 않는다. 브라우저가 읽은 숫자만 간다 — 그래야 배경이 그
      // 자리에 무엇이 놓일지 알고도, 원본은 밖으로 나가지 않는다.
      if (item.tone == null) continue
      const tone = item.tone
      lines.push(
        `  그 자리에 놓일 것의 색: 대표색 ${tone.palette.slice(0, 4).join(' ')} · 평균색 R${String(Math.round(tone.average.r))} G${String(Math.round(tone.average.g))} B${String(Math.round(tone.average.b))}`,
        `  밝기 ${tone.brightness.toFixed(2)} · 대비 ${tone.contrast.toFixed(2)} · 채도 ${tone.saturation.toFixed(2)} · 색온도 ${tone.temperature.toFixed(2)} (-1 차가움, +1 따뜻함)`,
      )
    }
    lines.push(
      '이 자리에 **인물·제품·로고·실루엣을 새로 만들지 않습니다.**',
      '흰 패널, 흰 카드, 액자, 테두리 상자, 빈 사각형처럼 "자리를 표시하는 판"도 만들지 않습니다.',
      '배경과 장식이 그 자리를 자연스럽게 지나가게만 해 주세요. 그 위에 실제 사진이 놓입니다.',
      '',
      '위에 적은 색은 **그 자리에 실제로 놓일 사진의 색**입니다. 그 사진이 배경 위에서 살도록,',
      '같은 색으로 묻히지 않게 하고 인접한 자리의 색·밝기·대비를 잡아 주세요.',
      '오려 붙인 컷아웃은 흰 종이 테두리를 두르고 놓이므로, 그 둘레가 배경과 붙지 않게 해 주세요.',
    )
  }

  lines.push(
    '',
    '## 스타일 레퍼런스에 대하여',
    input.keepReferenceBackground === true
      ? '이 레퍼런스의 **배경 구성을 최대한 그대로 살려** 주세요 — 같은 색, 같은 질감, 같은 장식의 결로. 다만 위의 "비워 둘 자리"는 지켜 주세요.'
      : '색감·질감·그래픽 언어를 참고하기 위한 자료입니다. 같은 이미지를 복제하지 않습니다.',
  )

  const mood = (concept ?? '').trim()
  if (mood.length > 0) lines.push('', '## 이 행사의 컨셉', mood)

  const trimmed = (note ?? '').trim()
  if (trimmed.length > 0) lines.push('', '## 작업자의 추가 지시', trimmed)

  lines.push(
    '',
    '## 넣지 말 것',
    '- 글자와 문구 (문구는 다음 단계에서 따로 얹습니다)',
    '- 사람, 제품, 로고',
    '- 흰 패널·카드·액자 같은 자리 표시용 판',
    '- 워터마크',
  )

  return lines.join('\n')
}

/**
 * 1-b) 배경 판 **고치기** 주문 (배경만 다시 그리기 Patch).
 *
 * 지금까지 `전체 배경`을 고르면 완성된 통이미지 한 장을 통째로 다시 그렸다. 그
 * 길에는 두 가지 결함이 붙어 있었다.
 *
 *  - **다시 합치면 사라진다.** 완성본은 배경 판 + 조각들로 그때그때 다시 합쳐
 *    지는데, 통이미지 수정은 배경 판을 바꾸지 않는다. 그래서 조각 하나만 옮겨도
 *    수정 전 배경이 돌아온다.
 *  - **고정이 지켜지지 않는다.** 통이미지를 보내면 그 안의 제품 사진까지 모델이
 *    다시 그린다. "고정"이라고 적어 보내도 늘어나거나 변형된다.
 *
 * 둘 다 같은 뿌리다 — 배경을 고치라면서 **배경이 아닌 것까지** 보냈다. 그래서
 * 여기서는 배경 판 한 장만 보내고 배경 판 한 장만 받는다. 조각은 애초에 나가지
 * 않으므로 변형될 수가 없고, 판이 바뀌었으므로 다시 합쳐도 수정이 남는다.
 */
export function buildPlateEditPrompt(input: {
  size: { width: number; height: number }
  instruction: string
  /** 나중에 실물이 놓일 자리 — 좌표만. 첫 주문과 같은 규칙이다. */
  fixed: readonly { rect: LayoutRect; cutout: boolean }[]
  styleReference?: boolean
  concept?: string
}): string {
  const lines: string[] = [
    '이벤트 페이지의 **배경 레이어**를 고쳐 주세요.',
    '보내 드린 1번 그림이 지금의 배경입니다. 완성 디자인이 아니라, 완성 디자인의 맨 뒤에 깔리는 판입니다.',
    `크기는 가로 ${String(input.size.width)}, 세로 ${String(input.size.height)} 비율이고 화면 전체를 채웁니다.`,
    '',
    '## 작업자의 수정 지시',
    input.instruction.trim(),
  ]

  if (input.fixed.length > 0) {
    lines.push('', '## 비워 둘 자리 (이 배경 위에 실물 사진이 그대로 놓입니다)')
    for (const item of input.fixed) {
      lines.push(`- ${item.cutout ? '오려 붙인 컷아웃' : '사진'} · ${region(item.rect, input.size)}`)
    }
    lines.push(
      '이 자리에 **인물·제품·로고·실루엣을 새로 만들지 않습니다.**',
      '흰 패널, 흰 카드, 액자, 테두리 상자처럼 "자리를 표시하는 판"도 만들지 않습니다.',
    )
  }

  const mood = (input.concept ?? '').trim()
  if (mood.length > 0) lines.push('', '## 이 행사의 컨셉', mood)

  lines.push(
    '',
    '## 넣지 말 것',
    '- 글자와 문구 (문구는 따로 얹혀 있습니다)',
    '- 사람, 제품, 로고',
    '- 워터마크',
  )

  return lines.join('\n')
}

/** 배경 판을 고치는 요청에 실리는 그림 — 지금 판, 그리고 있으면 레퍼런스. */
export function planPlateEditInputs(input: {
  /** 고칠 배경 판의 지금 그림. 이 요청의 주인공이라 언제나 1번이다. */
  currentAssetId: string
  styleReferenceAssetId?: string | undefined
}): GenerationInputImage[] {
  const images: GenerationInputImage[] = [
    {
      index: 1,
      role: 'page_layout',
      assetId: input.currentAssetId,
      fileName: 'current-plate.png',
      label: '지금의 배경 판 — 이것을 고칩니다.',
    },
  ]
  if (input.styleReferenceAssetId !== undefined) {
    images.push({
      index: images.length + 1,
      role: 'page_reference',
      assetId: input.styleReferenceAssetId,
      fileName: 'style-reference.png',
      label: '디자인 스타일 레퍼런스 — 색감과 결의 참고용입니다.',
    })
  }
  return images
}

/**
 * 1-c) 이미지 조각 하나 **고치기** 주문 (조각 수정 Patch).
 *
 * 작업자의 말 그대로다: "일반 이미지는 부분수정으로 색상, 구도 등을 우리가 웹에
 * 이미지 첨부하고 수정 요청한 것처럼 변경되게." 그러니 보내는 것도 그 그림
 * **한 장**이다. 완성본을 보내면 그 안의 다른 조각까지 다시 그려진다.
 *
 * ## 투명한 데가 있었는가
 *
 * 이 하나로 주문이 갈린다.
 *
 *  - **없었다** (사각형 사진): 그대로 사각형으로 받는다. 배경을 따로 말할 것이
 *    없다.
 *  - **있었다** (누끼·컷아웃): 투명한 자리를 마젠타 단색으로 채워 달라고 하고,
 *    브라우저가 그 색을 걷어 낸다. `gpt-image-2`는 투명 배경 요청을 거절하므로
 *    (`Transparent background is not supported for this model.`) 문구 조각이 쓰는
 *    그 방법을 그대로 쓴다. 이것이 없으면 컷아웃을 한 번 고치는 순간 사각형이
 *    되어, 종이 테두리가 제품이 아니라 네모를 두른다.
 */
export function buildImageEditPrompt(input: {
  size: { width: number; height: number }
  instruction: string
  /** 원본에 투명한 데가 있었는가. 있었으면 결과에도 있어야 한다. */
  keepAlpha: boolean
  /** 무엇인지 — `이미지 2 — 제품 A` 처럼. 없으면 적지 않는다. */
  label?: string
}): string {
  const lines: string[] = [
    '보내 드린 1번 그림 **한 장만** 고쳐 주세요.',
    '완성된 페이지의 일부가 아니라, 그 자리에 놓일 그림 하나입니다.',
    `크기는 가로 ${String(input.size.width)}, 세로 ${String(input.size.height)} 비율 그대로입니다.`,
  ]
  const what = (input.label ?? '').trim()
  if (what.length > 0) lines.push(`이 그림은 "${what}" 자리에 놓입니다.`)

  lines.push('', '## 작업자의 수정 지시', input.instruction.trim())

  if (input.keepAlpha) {
    lines.push(
      '',
      '## 배경',
      `원본은 배경이 비어 있는 그림입니다. 비어 있던 자리는 **단색 마젠타(${TEXT_KEY_HEX})** 한 가지로 빈틈없이 채워 주세요.`,
      '마젠타는 나중에 지워지고, 남은 그림만 원래 자리에 갈아 끼워집니다.',
      '그림자·반사·테두리를 마젠타 위에 그리지 않습니다. 지워질 색 위에 그린 것은 함께 사라집니다.',
      '**피사체 안에는 마젠타를 쓰지 않습니다.** 그 부분이 구멍이 됩니다.',
    )
  }

  lines.push(
    '',
    '## 그대로 둘 것',
    '- 화면 안에서 피사체가 놓인 자리와 크기 — 가장자리에 맞춰 꽉 채웁니다.',
    '- 지시에 없는 것 (다른 부분은 원본 그대로)',
    '',
    '## 넣지 말 것',
    '- 글자와 문구',
    '- 액자, 테두리, 배경 판',
    '- 워터마크',
  )

  return lines.join('\n')
}

/** 이미지 조각을 고치는 요청에 실리는 그림 — 지금 그 조각, 그리고 참고 자료. */
export function planImageEditInputs(input: {
  /** 고칠 조각의 지금 그림. 이 요청의 주인공이라 언제나 1번이다. */
  currentAssetId: string
  blockReferenceAssetId?: string | undefined
}): GenerationInputImage[] {
  const images: GenerationInputImage[] = [
    {
      index: 1,
      role: 'page_layout',
      assetId: input.currentAssetId,
      fileName: 'current-piece.png',
      label: '지금의 그림 — 이것을 고칩니다.',
    },
  ]
  if (input.blockReferenceAssetId !== undefined) {
    images.push({
      index: images.length + 1,
      role: 'page_reference',
      assetId: input.blockReferenceAssetId,
      fileName: 'block-reference.png',
      label: '이 자리만을 위한 참고 그림 — 이런 모양·구성으로 만들어 달라는 뜻입니다.',
    })
  }
  return images
}

/**
 * 2) 문구·버튼 한 장 주문 (블록별 문구 Patch).
 *
 * 단색 마젠타 위에 **이 문구 하나만** 그린 한 장이다. 투명 배경은 이 모델이
 * 만들어 주지 않으므로(공급자 답: `Transparent background is not supported for
 * this model.`), 브라우저가 그 단색을 걷어 낸다 (`chromaKey.ts`).
 *
 * 앞선 판들과 다른 것은 하나다. **자리를 지키라고 시키지 않는다.** 판 어디에
 * 그리든 상관없다고 분명히 말해 두고, 받은 그림에서 그려진 부분만 잘라 내
 * 브라우저가 기획서 자리에 앉힌다. 모델이 못 하는 일을 시키지 않는 것이 요점이다.
 *
 * 자리·넓이·중요도·겹침·주변 색은 여전히 전부 전달한다 — 다만 그것은 "어떤
 * 디자인이어야 하는가"의 근거이지 배치 지시가 아니다.
 */
export function buildTextLayerPrompt(input: TextLayerInput): string {
  const { size, block, siblings, fixed, backgroundAssetId, note, concept } = input
  const rank = importanceRanks(siblings, size).get(block.blockId) ?? 1
  const lines: string[] = []

  const rows = block.lines.length > 0 ? block.lines : [block.content]

  lines.push(
    `${block.kind === 'button' ? '버튼' : '문구'} **한 개**를 디자인해 주세요.`,
    `배경은 **단색 마젠타(${TEXT_KEY_HEX})** 한 가지로 화면 전체를 빈틈없이 채우고, 그 위에 이것 하나만 올립니다.`,
    '마젠타는 나중에 지워집니다. 남은 글자만 이미 만들어진 배경과 사진 위에 얹힙니다.',
  )

  lines.push(
    '',
    `## 줄 나눔 — 정확히 ${String(rows.length)}줄입니다`,
    ...rows.map((row, i) => `${String(i + 1)}행: "${row}"`),
    '**이 줄 나눔을 그대로 지켜 주세요.** 한 줄을 둘로 쪼개거나 두 줄을 하나로 붙이지 않습니다.',
    '기획서에서 정한 형태이고, 이대로 실제 페이지에 들어갑니다.',
  )

  lines.push(
    '',
    '## 판을 어떻게 쓰는가',
    '- 이 판은 **이 문구 하나만을 위한 자리**입니다. 판 전체를 문구가 채우게 그려 주세요.',
    '- 가장자리 여백은 최소로. 작게 그리면 최종 화질이 떨어집니다.',
    '- **글자를 기울이지 마세요.** 각 줄은 판의 가로선과 나란한 수평입니다.',
    '- 이 문구 말고는 아무것도 그리지 않습니다.',
  )

  lines.push(
    '',
    '## 이 문구의 성격',
    `- 실제 페이지에서의 자리: ${region(block.rect, size)} · 정렬 ${ALIGN_WORD[block.align]}`,
    `- 지면에서 차지하는 넓이: ${percent(areaShare(block.rect, size))} · 중요도 ${String(rank)}위 / ${String(siblings.length)}개`,
    `- 사진·컷아웃과 겹치는가: ${block.overlapsImage ? '겹칩니다 — 사진 위에서도 또렷하게 읽히도록 대비·외곽선·그림자를 충분히 쓰세요.' : '겹치지 않습니다.'}`,
  )
  if (block.tone != null) {
    const tone = block.tone
    lines.push(
      `- 그 자리 주변의 색: 평균색 R${String(Math.round(tone.average.r))} G${String(Math.round(tone.average.g))} B${String(Math.round(tone.average.b))}, 밝기 ${tone.brightness.toFixed(2)} (0=어두움, 1=밝음), 대비 ${tone.contrast.toFixed(2)}`,
      '- 이 배경 위에서 또렷하게 읽히도록 색과 대비를 정해 주세요.',
    )
  }

  lines.push(
    '',
    '## 원문은 한 글자도 바꾸지 않습니다',
    '**문자·숫자·띄어쓰기·기호·줄바꿈을 절대 바꾸지 않습니다.** 맞춤법을 고치거나 줄여 쓰거나 번역하지 말아 주세요.',
    '지시에 없는 문구를 새로 만들지 않습니다.',
  )

  lines.push(
    '',
    '## 크기와 중요도',
    '- 중요도가 앞선 문구일수록 굵고 강한 활자로, 뒤일수록 차분하게 풀어 주세요.',
    '- 스타일 레퍼런스의 글꼴 분위기와 디자인 표현을 참고해 주세요.',
    '- 글자색·외곽선·그림자, 그리고 이 문구에 붙는 라벨·배지까지는 함께 그려도 좋습니다.',
  )

  if (block.kind === 'button') {
    lines.push(
      '',
      '## 버튼을 그릴 때',
      '- **배경판·테두리·글자를 한 덩어리로** 함께 그려 주세요.',
    )
  }

  if (fixed.length > 0) {
    lines.push(
      '',
      '## 실제 페이지에서 사진이 이미 놓여 있는 자리',
      ...fixed.map((item) => `- ${region(item.rect, size)}`),
      '이 자리에 **사람·제품·로고를 새로 그리지 않습니다.**',
    )
  }

  lines.push(
    '',
    '## 함께 보낸 이미지에 대하여',
    '- 디자인 스타일 레퍼런스: 타이포그래피 위계와 글자 효과를 참고하기 위한 자료입니다. 같은 이미지를 복제하지 않습니다.',
  )
  if (backgroundAssetId !== undefined) {
    lines.push(
      '- 1단계에서 생성된 배경: 이 글자가 실제로 놓일 바탕입니다. 그 위에서 읽히도록 색과 대비를 정해 주세요. **배경을 다시 그리지 않습니다.**',
    )
  }

  if (input.blockReference === true) {
    lines.push(
      '- 이 문구만을 위한 참고 그림: **이 문구를 어떤 모양·구성으로 만들지**에 대한 자료입니다. 라벨 위의 글자, 상자 위의 글자처럼 짜임새를 그대로 따라 주세요. 그림 속 문구가 아니라 위에 적은 원문을 씁니다.',
    )
  }

  const blockNote = (input.blockNote ?? '').trim()
  if (blockNote.length > 0) {
    lines.push('', '## 이 문구에 대한 작업자의 주문', blockNote, '페이지 전체 지시보다 이 주문이 우선합니다.')
  }

  const mood = (concept ?? '').trim()
  if (mood.length > 0) lines.push('', '## 이 행사의 컨셉', mood)

  const trimmed = (note ?? '').trim()
  if (trimmed.length > 0) lines.push('', '## 작업자의 추가 지시 (페이지 전체)', trimmed)

  lines.push(
    '',
    '## 넣지 말 것',
    `- 배경 사진·그러데이션·무늬 (배경은 단색 마젠타 ${TEXT_KEY_HEX} 한 가지입니다)`,
    '- 별·꽃·테이프·하프톤처럼 이 문구에 속하지 않는 배경 장식',
    '- 기울인 글자, 아치·부채꼴처럼 줄을 휘게 하는 배치',
    '- 위에 적은 줄 나눔과 다른 줄 나눔',
    '- 다른 문구, 안내 글자, 틀·구분선',
    '- 글자·외곽선·그림자·라벨·배지에 마젠타나 그와 비슷한 분홍·자주 계열 색',
    '- 사람, 제품, 로고',
    '- 워터마크',
  )

  return lines.join('\n')
}

/**
 * 3) 문구 하나만 다시 디자인하는 주문 (부분수정 재료 Patch).
 *
 * 배경도, 사진도, 옆 문구도 손대지 않는다. 이 요청이 만드는 것은 **그 문구 한
 * 장**뿐이고, 브라우저가 임시 단색을 걷어 내 같은 자리에 갈아 끼운다.
 *
 * 첫 생성과 **같은 재료**를 받는다 — 스타일 레퍼런스, 실제로 깔려 있는 배경, 이
 * 블록의 참고 그림, 그 자리 주변의 색, 줄 나눔까지. 앞선 판은 이 중 하나도 받지
 * 못한 채로 "배경과 어울리게"라는 지시를 읽어야 했고, 그래서 배경과 무관한 색이
 * 돌아왔다. 재료를 주는 쪽이 말을 더 잘 쓰는 쪽보다 언제나 확실하다.
 */
export interface TextEditInput {
  /** 요청하는 판의 비율. 블록 모양 그대로다. */
  size: { width: number; height: number }
  /** 페이지 크기 — 자리를 백분율로 설명하는 기준자다. 없으면 판 크기를 쓴다. */
  pageSize?: { width: number; height: number } | undefined
  content: string
  instruction: string
  rect: LayoutRect
  /** 기획서 화면이 이 문구를 끊는 줄. 비어 있으면 줄을 지정하지 않는다. */
  lines?: readonly string[] | undefined
  /** 이 자리에 실제로 깔려 있는 색 — 숫자뿐이다. */
  tone?: TextLayerTone | null | undefined
  /** 함께 보낸 그림이 무엇인가. */
  styleReference?: boolean
  background?: boolean
  blockReference?: boolean
  /** 이 블록에 붙여 둔 작업자의 주문 (블록별 주문 Patch). */
  blockNote?: string | undefined
  /** 이미 사진이 놓여 있는 자리 — 좌표뿐이다. */
  fixed?: readonly { rect: LayoutRect }[] | undefined
}

export function buildTextEditPrompt(input: TextEditInput): string {
  const { size, content, instruction, rect, tone } = input
  const page = input.pageSize ?? size
  const rows = input.lines !== undefined && input.lines.length > 0 ? input.lines : [content]

  const lines: string[] = [
    '문구 **한 개**만 새로 디자인해 주세요.',
    `배경은 **단색 마젠타(${TEXT_KEY_HEX})** 한 가지로 화면 전체를 빈틈없이 채우고, 그 위에 이 문구 하나만 올립니다.`,
    '마젠타는 나중에 지워집니다. 남은 글자만 원래 자리에 그대로 갈아 끼워집니다.',
    `크기는 가로 ${size.width}, 세로 ${size.height} 비율입니다.`,
    '',
    '## 작업자의 수정 지시',
    instruction.trim(),
  ]

  lines.push(
    '',
    `## 줄 나눔 — 정확히 ${String(rows.length)}줄입니다`,
    ...rows.map((row, i) => `${String(i + 1)}행: "${row}"`),
    '**이 줄 나눔을 그대로 지켜 주세요.** 한 줄을 둘로 쪼개거나 두 줄을 하나로 붙이지 않습니다.',
    '문구의 **문자·숫자·띄어쓰기·기호를 절대 바꾸지 않습니다.**',
  )

  lines.push(
    '',
    '## 판을 어떻게 쓰는가',
    '- 이 판은 **이 문구 하나만을 위한 자리**입니다. 판 전체를 문구가 채우게 그려 주세요.',
    '- 가장자리 여백은 최소로. 작게 그리면 최종 화질이 떨어집니다.',
    '- **글자를 기울이지 마세요.** 각 줄은 판의 가로선과 나란한 수평입니다.',
    '- 이 문구 말고는 아무것도 그리지 않습니다.',
  )

  lines.push('', '## 이 문구가 놓여 있는 자리', `- 실제 페이지에서의 자리: ${region(rect, page)}`)
  if (tone != null) {
    lines.push(
      `- 그 자리에 **실제로 깔려 있는 색**: 평균색 R${String(Math.round(tone.average.r))} G${String(Math.round(tone.average.g))} B${String(Math.round(tone.average.b))}, 밝기 ${tone.brightness.toFixed(2)} (0=어두움, 1=밝음), 대비 ${tone.contrast.toFixed(2)}`,
      '- 이 색 위에서 또렷하게 읽히도록 글자색과 대비를 정해 주세요. 배경에 묻히지 않게 합니다.',
    )
  }
  if (input.fixed !== undefined && input.fixed.length > 0) {
    lines.push(
      '- 사진이 이미 놓여 있는 자리: ' + input.fixed.map((item) => region(item.rect, page)).join(' / '),
    )
  }

  lines.push('', '## 함께 보낸 이미지', '- 지금의 문구 디자인: 이것을 고칩니다.')
  if (input.styleReference === true) {
    lines.push(
      '- 디자인 스타일 레퍼런스: 이 페이지 전체가 따르는 결입니다. 타이포그래피 위계와 글자 효과를 여기에 맞춰 주세요.',
    )
  }
  if (input.background === true) {
    lines.push(
      '- 이 글자가 놓여 있는 배경: **실제로 그 위에 얹힙니다.** 색·대비·질감을 이 배경과 어울리게 정해 주세요. 배경을 다시 그리지 않습니다.',
    )
  }
  if (input.blockReference === true) {
    lines.push(
      '- 이 문구만을 위한 참고 그림: **이 문구를 어떤 모양·구성으로 만들지**에 대한 자료입니다. 그림 속 문구가 아니라 위에 적은 원문을 씁니다.',
    )
  }

  const blockNote = (input.blockNote ?? '').trim()
  if (blockNote.length > 0) {
    lines.push('', '## 이 문구에 원래 붙어 있던 주문', blockNote, '위의 수정 지시가 이 주문보다 우선합니다.')
  }

  lines.push(
    '',
    '## 넣지 말 것',
    '- 다른 문구, 사람, 제품, 로고',
    `- 배경 사진·그러데이션·무늬 (배경은 단색 마젠타 ${TEXT_KEY_HEX} 한 가지입니다)`,
    '- 별·꽃·테이프·하프톤처럼 이 문구에 속하지 않는 배경 장식',
    '- 기울인 글자, 아치·부채꼴처럼 줄을 휘게 하는 배치',
    '- 글자·외곽선·그림자·라벨에 마젠타나 그와 비슷한 분홍·자주 계열 색',
    '- 워터마크',
  )
  return lines.join('\n')
}
