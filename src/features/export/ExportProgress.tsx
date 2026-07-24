/**
 * Progress + failure overlay for export/import (WORK_PLAN §6, §8, §10). While
 * busy it blocks duplicate actions; on failure it shows the reason.
 */

import { useEventBriefIo } from './useEventBriefIo'

export function ExportProgress() {
  const { state, dismiss } = useEventBriefIo()

  if (state.kind === 'exporting' || state.kind === 'importing') {
    return (
      <div className="io-backdrop" role="presentation">
        <div className="io-dialog io-dialog--progress" role="status" aria-live="polite">
          <span className="io-spinner" aria-hidden="true" />
          <p className="io-dialog__desc">{state.message}</p>
        </div>
      </div>
    )
  }

  if (state.kind === 'export-failed' || state.kind === 'import-failed') {
    const label = state.kind === 'export-failed' ? '내보내기 실패' : '불러오기 실패'
    return (
      <div className="io-backdrop" role="presentation" onClick={dismiss}>
        <div className="io-dialog" role="alertdialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
          <h2 className="io-dialog__title"><span aria-hidden="true">⛔</span> {label}</h2>
          <p className="io-dialog__desc">{state.message}</p>
          <div className="io-dialog__actions">
            <button type="button" className="btn" onClick={dismiss}>닫기</button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
