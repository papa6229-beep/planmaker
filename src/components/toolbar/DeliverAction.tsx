/**
 * 전달하기 — hands the brief on screen to the internal image-generation queue
 * (Phase 7 Step 7).
 *
 * Its own component because it is the one part of the top bar that belongs to
 * the internal `studio` surface: it is the only thing here that reads and
 * writes work requests. The brief writer other teams use never mounts it, and
 * therefore never needs `RequestsProvider` (타 팀 배포 §6.1).
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useRequests } from '../../features/requests/useRequests'

export function DeliverAction({ disabled = false, onNeedTitle }: { disabled?: boolean; onNeedTitle?: () => void }) {
  const { getDocument } = useBriefDocument()
  const { submit } = useRequests()
  const [notice, setNotice] = useState('')
  const [delivered, setDelivered] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const doc = getDocument()
    if (!doc.project.title.trim()) {
      setDelivered(false)
      setNotice('기획서 제목을 입력해야 전달할 수 있습니다.')
      onNeedTitle?.()
      return
    }
    // No shape of brief is turned away: one may be only wording, only the place
    // a picture goes, or only the direction for the whole page (자유 저장 §2.2).
    // A name is still required — it is how the request is found later.
    setSubmitting(true)
    try {
      await submit(doc, new Date().toISOString())
      setDelivered(true)
      setNotice('요청이 이미지 생성 목록에 전달되었습니다.')
    } catch {
      setDelivered(false)
      setNotice('전달에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="editor-topbar__submit">
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => void handleSubmit()}
        disabled={submitting || disabled}
        aria-describedby="editor-topbar-submit-hint"
      >
        전달하기
      </button>
      <p id="editor-topbar-submit-hint" className="editor-topbar__submit-hint" role="status">
        {notice || '이미지 생성 요청으로 전달합니다.'}
        {delivered && (
          <>
            {' '}
            <Link to="/image-requests">목록 보기</Link>
          </>
        )}
      </p>
    </div>
  )
}
