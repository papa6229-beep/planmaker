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
import { areaShare, importanceRanks, type StickerBlock, type StickerCell } from './stickerSheet'
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

/**
 * 문구·버튼 스티커판 주문의 재료 (스티커판 Patch §4).
 *
 * `cells`가 이 주문의 계약이다. 칸 하나에 블록 하나이고, 돌아온 그림은 그
 * 좌표로만 잘린다 — 픽셀을 보고 나누는 자리가 없다.
 */
export interface StickerSheetInput {
  size: { width: number; height: number }
  styleReferenceAssetId?: string | undefined
  /** 1단계에서 **실제로 생성된** 배경. 사용자 이미지가 아니다. */
  backgroundAssetId?: string | undefined
  blocks: readonly StickerBlock[]
  cells: readonly StickerCell[]
  /** 사진이 이미 놓인 자리 — 좌표뿐이다. */
  fixed: readonly FixedObject[]
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

/**
 * 스티커판 요청에 붙는 그림 — 스타일 레퍼런스와 **AI가 만든 배경**뿐이다.
 *
 * 배경은 1단계에서 이 도구가 받아 온 그림이라 사용자의 사진이 아니다. 고정
 * 이미지가 얹힌 합성 페이지는 여기 낄 자리가 없다 — 인자에 아예 없다.
 */
export function planStickerInputs(input: {
  styleReferenceAssetId?: string | undefined
  backgroundAssetId?: string | undefined
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

/** 판 전체에 대한 비율 사각형을 사람이 읽는 말로. */
function unitRegion(rect: LayoutRect): string {
  return [
    `가로 ${percent(rect.x)} 지점부터 ${percent(rect.width)}`,
    `세로 ${percent(rect.y)} 지점부터 ${percent(rect.height)}`,
  ].join(', ')
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
 * 2) 문구·버튼 스티커판 주문 (스티커판 Patch §4).
 *
 * 단색 마젠타 위에 **칸을 나눠** 글자만 그린 한 장이다. 투명 배경은 이 모델이
 * 만들어 주지 않으므로(공급자 답: `Transparent background is not supported for
 * this model.`), 브라우저가 그 단색을 걷어 낸다 (`chromaKey.ts`).
 *
 * 앞선 판과 다른 것은 하나다. 문구를 **지면 배치대로** 그리게 한 뒤 픽셀을 보고
 * 나누는 것이 아니라, 칸을 미리 정해 주고 **그 칸 좌표로만** 자른다. 그래서 어느
 * 조각이 어느 블록의 것인지 추측할 일이 없다.
 *
 * 자리·크기·중요도·겹침·주변 색은 여전히 전부 전달한다 — 다만 그것은 "이 칸 안에
 * 어떤 디자인을 그릴지"의 근거이지, 판 위의 배치 지시가 아니다.
 */
export function buildStickerPrompt(input: StickerSheetInput): string {
  const { size, blocks, cells, fixed, backgroundAssetId, note } = input
  const ranks = importanceRanks(blocks, size)
  const byId = new Map(cells.map((cell) => [cell.blockId, cell]))
  const lines: string[] = []

  lines.push(
    '이벤트 페이지에 쓸 **문구·버튼 스티커판** 한 장을 만들어 주세요.',
    '완성 디자인이 아닙니다. 칸으로 나뉜 판이고, 각 칸을 잘라 내 실제 페이지의 제자리에 붙입니다.',
    `배경은 **단색 마젠타(${TEXT_KEY_HEX})** 한 가지로 화면 전체를 빈틈없이 채우고, 그 위에 문구·버튼 디자인만 올려 주세요.`,
    '마젠타는 나중에 지워집니다. 남은 글자만 이미 만들어진 배경과 사진 위에 그대로 얹힙니다.',
    `크기는 가로 ${size.width}, 세로 ${size.height} 비율입니다.`,
  )

  lines.push(
    '',
    '## 칸 나누기 — 이 주문에서 가장 중요한 규칙',
    `판을 아래 ${cells.length}개의 칸으로 나눠 주세요. **칸 하나에는 지정된 블록 하나만** 디자인합니다.`,
    '- 한 칸에 두 문구를 함께 넣지 않습니다.',
    '- 한 문구를 두 칸에 나눠 넣지 않습니다.',
    '- 글자·외곽선·그림자·라벨·배지·버튼 배경판이 **지정된 사각형 밖으로 한 획도 넘어가지 않게** 해 주세요.',
    '- 칸과 칸 사이의 여백은 비워 둡니다. 거기에 무엇이 묻으면 그 칸은 쓸 수 없습니다.',
    '- 칸 안에서는 여백을 넉넉히 쓰지 말고, 지정된 사각형을 **가득 채우도록** 크게 디자인해 주세요.',
  )

  lines.push('', '## 칸별 주문')
  for (const block of blocks) {
    const cell = byId.get(block.blockId)
    if (cell === undefined) continue
    const rank = ranks.get(block.blockId) ?? 0
    lines.push(
      `### cell ${String(cell.index)}`,
      `- 그릴 것: ${block.kind === 'button' ? '버튼' : '문구'} — "${block.content}"`,
      `- 그릴 자리(판 전체 기준): ${unitRegion(cell.crop)}`,
      `- 실제 페이지에서의 자리: ${region(block.rect, size)} · 정렬 ${ALIGN_WORD[block.align]}`,
      `- 지면에서 차지하는 넓이: ${percent(areaShare(block.rect, size))} · 중요도 ${String(rank)}위 / ${String(blocks.length)}개`,
      `- 사진·컷아웃과 겹치는가: ${block.overlapsImage ? '겹칩니다 — 사진 위에서도 또렷하게 읽히도록 대비·외곽선·그림자를 충분히 쓰세요.' : '겹치지 않습니다.'}`,
    )
    if (block.tone != null) {
      const tone = block.tone
      lines.push(
        `- 그 자리 주변의 색: 평균색 R${String(Math.round(tone.average.r))} G${String(Math.round(tone.average.g))} B${String(Math.round(tone.average.b))}, 밝기 ${tone.brightness.toFixed(2)} (0=어두움, 1=밝음), 대비 ${tone.contrast.toFixed(2)}`,
      )
    }
  }

  lines.push(
    '',
    '## 문구는 원문 그대로입니다',
    '문구의 **문자·숫자·띄어쓰기·기호·줄바꿈을 절대 바꾸지 않습니다.** 맞춤법을 고치거나 줄여 쓰거나 번역하지 말아 주세요.',
    '지시에 없는 문구를 새로 만들지 않습니다.',
  )

  lines.push(
    '',
    '## 크기와 중요도',
    '- 큰 상자는 주요 문구로, 작은 상자는 보조 문구로 다뤄 주세요.',
    '- 중요도가 앞선 문구일수록 굵고 강한 활자로, 뒤일수록 차분하게 풀어 주세요.',
    '- 칸 안에서 글자 크기·행간·정렬·효과는 디자인을 위해 조절해도 좋습니다.',
    '- 스타일 레퍼런스의 글꼴 분위기와 디자인 표현을 참고해 주세요.',
  )

  lines.push(
    '',
    '## 버튼을 그릴 때',
    '- 버튼은 **배경판·테두리·글자를 한 덩어리로** 그 칸 안에 함께 그려 주세요.',
    '- 버튼 배경판도 지정된 사각형 밖으로 넘기지 않습니다.',
  )

  if (fixed.length > 0) {
    lines.push('', '## 실제 페이지에서 사진이 이미 놓여 있는 자리')
    for (const item of fixed) lines.push(`- ${region(item.rect, size)}`)
    lines.push(
      '문구가 그 위에 겹치는 것은 그대로 둡니다. 겹침을 피해 옮기지 않습니다.',
      '다만 이 자리에 **사람·제품·로고를 새로 그리지 않습니다.**',
    )
  }

  lines.push(
    '',
    '## 함께 보낸 이미지에 대하여',
    '- 디자인 스타일 레퍼런스: 타이포그래피 위계와 글자 효과를 참고하기 위한 자료입니다. 같은 이미지를 복제하지 않습니다.',
  )
  if (backgroundAssetId !== undefined) {
    lines.push(
      '- 1단계에서 생성된 배경: 이 글자들이 실제로 놓일 바탕입니다. 그 위에서 읽히도록 색과 대비를 정해 주세요. **배경을 다시 그리지 않습니다.**',
    )
  }

  const trimmed = (note ?? '').trim()
  if (trimmed.length > 0) lines.push('', '## 작업자의 추가 지시', trimmed)

  lines.push(
    '',
    '## 넣지 말 것',
    `- 배경 사진·그러데이션·무늬 (배경은 단색 마젠타 ${TEXT_KEY_HEX} 한 가지입니다)`,
    '- 별·꽃·테이프·하프톤처럼 문구에 속하지 않는 배경 장식',
    '- 칸 구분선, 칸 번호, 안내 글자',
    '- 글자·외곽선·그림자·라벨·배지에 마젠타나 그와 비슷한 분홍·자주 계열 색',
    '- 사람, 제품, 로고',
    '- 워터마크',
  )

  return lines.join('\n')
}

/**
 * 3) 문구 하나만 다시 디자인하는 주문 (텍스트 오브젝트 Patch §3).
 *
 * 배경도, 사진도, 옆 문구도 손대지 않는다. 이 요청이 만드는 것은 **그 문구 한
 * 장**뿐이고, 브라우저가 임시 단색을 걷어 내 같은 자리에 갈아 끼운다.
 */
export function buildTextEditPrompt(input: {
  size: { width: number; height: number }
  content: string
  instruction: string
  rect: LayoutRect
  tone?: PlateTone | null
}): string {
  const { size, content, instruction, rect, tone } = input
  const lines: string[] = [
    '문구 **한 개**만 새로 디자인해 주세요.',
    `배경은 **단색 마젠타(${TEXT_KEY_HEX})** 한 가지로 화면 전체를 빈틈없이 채우고, 그 위에 이 문구 하나만 올립니다.`,
    '마젠타는 나중에 지워집니다. 남은 글자만 원래 자리에 그대로 갈아 끼워집니다.',
    `크기는 가로 ${size.width}, 세로 ${size.height} 비율입니다.`,
    '',
    '## 문구 (원문 그대로)',
    `- "${content}"`,
    `  자리: ${region(rect, size)}`,
    '문구의 **문자·숫자·띄어쓰기·기호·줄바꿈을 절대 바꾸지 않습니다.**',
    '',
    '## 작업자의 수정 지시',
    instruction.trim(),
    '',
    '## 함께 보낸 이미지',
    '- 입력 이미지 1: 지금의 문구 디자인 — 이것을 고칩니다.',
  ]
  if (tone != null) {
    lines.push(
      '',
      '## 아래에 깔릴 배경의 색',
      `평균색 R${Math.round(tone.average.r)} G${Math.round(tone.average.g)} B${Math.round(tone.average.b)}, 밝기 ${tone.brightness.toFixed(2)}`,
      '이 배경 위에서 글씨가 또렷하게 읽히도록 색과 대비를 정해 주세요.',
    )
  }
  lines.push(
    '',
    '## 넣지 말 것',
    '- 다른 문구, 사람, 제품, 로고',
    `- 배경 사진·그러데이션·무늬 (배경은 단색 마젠타 ${TEXT_KEY_HEX} 한 가지입니다)`,
    '- 글자·외곽선·그림자·라벨에 마젠타나 그와 비슷한 분홍·자주 계열 색',
    '- 워터마크',
  )
  return lines.join('\n')
}
