/**
 * Replace-confirmation dialog for import (WORK_PLAN §8). Only shown when the
 * archive is already validated and there is work that would be replaced.
 * Cancelling leaves everything untouched.
 *
 * 작업판에서는 이 창이 마지막 문이다 (작업 잃지 않기 Patch).
 *
 * 불러오기는 지금 작업의 **완성본을 지운다** — 파일이 말하지 않은 것은 없는 것으로
 * 열어야 하므로 그 자체는 옳다. 문제는 창이 그 사실을 말하지 않은 것이었다.
 * "저장하지 않은 변경 사항은 사라집니다"는 맞는 말이지만, 사라지는 것이 방금
 * 유료로 만든 완성본이라는 것은 어디에도 없었다. 그래서 여기서 두 가지를 한다.
 *
 *  - 잃을 것을 **장수로** 말한다. "완성본 2장"은 "변경 사항"과 다른 무게다.
 *  - 저장할 길을 **이 창 안에** 둔다. 취소하고 다른 버튼을 찾아가게 하지 않는다.
 */

import { useEventBriefIo } from '../export/useEventBriefIo'
import { useStudioJob } from '../studio/useStudioJob'
import { jobResults } from '../../domain/studioJob'

export function ImportDialog() {
  const { state, dismiss, confirmImport, saveThenConfirmImport, busy } = useEventBriefIo()
  // 작업판 밖에서는 provider 자체가 없다. 그때 잃을 완성본도 없다.
  const studio = useStudioJob()
  if (state.kind !== 'import-confirm') return null

  const { doc } = state.pending
  const pageCount = doc.pages.length
  const blockCount = doc.pages.reduce((sum, p) => sum + p.blocks.length, 0)
  const assetCount = state.pending.assets.length
  const madeCount = Object.keys(jobResults(studio?.job ?? null)).length

  return (
    <div className="io-backdrop" role="presentation" onClick={dismiss}>
      <div className="io-dialog" role="alertdialog" aria-label="현재 작업 교체 확인" onClick={(e) => e.stopPropagation()}>
        <h2 className="io-dialog__title">현재 작업을 교체합니다</h2>
        <p className="io-dialog__desc">
          불러온 기획서로 현재 작업을 교체합니다. 저장하지 않은 변경 사항은 사라집니다.
          <br />
          페이지 {pageCount}개 · 블록 {blockCount}개 · 이미지 {assetCount}개
        </p>
        {madeCount > 0 && (
          <p className="io-dialog__loss">
            지금 작업에 만들어 둔 <b>완성본 {madeCount}장이 사라집니다.</b> 파일로 저장해 두면 나중에 열어서{' '}
            <b>완성본 다시 합치기</b>로 되돌릴 수 있지만, 저장하지 않고 열면 돌아올 방법이 없습니다.
          </p>
        )}
        {state.saveFailed !== undefined && (
          <p className="io-dialog__loss io-dialog__loss--failed" role="alert">
            {state.saveFailed}
          </p>
        )}
        <div className="io-dialog__actions">
          <button type="button" className="btn" onClick={dismiss} disabled={busy}>취소</button>
          {madeCount > 0 && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void saveThenConfirmImport()}
              disabled={busy}
              title="지금 작업을 .eventbrief 파일로 저장한 뒤 불러옵니다"
            >
              저장하고 열기
            </button>
          )}
          {/* 잃을 것이 있으면 이 쪽은 주 버튼이 아니다. 눈이 먼저 가는 자리는
              잃지 않는 길이 갖는다. */}
          <button
            type="button"
            className={madeCount > 0 ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={() => void confirmImport()}
            disabled={busy}
          >
            {madeCount > 0 ? '저장하지 않고 열기' : '교체'}
          </button>
        </div>
      </div>
    </div>
  )
}
