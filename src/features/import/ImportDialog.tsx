/**
 * Replace-confirmation dialog for import (WORK_PLAN §8). Only shown when the
 * archive is already validated and the current project has work that would be
 * replaced. Cancelling leaves everything untouched.
 */

import { useEventBriefIo } from '../export/useEventBriefIo'

export function ImportDialog() {
  const { state, dismiss, confirmImport } = useEventBriefIo()
  if (state.kind !== 'import-confirm') return null

  const { doc } = state.pending
  const pageCount = doc.pages.length
  const blockCount = doc.pages.reduce((sum, p) => sum + p.blocks.length, 0)
  const assetCount = state.pending.assets.length

  return (
    <div className="io-backdrop" role="presentation" onClick={dismiss}>
      <div className="io-dialog" role="alertdialog" aria-label="현재 작업 교체 확인" onClick={(e) => e.stopPropagation()}>
        <h2 className="io-dialog__title">현재 작업을 교체합니다</h2>
        <p className="io-dialog__desc">
          불러온 기획서로 현재 작업을 교체합니다. 저장하지 않은 변경 사항은 사라집니다.
          <br />
          페이지 {pageCount}개 · 블록 {blockCount}개 · 이미지 {assetCount}개
        </p>
        <div className="io-dialog__actions">
          <button type="button" className="btn" onClick={dismiss}>취소</button>
          <button type="button" className="btn btn--primary" onClick={() => void confirmImport()}>교체</button>
        </div>
      </div>
    </div>
  )
}
