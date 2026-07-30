/**
 * First-start choice (기획서 작성 화면 1차 단순화 §2.1).
 *
 * A blank canvas gives a first-time user nothing to act on, so the empty page
 * offers the two ways real briefs actually begin:
 *
 *   참고 이미지 위에서 시작 — pick a past event page, which becomes the page's
 *     reference layer in overlay mode. From there the existing 나란히 보기 /
 *     오버레이 / 투명도 controls take over; this is not a separate wizard.
 *   빈 화면에서 시작 — go straight to the canvas.
 *
 * It only appears while the active page is genuinely untouched (no blocks, no
 * reference image), so a document already in progress never sees it again.
 */

import { useRef } from 'react'
import { useAssets } from '../../features/assets/useAssets'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { ACCEPTED_MIME_TYPES } from '../../features/assets/imageUtils'
import { ImageIcon, DocIcon } from '../shell/icons'

const IMAGE_ACCEPT = ACCEPTED_MIME_TYPES.join(',')

export function StartChoice({ onDismiss }: { onDismiss: () => void }) {
  const { storeImage } = useAssets()
  const { setReferenceImage, setReferenceViewMode, setReferenceVisible } = useBriefDocument()
  const fileRef = useRef<HTMLInputElement | null>(null)

  const useReference = async (file: File) => {
    const asset = await storeImage(file)
    if (!asset) return
    setReferenceImage(asset)
    // Lay it under the canvas so the user can place blocks straight onto it.
    // The overlay layer defaults to hidden, so turn it on explicitly — picking
    // "start on top of a reference" and seeing nothing would be a dead end.
    setReferenceViewMode('overlay')
    setReferenceVisible(true)
    onDismiss()
  }

  return (
    <div className="start-choice" role="group" aria-label="어떻게 시작할까요">
      <h2 className="start-choice__title">어떻게 시작할까요?</h2>
      <p className="start-choice__desc">
        참고할 예전 이벤트 이미지가 있으면 그 위에 바로 올려놓을 수 있습니다.
      </p>

      <div className="start-choice__options">
        <button type="button" className="start-choice__option" onClick={() => fileRef.current?.click()}>
          <span className="start-choice__icon" aria-hidden="true"><ImageIcon size={26} /></span>
          <span className="start-choice__option-title">참고 이미지 위에서 시작</span>
          <span className="start-choice__option-desc">예전 이벤트 이미지를 깔고 그 위에 배치합니다</span>
        </button>

        <button type="button" className="start-choice__option" onClick={onDismiss}>
          <span className="start-choice__icon" aria-hidden="true"><DocIcon size={26} /></span>
          <span className="start-choice__option-title">빈 화면에서 시작</span>
          <span className="start-choice__option-desc">바로 문구와 이미지 자리를 놓습니다</span>
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="start-choice__input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void useReference(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
