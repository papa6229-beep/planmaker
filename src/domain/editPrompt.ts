/**
 * 부분수정 요청문 (부분수정 1단계 §3.2).
 *
 * 이 요청은 **통이미지의 제한된 수정**이다. 레이어를 고치는 것이 아니라, 완성된
 * 한 장을 다시 주면서 "이 부분만 이렇게 바꿔 달라"고 말하는 것이다. 그래서 두
 * 가지를 매번 다시 실어 보낸다: 지금 이미지, 그리고 그 이미지를 만들 때의 기획서
 * 정보. 모델이 지난 호출을 기억한다고 가정하지 않는다.
 *
 * 사용자가 쓴 말과 시스템이 지켜야 할 규칙을 한 문자열로 미리 섞지 않는다. 섞으면
 * 무엇이 사용자 뜻이고 무엇이 우리 규칙인지 검사할 수 없고, 사용자의 한 문장이
 * 규칙을 지워 버릴 수도 있다. 여기 한 곳에서 조립한다.
 */

import { BACKGROUND_TARGET_ID, type EditTarget } from './editTargets'

/** 어떤 수정 요청에도 빠지지 않는 규칙 (§3.2). */
export const EDIT_RULES: readonly string[] = [
  '이것은 이미 완성된 이벤트 페이지 이미지의 제한된 수정입니다. 처음부터 다시 만들지 마세요.',
  '아래에서 선택된 대상만 바꿉니다. 선택되지 않은 문구·제품·로고·배경은 가능한 한 시각적으로 그대로 두세요.',
  '사용자가 문구 내용을 바꾸라고 명시하지 않았다면, 모든 문구는 한 글자도 바꾸지 않습니다.',
  '새로운 문구·제품·로고를 추가하지 마세요.',
  '실제 제품과 로고의 형태·상표·색상을 임의로 바꾸지 마세요.',
  '페이지 전체 비율과 구성은 그대로 유지하세요.',
  '선택한 대상 밖을 다시 디자인하지 마세요.',
  '결과는 이미지 한 장으로 돌려주세요.',
]

export interface EditPromptContext {
  /** 지금 화면에 있는 결과 이미지의 크기. */
  currentImage: { width: number; height: number }
  /** 기획서 페이지 크기. */
  page: { width: number; height: number }
  /** 입력 이미지가 몇 번째에 무엇인지 — 실제로 보내는 순서와 같아야 한다. */
  inputs: readonly { index: number; what: string }[]
}

function boxText(t: EditTarget): string {
  if (!t.box) return ''
  return `x ${Math.round(t.box.x)}, y ${Math.round(t.box.y)}, 가로 ${Math.round(t.box.width)}, 세로 ${Math.round(t.box.height)}`
}

/**
 * 요청문 한 장.
 *
 * `all`은 생성 당시 얼려 둔 목록 전체다. 고르지 않은 것까지 함께 적는 이유는,
 * 모델이 "무엇을 건드리면 안 되는지" 알아야 건드리지 않기 때문이다.
 */
export interface EditItem {
  target: EditTarget
  /** 이 대상 **하나에만** 적용할 지시. 다른 대상의 지시와 섞이지 않는다. */
  instruction: string
}

export function buildEditPrompt(
  all: readonly EditTarget[],
  items: readonly EditItem[],
  context: EditPromptContext,
): string {
  const lines: string[] = []

  lines.push('당신은 이커머스 상세페이지 이미지를 다듬는 디자이너입니다.')
  lines.push('')
  lines.push('## 반드시 지킬 것')
  for (const rule of EDIT_RULES) lines.push(`- ${rule}`)
  lines.push('')

  lines.push('## 함께 보내는 입력 이미지')
  for (const input of context.inputs) lines.push(`- 입력 이미지 ${String(input.index)}: ${input.what}`)
  lines.push('')

  lines.push('## 지금 이미지')
  lines.push(
    `현재 이미지는 가로 ${String(context.currentImage.width)}, 세로 ${String(context.currentImage.height)} 입니다. ` +
      `아래 좌표는 기획서 페이지(가로 ${String(context.page.width)}, 세로 ${String(context.page.height)}) 기준입니다.`,
  )
  lines.push('')

  lines.push('## 이번 수정의 절대 범위')
  lines.push('아래에 나열된 대상만 수정합니다.')
  lines.push('선택되지 않은 문구·로고·제품·배경은 그대로 유지합니다.')
  lines.push('비슷한 글꼴이나 색상을 가진 다른 요소까지 일괄 변경하지 않습니다.')
  lines.push('')

  if (items.length === 0) lines.push('### (선택된 대상 없음)')
  items.forEach((item, index) => {
    const t = item.target
    lines.push(`### 대상 ${String(index + 1)}`)
    lines.push(`대상: ${t.label}`)

    if (t.targetId === BACKGROUND_TARGET_ID) {
      lines.push('종류: 페이지 전체 배경')
      lines.push('이 대상에만 적용할 지시:')
      lines.push(item.instruction)
      lines.push('')
      lines.push('대상 범위 제한:')
      lines.push('배경만 다룹니다. 문구·제품·로고는 위치도 모양도 그대로 둡니다.')
      lines.push('')
      return
    }

    const kind = t.kind === 'image' ? '이미지 자리' : '문구'
    lines.push(`종류: ${kind}`)
    if (t.content !== undefined) lines.push(`원문: ${t.content}`)
    if (t.box) lines.push(`원래 위치와 크기: ${boxText(t)}`)
    if (t.productAssetId !== undefined) {
      lines.push('이 자리의 실제 제품·로고 원본을 함께 보냅니다.')
    }
    lines.push('이 대상에만 적용할 지시:')
    lines.push(item.instruction)
    lines.push('')
    lines.push('대상 범위 제한:')
    lines.push(`위 좌표의 이 ${kind} 한 개에만 적용합니다.`)
    lines.push(
      t.kind === 'image'
        ? '비슷한 제품·로고가 다른 자리에 있어도 함께 바꾸지 않습니다. 원본의 형태·상표·색상은 유지합니다.'
        : '비슷한 숫자·글꼴·색상의 다른 문구는 변경하지 않습니다. 비슷하게 보이는 다른 문구의 글꼴도 그대로 둡니다.',
    )
    if (t.content !== undefined) {
      lines.push('사용자가 내용 변경을 명시하지 않았다면 이 문구의 글자는 한 글자도 바꾸지 않습니다.')
    }
    lines.push('')
  })

  lines.push('## 그대로 두어야 할 것')
  const chosenIds = new Set(items.map((i) => i.target.targetId))
  const untouched = all.filter((t) => !chosenIds.has(t.targetId))
  if (untouched.length === 0) lines.push('- (없음)')
  for (const t of untouched) {
    if (t.targetId === BACKGROUND_TARGET_ID) {
      lines.push('- 전체 배경')
      continue
    }
    const quoted = t.content === undefined ? '' : ` "${t.content}"`
    lines.push(`- ${t.label}${quoted}`)
  }
  lines.push('')
  lines.push('위 항목에는 새 문구·로고·제품·장식을 더하지 않고, 기존 상태를 유지합니다.')

  return lines.join('\n')
}
