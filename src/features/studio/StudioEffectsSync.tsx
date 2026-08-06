/**
 * 블록에 매달린 작업판 설정을 문서의 편집과 맞춰 둔다 (Studio Patch §4).
 *
 * 합성 효과는 블록 id로 매달려 있지만 **문서 안에 있지 않다** — 기획서를 고치지
 * 않기 위해 일부러 그렇게 나눠 두었다. 그 대가로, 블록이 복제되거나 지워질 때
 * 아무도 그 설정을 대신 옮기거나 치워 주지 않는다. 이 컴포넌트가 그 자리다.
 *
 * 화면을 그리지 않는다. 편집기와 작업판을 동시에 볼 수 있는 곳에 서서, 두
 * 가지만 한다.
 *
 *  - **복제**: 새 블록에 원본의 설정을 한 번 복사한다. 한 번뿐인 것이 중요하다 —
 *    매번 맞추면 복사본에서 효과를 끈 순간 원본 값이 다시 덮어쓴다.
 *  - **삭제**: 문서 어디에도 없는 블록의 설정을 치운다.
 */

import { useEffect, useRef } from 'react'
import { useBriefEditor } from '../editor/useBriefEditor'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'

export function StudioEffectsSync() {
  const studio = useStudioJob()
  const { cloneOf } = useBriefEditor()
  const { document: doc } = useBriefDocument()
  /** 이미 옮긴 복제. 두 번 옮기지 않기 위한 기억이다. */
  const copied = useRef(new Set<string>())

  useEffect(() => {
    if (studio === null) return
    for (const [to, from] of Object.entries(cloneOf)) {
      if (copied.current.has(to)) continue
      copied.current.add(to)
      studio.copyEffects(from, to)
    }
  }, [studio, cloneOf])

  useEffect(() => {
    if (studio === null) return
    const live = new Set(doc.pages.flatMap((page) => page.blocks.map((b) => b.id)))
    // 문서가 아직 붙기 전(빈 기본 문서)에는 모든 설정이 고아처럼 보인다. 블록이
    // 하나도 없는 순간에는 손대지 않는다 — 다음 변화에서 제대로 치운다.
    if (live.size === 0) return
    studio.pruneEffects(live)
  }, [studio, doc])

  return null
}
