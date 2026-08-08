/**
 * 흰 글자 둘레의 자주색 띠를 지운다 (자주색 테두리 Patch).
 *
 * 모델이 투명 배경을 주지 않아 문구는 마젠타 위에 그려져 오고, 그 색을 여기서
 * 지운다. 글자 가장자리는 글자색과 마젠타가 섞인 색이라 반쯤 섞인 픽셀이 띠로
 * 남는데, 흰 글자에서 유독 도드라진다 — 흰색과 마젠타는 빨강·파랑이 같아서
 * 섞여도 그 두 채널이 가득 찬 채, 곧 진분홍으로 남기 때문이다.
 *
 * 이제 생성할 때부터 그 겹을 되돌리지만, **앞서 만들어 둔 완성본**에는 띠가
 * 그대로 있다. 다시 만들면 값이 든다. 띠는 "지워진 픽셀에 맞닿은 불투명 픽셀"로
 * 찾을 수 있어 마젠타가 이미 사라진 그림에서도 똑같이 고칠 수 있으므로, 여기서는
 * 조각을 고쳐 다시 합친다 — **외부 호출 0건.**
 *
 * 완성본을 보는 동안에만 나온다. 문제를 보는 화면에 손잡이가 있어야 한다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { PanelFold } from './PanelFold'

export function EdgeTidyPanel() {
  const generation = useImageGeneration()
  const { activePageId } = useBriefDocument()
  if (generation === null || !generation.canTidyEdges) return null

  const busy = generation.state.kind === 'running'
  const report = generation.tidyReport
  return (
    <PanelFold id="edge-tidy" title="글자 가장자리" note="흰 글자 둘레에 자주색 띠가 보일 때">
      <p className="edge-tidy__note">
        글자를 그릴 때 쓴 <b>임시 배경이 가장자리에 남은 것</b>입니다. 문구 조각을 고쳐 다시 합칩니다. 여러 번
        눌러도 더 달라지지 않고, <b>AI를 부르지 않습니다.</b>
      </p>
      <button
        type="button"
        className="btn"
        disabled={busy}
        title="AI를 부르지 않고 문구 조각의 가장자리만 다듬습니다"
        onClick={() => void generation.tidyEdges(activePageId)}
      >
        {busy ? '다듬는 중…' : '가장자리 다듬기'}
      </button>
      {/* 무슨 일이 있었는지 말한다. 아무것도 고칠 것이 없었던 것과 기능이 고장 난
          것은 다른 사실인데, 화면이 그대로면 사람에게는 둘이 똑같아 보인다. */}
      {report !== null && (
        <p className="edge-tidy__report" role="status">
          {report.changed === 0
            ? `문구 조각 ${report.pieces}장을 살펴봤지만 다듬을 가장자리를 찾지 못했습니다. 남아 있는 색이 임시 배경에서 온 것이 아닐 수 있습니다.`
            : `문구 조각 ${report.pieces}장 중 ${report.changed}장에서 가장자리 ${report.pixels.toLocaleString()}픽셀을 다듬었습니다.`}
        </p>
      )}
    </PanelFold>
  )
}
