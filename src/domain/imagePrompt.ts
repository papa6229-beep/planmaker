/**
 * `GenerationRequest` → 모델에게 보낼 텍스트 프롬프트 (1단계 §7).
 *
 * 서버 함수 안에서 문자열을 이어 붙이지 않고 여기 순수 함수로 둔다. 그래야
 * "무엇을 보냈는가"를 네트워크 없이 그대로 읽고 검사할 수 있다.
 *
 * 두 가지를 특히 조심한다.
 *
 *  - **원문 보존.** 기획서의 문구는 한 글자도 바꾸지 않고 옮긴다. 요약하거나
 *    맞춤법을 고치면 그 순간 기획서가 아니게 된다.
 *  - **주소 배제.** 연결 주소는 이미지에 인쇄될 것이 아니다. `GenerationRequest`
 *    는 이미 `design`에서 주소를 빼 두지만, 사람이 컨셉이나 메모에 주소를 적어
 *    넣을 수는 있다. 그래서 프롬프트로 나가는 모든 자유 문장에서 주소 모양을
 *    한 번 더 걷어낸다 — 조용히 지우지 않고, 지웠다는 사실을 함께 적는다.
 *
 * 이 함수가 무엇을 보장하지 못하는지도 분명히 해 둔다. 프롬프트는 요구일 뿐,
 * 모델이 한글을 정확히 쓰거나 좌표를 그대로 지킨다는 보장이 아니다. 그 정도는
 * 실제 결과를 보고 판단해야 한다.
 */

import type { GenerationRequest, GenerationBox } from './generationRequest'
import type { GenerationInputImage } from './imageGenerationInputs'

const URL_PATTERN = /(https?:\/\/\S+|www\.\S+)/gi

const EMPHASIS_TEXT: Record<string, string> = {
  very_high: '아주 크게 강조',
  high: '크게 강조',
  normal: '보통',
  low: '작게',
}
const ALIGN_TEXT: Record<string, string> = { left: '왼쪽', center: '가운데', right: '오른쪽' }

/** 주소 모양을 걷어낸다. 지운 것이 있으면 그 사실을 알린다. */
function withoutUrls(text: string): { text: string; removed: boolean } {
  if (!URL_PATTERN.test(text)) {
    URL_PATTERN.lastIndex = 0
    return { text, removed: false }
  }
  URL_PATTERN.lastIndex = 0
  return { text: text.replace(URL_PATTERN, '[주소 제외됨]').trim(), removed: true }
}

function boxText(box: GenerationBox): string {
  return `x ${Math.round(box.x)}, y ${Math.round(box.y)}, 가로 ${Math.round(box.width)}, 세로 ${Math.round(box.height)}`
}

/**
 * 프롬프트 한 장. `inputs`는 실제로 보낼 이미지의 순서와 같아야 한다 — 이
 * 문장들이 그 순서를 가리키기 때문이다.
 */
export function buildOpenAIImagePrompt(
  request: GenerationRequest,
  inputs: readonly GenerationInputImage[],
): string {
  const d = request.design
  const lines: string[] = []
  let removedSomething = false

  const clean = (text: string): string => {
    const r = withoutUrls(text)
    if (r.removed) removedSomething = true
    return r.text
  }

  lines.push('당신은 이커머스 상세페이지 이미지를 만드는 디자이너입니다.')
  lines.push(
    '함께 보내는 기획서는 최종 디자인이 아니라, 무엇을 어디에 놓아야 하는지 적은 작업 지시서입니다. ' +
      '배치와 요구사항을 읽고, 실제로 쓸 수 있는 완성 이미지 한 장을 만들어 주세요.',
  )
  lines.push('')

  // 1. 입력 이미지가 각각 무엇인지 — 보낼 순서 그대로.
  lines.push('## 함께 보내는 입력 이미지')
  for (const input of inputs) {
    lines.push(`- 입력 이미지 ${input.index}: ${input.label}`)
  }
  lines.push('')

  // 2. 결과물의 크기.
  lines.push('## 결과물')
  lines.push(
    `기획서 페이지 크기는 가로 ${d.document.canvas.width}, 세로 ${d.document.canvas.height} 입니다. ` +
      '아래 좌표는 모두 이 크기를 기준으로 한 값이며, 결과 이미지에서도 같은 상대 위치를 지켜 주세요.',
  )
  lines.push(`페이지: ${clean(d.document.pageTitle)} (${d.document.pageCount}장 중)`)
  lines.push('')

  // 3. 문구 — 원문 그대로.
  lines.push('## 이미지에 넣을 문구 (원문 그대로)')
  if (d.texts.length === 0) {
    lines.push('- (문구 없음)')
  } else {
    for (const t of d.texts) {
      const emphasis = EMPHASIS_TEXT[t.emphasis] ?? '보통'
      const align = ALIGN_TEXT[t.align] ?? '왼쪽'
      lines.push(`- [${t.blockId}] "${clean(t.content)}"`)
      lines.push(`  · 강조: ${emphasis} · 정렬: ${align} · 위치: ${boxText(t.box)}`)
    }
  }
  lines.push(
    '위 문구는 한 글자도 바꾸지 말고 원문 그대로 사용하세요. ' +
      '날짜·가격·숫자·상품명·띄어쓰기·영문 대소문자도 임의로 바꾸지 마세요.',
  )
  lines.push('')

  // 4. 이미지 자리와 거기에 붙는 실제 제품.
  lines.push('## 이미지 자리')
  if (d.imageSlots.length === 0) {
    lines.push('- (이미지 자리 없음)')
  } else {
    for (const slot of d.imageSlots) {
      lines.push(`- [${slot.blockId}] 위치: ${boxText(slot.box)}`)
      if (slot.description !== undefined) lines.push(`  · 작성자 설명: "${clean(slot.description)}"`)
      const product = inputs.find((i) => i.role === 'product_image' && i.blockId === slot.blockId)
      if (product) {
        lines.push(`  · 실제 사용 제품 이미지: 입력 이미지 ${product.index}`)
        lines.push('  · 이 제품의 형태·색상·상표·로고를 임의로 바꾸지 말고, 이 자리에 배치하세요.')
      }
      const ref = inputs.find((i) => i.role === 'slot_reference' && i.blockId === slot.blockId)
      if (ref) {
        lines.push(`  · 참고 캡처: 입력 이미지 ${ref.index} (분위기·구성 참고용, 그대로 복사하지 마세요)`)
      }
      if (product === undefined) {
        lines.push('  · 실제 사용 제품 이미지가 연결되지 않은 자리입니다.')
      }
    }
  }
  lines.push('')

  // 5. 버튼 — 보이는 문구만.
  lines.push('## 버튼')
  if (d.buttons.length === 0) {
    lines.push('- (버튼 없음)')
  } else {
    for (const b of d.buttons) {
      lines.push(`- [${b.blockId}] "${clean(b.text)}" · 위치: ${boxText(b.box)}`)
    }
    lines.push('버튼은 보이는 문구만 이미지에 넣으세요. 연결 주소는 이미지에 인쇄하지 않습니다.')
  }
  lines.push('')

  // 6. 방향 — 인쇄하지 않는 말.
  const concept = d.document.concept
  if (concept !== undefined && concept.length > 0) {
    lines.push('## 전체 컨셉')
    lines.push(clean(concept))
    lines.push('')
  }
  if (d.instructions.length > 0) {
    lines.push('## 전달 메모')
    for (const ins of d.instructions) {
      lines.push(`- ${clean(ins.label)}: ${clean(ins.content)}`)
    }
    lines.push('위 메모는 방향 설명입니다. 이 문장 자체를 이미지에 인쇄하지 마세요.')
    lines.push('')
  }
  if (d.reference.assetId !== undefined) {
    lines.push('## 페이지 참고 이미지')
    lines.push(clean(d.reference.note))
    lines.push('')
  }

  // 7. 지켜야 할 것.
  lines.push('## 반드시 지킬 것')
  for (const c of d.constraints) lines.push(`- ${c}`)
  lines.push('- 결과물 밖에 설명문·워터마크·서명·여백 안내를 덧붙이지 마세요.')
  lines.push('- 기획서에 없는 가격·할인율·상품 문구를 지어내지 마세요.')
  if (removedSomething) {
    lines.push('- 원문에 있던 연결 주소는 이미지 제작 입력에서 제외했습니다. 주소를 지어내 넣지 마세요.')
  }

  return lines.join('\n')
}
