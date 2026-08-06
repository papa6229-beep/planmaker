/**
 * 원본 보존 완성 디자인 (한방 생성 Patch §2).
 *
 * 종이 컷아웃이 하나라도 켜져 있으면 이 길로 간다. 모델은 배경만이 아니라
 * **완성 디자인 한 장**을 만든다 — 배경, 장식, 그리고 입력된 문구를 자유롭게
 * 디자인한 타이포그래피까지. 컷아웃만 브라우저가 나중에 원본 그대로 얹는다.
 *
 * 이 모듈이 지키는 경계는 하나다: **컷아웃의 픽셀은 나가지 않는다.**
 *
 * 그래서 기획서 배치도를 보내지 않는다. 배치도에는 컷아웃 그림이 이미 그려져
 * 있어서, 그것을 보내면 "원본을 보내지 않는다"는 말이 거짓이 된다. 배치는 글로
 * 적어 보낸다 — 좌표와 크기와 레이어 순서는 픽셀이 아니다.
 *
 * 순수 모듈이다. 자산 저장소도 캔버스도 모른다.
 */

import { MAX_INPUT_IMAGES, type GenerationInputImage } from './imageGenerationInputs'
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

export interface PreserveImageEntry {
  blockId: string
  assetId: string
  rect: LayoutRect
  layer: number
}

export interface PreserveDesignInput {
  size: { width: number; height: number }
  /** 스타일 레퍼런스. 없으면 색과 결을 스스로 정하게 둔다. */
  styleReferenceAssetId?: string | undefined
  texts: readonly PreserveTextEntry[]
  /** 컷아웃이 아닌 이미지 — 원본을 보내 모델이 구성에 쓰게 한다. */
  images: readonly PreserveImageEntry[]
  /** 컷아웃 — **자리만** 보낸다. 자산 번호는 여기 있지만 나가지 않는다. */
  cutouts: readonly PreserveImageEntry[]
  /** 작업자가 추가로 적은 말. */
  note?: string
}

/**
 * 요청에 실을 수 있는 자산 번호.
 *
 * 스타일 레퍼런스와 **컷아웃이 아닌** 이미지뿐이다. `cutouts`는 인자로 받되
 * 결과에 넣지 않는다 — 받아 두는 이유는, 받지 않으면 부르는 쪽이 두 목록을
 * 스스로 합치게 되고 그 자리에서 언젠가 컷아웃이 섞이기 때문이다.
 */
export function preserveAttachmentIds(input: {
  styleReferenceAssetId?: string | undefined
  images: readonly { assetId: string }[]
  cutouts: readonly { assetId: string }[]
}): string[] {
  const ids = input.styleReferenceAssetId === undefined ? [] : [input.styleReferenceAssetId]
  for (const image of input.images) ids.push(image.assetId)
  return [...new Set(ids)]
}

/**
 * 보낼 입력 이미지의 순서와 역할.
 *
 * 프롬프트가 "입력 이미지 2는 …"라고 말하므로 순서가 매번 같아야 한다.
 * 스타일 레퍼런스가 언제나 첫 번째다 — 없으면 일반 이미지가 1번부터 시작한다.
 */
export function planPreserveInputs(input: PreserveDesignInput): GenerationInputImage[] {
  const inputs: GenerationInputImage[] = []
  if (input.styleReferenceAssetId !== undefined) {
    inputs.push({
      index: 1,
      role: 'page_reference',
      assetId: input.styleReferenceAssetId,
      fileName: 'style-reference.png',
      label: '디자인 스타일 레퍼런스 — 색감·질감·타이포그래피·그래픽 언어 참고용입니다.',
    })
  }
  for (const image of input.images) {
    if (inputs.length >= MAX_INPUT_IMAGES) break
    inputs.push({
      index: inputs.length + 1,
      role: 'product_image',
      assetId: image.assetId,
      blockId: image.blockId,
      fileName: `image-${image.blockId}.png`,
      label: '실제 사용 이미지 — 구성에 그대로 활용해 주세요.',
    })
  }
  return inputs
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
 * 완성 디자인 주문 한 편.
 *
 * 세 가지를 강하게 못 박는다 — 문구를 바꾸지 말 것, 레퍼런스를 복제하지 말 것,
 * 컷아웃 자리에 사람·제품·로고를 새로 만들지 말 것. 앞의 둘은 결과가 못 쓰게
 * 되는 이유이고, 마지막은 같은 것이 두 번 나오는 이유다.
 */
export function buildPreserveDesignPrompt(
  input: PreserveDesignInput,
  inputs: readonly GenerationInputImage[] = planPreserveInputs(input),
): string {
  const { size, texts, cutouts, note } = input
  const lines: string[] = []

  lines.push(
    '이벤트 페이지에 그대로 쓸 **완성 디자인 이미지** 한 장을 만들어 주세요.',
    '단순한 배경이 아닙니다. 배경과 장식과 문구 디자인까지 끝난 한 장입니다.',
    `크기는 가로 ${size.width}, 세로 ${size.height} 비율입니다.`,
  )

  if (inputs.length > 0) {
    lines.push('', '## 함께 보낸 이미지')
    for (const image of inputs) lines.push(`- 입력 이미지 ${image.index}: ${image.label}`)
  }

  lines.push(
    '',
    '## 만들어야 하는 것',
    '- 스타일 레퍼런스와 비슷한 색감·질감, 그리고 콜라주와 매거진 편집의 그래픽 언어',
    '- 별, 꽃, 종이 질감, 프레임, 스티커, 낙서처럼 그 스타일에 어울리는 장식',
    '- 아래 문구를 자유롭게 디자인한 타이포그래피 — 폰트, 자간, 크기, 외곽선, 그림자, 이미지와의 겹침을 마음껏 쓰셔도 됩니다',
    '- 아래 "비워 둘 자리"를 고려한 전체 구성',
  )

  if (texts.length > 0) {
    lines.push('', '## 넣을 문구 (원문 그대로)')
    for (const text of texts) {
      lines.push(
        `- "${text.content}"`,
        `  자리: ${region(text.rect, size)} · 정렬 ${ALIGN_WORD[text.align]} · 앞뒤 순서 ${text.layer}`,
      )
    }
    lines.push(
      '문구의 **문자·숫자·띄어쓰기·기호·줄바꿈을 절대 바꾸지 않습니다.** 맞춤법을 고치거나 줄여 쓰거나 번역하지 말아 주세요.',
    )
  }

  if (cutouts.length > 0) {
    lines.push('', '## 비워 둘 자리 (나중에 실물 사진이 놓입니다)')
    for (const cut of cutouts) {
      lines.push(`- ${region(cut.rect, size)} · 앞뒤 순서 ${cut.layer}`)
    }
    lines.push(
      '이 자리에 **새 인물·제품·로고를 만들지 않습니다.** 나중에 원본 오브젝트가 그대로 합성될 자리입니다.',
      '그 주변의 배경과 장식은 이 오브젝트가 놓였을 때 어울리도록 구성해 주세요.',
    )
  }

  lines.push(
    '',
    '## 스타일 레퍼런스에 대하여',
    '색감·질감·타이포그래피·그래픽 언어를 참고하기 위한 자료입니다. 같은 이미지를 복제하지 않습니다.',
  )

  const trimmed = (note ?? '').trim()
  if (trimmed.length > 0) lines.push('', '## 작업자의 추가 지시', trimmed)

  lines.push(
    '',
    '## 넣지 말 것',
    '- 워터마크',
    '- 비워 둘 자리 안의 사람·제품·로고',
    '- 지시에 없는 문구',
  )

  return lines.join('\n')
}
