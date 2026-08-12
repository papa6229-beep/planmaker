/**
 * 기획서에서 온 말 (전달 누락 Patch).
 *
 * 기획서를 쓰는 사람은 왼쪽에 두 칸을 채운다 — `원하는 분위기·컨셉`과 `디자인팀에게
 * 전달할 말`. 그런데 작업판에서는 **뒤의 것만** 보였고 앞의 것은 어디에도 없었다.
 * 컨셉은 생성 요청에는 실려 갔으므로 AI는 읽는데 **사람은 못 읽는** 상태였다.
 * 작업자가 그 자리에서 말했다: "기획서 생성하는 팀의 메시지를 우리는 받아볼 수 없어."
 *
 * 그래서 둘을 한 칸에 모아 **팔레트 위**에 세운다. 받은 말을 읽는 것은 작업의
 * 첫 걸음이고, 첫 걸음이 스크롤 아래에 있으면 없는 것과 같다.
 *
 * **읽기만 한다.** 기획서 원문이므로 여기서 고치지 않는다 — 작업판에서 편집하는
 * 지시 입력창은 `AI에게 추가로 전달할 말` 하나뿐이라는 규칙은 그대로다.
 *
 * 온 말이 하나도 없으면 칸 자체가 없다. "없습니다"라는 한 줄도 왼쪽에서는 자리를
 * 차지하고, 작업자가 읽어야 할 것은 있을 때만 있으면 된다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import { PanelFold } from './PanelFold'

export function BriefHandoff() {
  const { concept, designerNote } = useBriefDocument()
  const mood = concept.trim()
  const note = designerNote.trim()
  if (mood.length === 0 && note.length === 0) return null

  // 접힌 줄에도 무엇이 왔는지 적는다 — 접어 둔 채로도 온 것이 있다는 사실은 보여야 한다.
  const came = [mood.length > 0 ? '컨셉' : null, note.length > 0 ? '전달사항' : null]
    .filter((x): x is string => x !== null)
    .join(' · ')

  return (
    <PanelFold id="brief-handoff" title="기획서에서 온 말" note={came} marked defaultOpen>
      {mood.length > 0 && (
        <section className="concept concept--readonly" aria-label="원하는 분위기·컨셉">
          <h2 className="concept__title">원하는 분위기·컨셉</h2>
          <p className="concept__quote">{mood}</p>
        </section>
      )}
      {note.length > 0 && (
        <section className="concept concept--readonly" aria-label="기획서 전달사항">
          <h2 className="concept__title">기획서 전달사항</h2>
          <p className="concept__quote">{note}</p>
        </section>
      )}
    </PanelFold>
  )
}
