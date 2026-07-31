/**
 * 이미지 생성기 작업판 (`/studio`, 이미지 생성기 0단계 §4).
 *
 * 디자인팀이 쓰는 화면이지만 편집기는 작성기와 같은 것이다 — 같은 캔버스, 같은
 * 페이지, 같은 참고 이미지, 같은 파일 불러오기. 화면을 한 벌 더 만들지 않고,
 * 저장하는 곳(Studio 작업)과 오른쪽 패널(제품 이미지 연결)만 갈아 끼운다.
 *
 * 오래된 게이트·이미지 요청 화면은 되살리지 않는다. 그 화면들은 지금도 내부
 * 주소에 그대로 있고, 이 작업판과는 아무 관계가 없다.
 */

import { AppShell } from '../AppShell'
import { StudioJobProvider, useStudioJob } from '../../features/studio/useStudioJob'

function StudioEditor() {
  const studio = useStudioJob()
  if (studio === null) return null
  return <AppShell mode="studio" binding={studio.binding} />
}

export function StudioWorkPage() {
  return (
    <StudioJobProvider>
      <StudioEditor />
    </StudioJobProvider>
  )
}
