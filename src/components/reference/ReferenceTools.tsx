/**
 * Reference-image tools (WORK_PLAN §8.2). A page-level "도움 도구" panel, kept
 * separate from the content-block palette. The reference image is an auxiliary
 * asset — never an output block — so uploading it stores the binary and points
 * the active page's reference layer at it, without creating a canvas block.
 */

import { useRef } from 'react'
import { useAssets } from '../../features/assets/useAssets'
import { useBriefDocument } from '../../features/document/useBriefDocument'

export function ReferenceTools() {
  const { storeImage, getUrl } = useAssets()
  const { activeReference, setReferenceImage, removeReferenceImage } = useBriefDocument()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const hasImage = activeReference.assetId !== undefined
  const url = getUrl(activeReference.assetId)

  const pick = () => inputRef.current?.click()

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const asset = await storeImage(file)
    if (asset) setReferenceImage(asset)
  }

  return (
    <section className="ref-tools" aria-label="참고 이미지 도구">
      <header className="ref-tools__header">
        <h2 className="ref-tools__title">도움 도구</h2>
        <p className="ref-tools__hint">실제 페이지 이미지를 참고해 배치하세요.</p>
      </header>

      {hasImage && url ? (
        <div className="ref-tools__thumb">
          <img src={url} alt="현재 참고 이미지" />
        </div>
      ) : (
        <p className="ref-tools__empty">참고 이미지 없음</p>
      )}

      <div className="ref-tools__actions">
        {hasImage ? (
          <>
            <button type="button" className="btn" onClick={pick}>참고 이미지 교체</button>
            <button type="button" className="btn btn--danger" onClick={removeReferenceImage}>참고 이미지 제거</button>
          </>
        ) : (
          <button type="button" className="btn" onClick={pick}>참고 이미지 추가</button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="ref-tools__file-input"
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </section>
  )
}
