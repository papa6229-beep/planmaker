/**
 * Export pre-check dialog (WORK_PLAN §5). Errors block export; warnings require
 * an explicit confirmation. Issues are shown with an icon + title + description
 * (not colour alone) for accessibility.
 */

import { useEventBriefIo } from './useEventBriefIo'
import type { ExportIssue } from './exportValidation'

function IssueList({ issues, kind }: { issues: ExportIssue[]; kind: 'error' | 'warning' }) {
  const icon = kind === 'error' ? '⛔' : '⚠️'
  const title = kind === 'error' ? '오류' : '경고'
  return (
    <ul className="io-issues">
      {issues.map((issue, i) => (
        <li key={`${issue.code}-${i}`} className={`io-issue io-issue--${kind}`}>
          <span className="io-issue__icon" aria-hidden="true">{icon}</span>
          <span className="io-issue__body">
            <span className="io-issue__title">{title}</span>
            <span className="io-issue__msg">{issue.message}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function ExportValidationDialog() {
  const { state, dismiss, confirmExportWithWarnings } = useEventBriefIo()

  if (state.kind === 'export-blocked') {
    return (
      <div className="io-backdrop" role="presentation" onClick={dismiss}>
        <div className="io-dialog" role="alertdialog" aria-label="내보내기 오류" onClick={(e) => e.stopPropagation()}>
          <h2 className="io-dialog__title">내보내기를 진행할 수 없습니다</h2>
          <p className="io-dialog__desc">아래 오류를 먼저 수정하세요. 표시된 블록을 확인해 주세요.</p>
          <IssueList issues={state.errors} kind="error" />
          <div className="io-dialog__actions">
            <button type="button" className="btn" onClick={dismiss}>닫기</button>
          </div>
        </div>
      </div>
    )
  }

  if (state.kind === 'export-warn') {
    return (
      <div className="io-backdrop" role="presentation" onClick={dismiss}>
        <div className="io-dialog" role="alertdialog" aria-label="내보내기 경고" onClick={(e) => e.stopPropagation()}>
          <h2 className="io-dialog__title">확인이 필요한 경고</h2>
          <p className="io-dialog__desc">아래 경고를 확인한 뒤 계속 진행할 수 있습니다.</p>
          <IssueList issues={state.warnings} kind="warning" />
          <div className="io-dialog__actions">
            <button type="button" className="btn" onClick={dismiss}>취소</button>
            <button type="button" className="btn btn--primary" onClick={() => void confirmExportWithWarnings()}>
              계속 진행
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
