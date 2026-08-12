/**
 * 줄 맞춤 (정렬 Patch).
 *
 * 지금까지 상자의 자리를 맞추는 길은 눈대중 하나뿐이었다 — 끌어다 대충 두고,
 * 한 칸 어긋난 것을 나중에 발견한다.
 *
 * **두 화면에 다 선다.** 첫 판은 기획서 캔버스에만 뒀는데, 눈대중이 실제로
 * 일어나는 자리는 완성본이었다 — 만들고 나서 조각을 하나씩 끌어 맞추는 그
 * 화면이다. 기획서 쪽은 블록을, 완성본 쪽은 조각을 움직이지만 사람이 하는 일은
 * 같으므로 화면도 같은 것을 내놓는다.
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
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { ALIGN_MOVES, alignRects, type AlignMove } from '../../domain/alignBlocks'
import { PanelFold } from './PanelFold'
import type { LayoutRect } from '../../domain/imageLayout'

/** 두 화면이 함께 쓰는 겉모습. 무엇을 움직이는지는 부르는 쪽이 안다. */
function AlignPanel({ picked, onMove }: { picked: number; onMove: (move: AlignMove) => void }) {
  const basis = picked === 1 ? '캔버스' : '마지막에 고른 것'

  return (
    <PanelFold id="align-tools" title="줄 맞춤" note={`기준: ${basis}`} defaultOpen>
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
              onClick={() => onMove(move.value)}
            >
              {move.label}
            </button>
          ))}
        </div>
      </section>
    </PanelFold>
  )
}

/** 기획서 캔버스에서 — 고른 **블록**을 줄 맞춘다. */
export function AlignTools() {
  const { state, alignSelected } = useBriefEditor()
  const picked = state.selectedIds.length
  if (picked === 0) return null

  return <AlignPanel picked={picked} onMove={alignSelected} />
}

/**
 * 완성본에서 — 고른 **조각**을 줄 맞춘다.
 *
 * 끌어 옮기는 길과 같은 자리에 적는다: 되돌릴 칸을 하나 남기고(`markStep`),
 * 조각마다 자리를 적고, 마지막에 한 번 다시 합친다. 외부로 나가는 요청은 없다 —
 * 자리를 옮기는 일에 AI는 필요 없다.
 */
export function ResultAlignTools() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { pages, activePageId } = useBriefDocument()
  if (studio === null) return null

  const page = pages.find((p) => p.id === activePageId)
  const texts = studio.textObjectsOf(activePageId)
  const images = studio.imageObjectsOf(activePageId)
  // 고른 차례 그대로 — **마지막에 고른 것**이 기준이 되어야 하므로 순서가 뜻을 갖는다.
  const picked = studio.selectedObjectBlockIds
    .map((blockId) => {
      const image = images.find((o) => o.blockId === blockId)
      if (image !== undefined) return { kind: 'image' as const, blockId, rect: image.rect }
      const text = texts.find((o) => o.blockId === blockId)
      return text === undefined ? null : { kind: 'text' as const, blockId, rect: text.rect }
    })
    .filter((item): item is { kind: 'image' | 'text'; blockId: string; rect: LayoutRect } => item !== null)
  if (picked.length === 0) return null

  const run = (move: AlignMove) => {
    const placed = alignRects(picked.map((item) => item.rect), move, {
      width: page?.canvasWidth ?? 840,
      height: page?.canvasHeight ?? 1000,
    })
    // 한 번의 정렬이 되돌리기 한 칸이다. 조각을 몇 개 옮기든 표시는 여기서 한 번만.
    studio.markStep()
    picked.forEach((item, index) => {
      const rect = placed[index]
      if (rect === undefined) return
      if (item.kind === 'image') studio.moveImageObject(activePageId, item.blockId, rect)
      else studio.moveTextObject(activePageId, item.blockId, rect)
    })
    void generation?.recomposePage(activePageId)
  }

  return <AlignPanel picked={picked.length} onMove={run} />
}
