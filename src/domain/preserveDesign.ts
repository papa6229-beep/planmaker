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
 *   3. **전경 문구 레이어** — 배경이 투명한 한 장. 문구와 앞쪽 장식만.
 *
 * 이 모듈은 1과 3의 주문을 짓는다. 두 주문 모두 **사용자 이미지를 한 장도 보내지
 * 않는다** — 보내는 순간 모델이 그것을 다시 그리기 시작하고, 그 결과가 지금 고치는
 * 결함이다. 자리는 글로만 간다. 좌표는 픽셀이 아니다.
 *
 * 순수 모듈이다. 자산 저장소도 캔버스도 모른다.
 */

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
}

/** 플레이트에서 읽은 색 — 숫자뿐이다. 그림은 다음 요청에 실리지 않는다. */
export interface PlateTone {
  average: { r: number; g: number; b: number }
  brightness: number
}

export interface PlateInput {
  size: { width: number; height: number }
  /** 스타일 레퍼런스. 없으면 색과 결을 스스로 정하게 둔다. */
  styleReferenceAssetId?: string | undefined
  /** 나중에 실물이 놓일 자리 — 좌표만. */
  fixed: readonly FixedObject[]
  /** 작업자가 추가로 적은 말. */
  note?: string
}

export interface ForegroundInput {
  size: { width: number; height: number }
  styleReferenceAssetId?: string | undefined
  texts: readonly PreserveTextEntry[]
  /** 사진이 이미 놓인 자리 — 그 위로 글씨가 지나가도 좋다. */
  fixed: readonly FixedObject[]
  /** 배경 플레이트의 색. 없으면 레퍼런스만 보고 정하게 둔다. */
  tone?: PlateTone | null
  note?: string
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

export function planForegroundInputs(input: ForegroundInput): GenerationInputImage[] {
  return styleInput(
    input.styleReferenceAssetId,
    '디자인 스타일 레퍼런스 — 타이포그래피 위계와 글자 효과 참고용입니다.',
  )
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

/** 이 문구 상자가 지면에서 차지하는 넓이 — 위계를 읽는 근거. */
function areaShare(rect: LayoutRect, size: { width: number; height: number }): number {
  const total = size.width * size.height
  return total <= 0 ? 0 : (rect.width * rect.height) / total
}

/**
 * 1) 배경 플레이트 주문.
 *
 * 여기서 나오는 것은 **배경과 장식뿐**이다. 문구는 다음 겹에서 얹고, 인물·제품·
 * 로고는 브라우저가 원본으로 얹는다. 모델이 그 자리에 무언가를 그리면 같은 것이
 * 두 번 나오거나 실물 뒤에 흰 판이 깔린다 — 지금 고치는 결함이 그것이다.
 */
export function buildPlatePrompt(input: PlateInput): string {
  const { size, fixed, note } = input
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
    for (const item of fixed) lines.push(`- ${region(item.rect, size)}`)
    lines.push(
      '이 자리에 **인물·제품·로고·실루엣을 새로 만들지 않습니다.**',
      '흰 패널, 흰 카드, 액자, 테두리 상자, 빈 사각형처럼 "자리를 표시하는 판"도 만들지 않습니다.',
      '배경과 장식이 그 자리를 자연스럽게 지나가게만 해 주세요. 그 위에 실제 사진이 놓입니다.',
    )
  }

  lines.push(
    '',
    '## 스타일 레퍼런스에 대하여',
    '색감·질감·그래픽 언어를 참고하기 위한 자료입니다. 같은 이미지를 복제하지 않습니다.',
  )

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
 * 2) 전경 문구 레이어 주문.
 *
 * 배경이 **완전히 투명한** 한 장이다. 이 겹이 맨 앞이므로 문구는 언제나 사진보다
 * 앞에 오고, 사진 위를 가로질러도 된다.
 *
 * 좌표는 고정값이 아니라 힌트로 넘긴다 — 큰 상자는 핵심, 작은 상자는 보조라는
 * 뜻이고, 그 위계를 어떤 활자로 풀지는 레퍼런스를 보고 모델이 정한다.
 */
export function buildForegroundPrompt(input: ForegroundInput): string {
  const { size, texts, fixed, tone, note } = input
  const lines: string[] = []

  lines.push(
    '이벤트 페이지의 **전경 문구 레이어** 한 장을 만들어 주세요.',
    '배경은 **완전히 투명**해야 합니다. 이 그림은 이미 만들어진 배경과 사진 위에 그대로 얹힙니다.',
    `크기는 가로 ${size.width}, 세로 ${size.height} 비율입니다.`,
  )

  if (tone != null) {
    lines.push(
      '',
      '## 아래에 깔릴 배경의 색',
      `평균색 R${Math.round(tone.average.r)} G${Math.round(tone.average.g)} B${Math.round(tone.average.b)}, 밝기 ${tone.brightness.toFixed(2)} (0=어두움, 1=밝음)`,
      '이 배경 위에서 글씨가 또렷하게 읽히도록 색과 대비를 정해 주세요.',
    )
  }

  if (texts.length > 0) {
    lines.push('', '## 넣을 문구 (원문 그대로)')
    // 넓은 상자가 먼저 오게 늘어놓는다 — 목록의 차례가 곧 위계의 첫 신호다.
    const ordered = texts.toSorted((a, b) => areaShare(b.rect, size) - areaShare(a.rect, size))
    for (const text of ordered) {
      lines.push(
        `- "${text.content}"`,
        `  구성 힌트: ${region(text.rect, size)} · 정렬 ${ALIGN_WORD[text.align]} · 지면의 ${percent(areaShare(text.rect, size))}`,
      )
    }
    lines.push(
      '문구의 **문자·숫자·띄어쓰기·기호·줄바꿈을 절대 바꾸지 않습니다.** 맞춤법을 고치거나 줄여 쓰거나 번역하지 말아 주세요.',
      '지시에 없는 문구를 새로 만들지 않습니다.',
    )
  }

  lines.push(
    '',
    '## 자리는 고정값이 아니라 힌트입니다',
    '- 위의 자리·크기·정렬은 **중요도와 구성의 힌트**입니다. 그 사각형 안에 가둘 필요가 없습니다.',
    '- 큰 상자는 핵심 타이틀로, 작은 상자는 보조 정보로 읽어 주세요.',
    '- 스타일 레퍼런스의 타이포그래피 위계·폰트·자간·외곽선·그림자·색·겹침을 참고해 자유롭게 디자인해 주세요.',
    '- 문구끼리 겹치거나 기울여도 좋고 크기를 크게 달리해도 좋습니다. 읽히기만 하면 됩니다.',
  )

  if (fixed.length > 0) {
    lines.push('', '## 사진이 이미 놓여 있는 자리')
    for (const item of fixed) lines.push(`- ${region(item.rect, size)}`)
    lines.push(
      '이 자리에는 실제 사진이 이미 놓여 있습니다. **그 위로 글씨가 지나가도 좋습니다.**',
      '다만 이 자리에 **사람·제품·로고를 새로 그리지 않습니다.** 사진을 가리는 큰 색면도 만들지 않습니다.',
    )
  }

  lines.push(
    '',
    '## 스타일 레퍼런스에 대하여',
    '타이포그래피 위계와 글자 효과를 참고하기 위한 자료입니다. 같은 이미지를 복제하지 않습니다.',
  )

  const trimmed = (note ?? '').trim()
  if (trimmed.length > 0) lines.push('', '## 작업자의 추가 지시', trimmed)

  lines.push(
    '',
    '## 넣지 말 것',
    '- 불투명한 배경, 화면을 덮는 색면, 배경 사진 (배경은 투명해야 합니다)',
    '- 사람, 제품, 로고',
    '- 워터마크',
  )

  return lines.join('\n')
}
