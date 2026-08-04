/**
 * 생성 준비 (실작업 UI 마감 §3.1).
 *
 * 아직 아무것도 만들지 않은 동안 우측이 하는 일은 하나다: **지금 누르면 되는가**를
 * 말하는 것. 그래서 여기에는 고칠 수 있는 것이 없다. 이미지를 연결하는 곳은 왼쪽
 * 캔버스이고, 같은 일을 두 곳에서 하게 만들면 어느 쪽이 진짜인지 알 수 없어진다.
 *
 * 막는 것이 있으면 개수까지 말한다. "이미지를 연결해 주세요"는 몇 개가 남았는지
 * 모르는 사람에게 아무것도 알려 주지 않는다.
 */

import { isImageBlock } from '../../domain/blockTypes'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'

export function ReadyPanel() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { getDocument, aiNote } = useBriefDocument()
  if (studio === null || generation === null) return null

  const doc = getDocument()
  const index = doc.pages.findIndex((p) => p.id === doc.activePageId)
  const page = doc.pages[index] ?? doc.pages[0]!
  const pageNumber = (index < 0 ? 0 : index) + 1

  const slots = page.blocks.filter((b) => isImageBlock(b.type) && b.aiVisibility !== 'publishing')
  const linked = slots.filter((b) => studio.job.productImages[b.id] !== undefined).length
  const missing = slots.length - linked

  return (
    <section className="ready-panel" aria-label="생성 준비">
      <h2 className="ready-panel__title">생성 준비</h2>
      <dl className="ready-panel__facts">
        <div>
          <dt>현재 페이지</dt>
          <dd>{page.title} ({pageNumber} / {doc.pages.length})</dd>
        </div>
        <div>
          <dt>API 키</dt>
          <dd>{generation.hasKey ? '이 탭에 저장됨' : '아직 없음'}</dd>
        </div>
        <div>
          <dt>제품 이미지</dt>
          <dd>연결 {linked} / 전체 {slots.length}</dd>
        </div>
        <div>
          <dt>AI 추가 지시</dt>
          <dd>{aiNote.trim().length > 0 ? '작성함' : '아직 없음'}</dd>
        </div>
      </dl>
      {missing > 0 && (
        <p className="ready-panel__warn" role="status">
          실제 제품 이미지가 연결되지 않은 자리가 {missing}개 있습니다. 왼쪽 이미지 블록에 연결해 주세요.
        </p>
      )}
    </section>
  )
}
