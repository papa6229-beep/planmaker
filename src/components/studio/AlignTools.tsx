/**
 * 줄 맞춤 (정렬 Patch).
 *
 * 지금까지 상자의 자리를 맞추는 길은 눈대중 하나뿐이었다 — 끌어다 대충 두고,
 * 한 칸 어긋난 것을 나중에 발견한다.
 *
 * 이 칸은 **무엇을 골랐든** 나온다. 이미지 맞춤이나 디자인 주문과 달리 줄 맞춤은
 * 상자의 종류를 가리지 않기 때문이다. 대신 기준이 무엇인지는 화면이 직접 말한다 —
 * 정렬에서 헷갈리는 것은 언제나 기준이고, 기준을 모르면 눌러 보고서야 무슨 일이
 * 났는지 알게 된다.
 *
 * 셋 이상이어야 뜻이 있는 버튼(고르게)은 그 전까지 흐리게 둔다. 눌러도 아무 일이
 * 없는 것보다 미리 말하는 편이 낫다.
 */

import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { ALIGN_MOVES } from '../../domain/alignBlocks'
import { PanelFold } from './PanelFold'

export function AlignTools() {
  const { state, alignSelected } = useBriefEditor()
  const picked = state.selectedIds.length
  if (picked === 0) return null

  const basis = picked === 1 ? '캔버스' : '마지막에 고른 것'

  return (
    <PanelFold
      id="align-tools"
      title="줄 맞춤"
      note={`기준: ${basis}`}
      defaultOpen
    >
      <section className="align-tools" aria-label="줄 맞춤">
        <p className="align-tools__basis">
          {picked === 1 ? (
            <>하나만 골랐으므로 <b>캔버스</b>를 기준으로 맞춥니다.</>
          ) : (
            <><b>마지막에 고른 상자</b>에 나머지 {picked - 1}개를 맞춥니다.</>
          )}
        </p>
        <div className="align-tools__row" role="group" aria-label="줄 맞춤">
          {ALIGN_MOVES.map((move) => (
            <button
              key={move.value}
              type="button"
              className="align-tools__btn"
              disabled={picked < move.min}
              title={move.hint}
              aria-label={move.hint}
              onClick={() => alignSelected(move.value)}
            >
              {move.label}
            </button>
          ))}
        </div>
      </section>
    </PanelFold>
  )
}
