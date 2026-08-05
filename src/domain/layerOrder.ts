/**
 * 명시적 레이어 순서 (배경 합성 1차 §4).
 *
 * 블록 배열의 순서가 곧 그리는 순서다 — 뒤에 있을수록 앞에 그려진다. 별도의
 * `z` 값을 두지 않는 이유는 두 개의 진실이 생기기 때문이다: 배열은 저장·왕복·
 * 실행취소가 이미 정확히 옮기는데, 거기에 숫자를 하나 더 얹으면 둘이 어긋나는
 * 날이 반드시 온다.
 *
 * 옮기는 것은 **보이는 블록 사이에서만** 한다. 버튼과 짝지어진 URL 블록은
 * 캔버스에 그려지지 않으므로, 그것을 한 칸으로 세면 `한 단계 앞으로`가 아무 일도
 * 하지 않는 것처럼 보인다. 짝은 언제나 자기 짝 바로 뒤에 붙어 다니므로 파일에
 * 적히는 순서도 흐트러지지 않는다.
 *
 * 배경은 여기 끼지 않는다. 배경은 블록이 아니라 페이지의 레이어이고 언제나 맨
 * 뒤에 그려지므로, 순서로 다툴 일 자체가 없다 (§4 마지막 줄).
 */

import { isPairedLinkUrl } from './simpleBlocks'
import type { BriefBlock } from './briefSchema'

export type LayerMove = 'front' | 'forward' | 'backward' | 'back'

export const LAYER_MOVES: readonly { value: LayerMove; label: string }[] = [
  { value: 'front', label: '맨 앞으로' },
  { value: 'forward', label: '한 단계 앞으로' },
  { value: 'backward', label: '한 단계 뒤로' },
  { value: 'back', label: '맨 뒤로' },
]

function targetIndex(move: LayerMove, from: number, count: number): number {
  switch (move) {
    case 'front':
      return count - 1
    case 'back':
      return 0
    case 'forward':
      return Math.min(from + 1, count - 1)
    case 'backward':
      return Math.max(from - 1, 0)
  }
}

/**
 * 한 블록을 보이는 순서 안에서 옮긴 새 배열.
 *
 * 옮길 수 없으면(없는 블록, 이미 끝) 받은 배열을 **그대로** 돌려준다 — 같은
 * 참조를 유지해야 실행취소 이력에 아무 일도 없던 걸음이 쌓이지 않는다.
 */
export function reorderBlocks(
  blocks: readonly BriefBlock[],
  blockId: string,
  move: LayerMove,
): readonly BriefBlock[] {
  const visible = blocks.filter((b) => !isPairedLinkUrl(blocks, b))
  const from = visible.findIndex((b) => b.id === blockId)
  if (from < 0) return blocks

  const to = targetIndex(move, from, visible.length)
  if (to === from) return blocks

  const ordered = visible.slice()
  const [moved] = ordered.splice(from, 1)
  ordered.splice(to, 0, moved!)

  // 보이지 않는 짝은 자기 짝 바로 뒤에 다시 붙인다. 어느 짝에도 속하지 않은
  // 숨은 블록(예전 판의 독립 URL 블록)은 순서를 바꿀 이유가 없으므로 끝에.
  const hidden = blocks.filter((b) => isPairedLinkUrl(blocks, b))
  const used = new Set<string>()
  const result: BriefBlock[] = []
  for (const block of ordered) {
    result.push(block)
    if (block.groupId === undefined) continue
    for (const partner of hidden) {
      if (partner.groupId !== block.groupId || used.has(partner.id)) continue
      used.add(partner.id)
      result.push(partner)
    }
  }
  for (const partner of hidden) if (!used.has(partner.id)) result.push(partner)
  return result
}
