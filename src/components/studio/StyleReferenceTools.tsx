/**
 * 디자인 스타일 레퍼런스 (스타일 레퍼런스 Patch).
 *
 * 작업판에서 예전의 레이아웃 참고 도구를 대신하는 자리다. 이름이 비슷해서
 * 헷갈리기 쉬운데, 하는 일이 정반대다.
 *
 *  - 작성기의 `참고 이미지`: 배치를 눈으로 맞추려고 캔버스에 겹쳐 보는 것.
 *    결과에 남지 않고 AI에게도 가지 않는다.
 *  - 여기의 `디자인 스타일 레퍼런스`: AI에게 **실제로 보내는** 한 장. 색감과
 *    질감과 그래픽의 결을 참고하게 한다.
 *
 * 그 차이를 설명 줄에 그대로 적어 둔다 — 두 자료를 섞으면 작업자는 제품 사진을
 * 여기 올리게 되고, 그 순간 원본이 밖으로 나간다.
 *
 * 페이지마다 한 장이다.
 */

import { useRef } from 'react'
import { useAssets } from '../../features/assets/useAssets'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { ACCEPTED_MIME_TYPES } from '../../features/assets/imageUtils'

const IMAGE_ACCEPT = ACCEPTED_MIME_TYPES.join(',')

export function StyleReferenceTools() {
  const studio = useStudioJob()
  const { activePageId } = useBriefDocument()
  const { storeImage, getUrl } = useAssets()
  const fileRef = useRef<HTMLInputElement | null>(null)
  if (studio === null) return null

  const assetId = studio.styleReferenceOf(activePageId)
  const url = getUrl(assetId)

  const pick = async (file: File) => {
    const asset = await storeImage(file)
    if (asset === null) return
    await studio.setStyleReference(activePageId, asset.id)
  }

  return (
    <section className="style-ref" aria-label="디자인 스타일 레퍼런스">
      <h2 className="style-ref__title">디자인 스타일 레퍼런스</h2>
      <p className="style-ref__hint">
        AI가 색감·질감·그래픽 분위기를 참고합니다. 제품·인물 원본과는 다른 자료입니다.
      </p>

      {url === undefined ? (
        <p className="style-ref__empty">이미지 없음</p>
      ) : (
        <div className="style-ref__preview">
          <img src={url} alt="디자인 스타일 레퍼런스" />
        </div>
      )}

      <div className="style-ref__actions">
        {assetId === undefined ? (
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            스타일 이미지 추가
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              교체
            </button>
            <button type="button" className="btn" onClick={() => void studio.removeStyleReference(activePageId)}>
              제거
            </button>
          </>
        )}
      </div>

      {/* 레퍼런스가 있을 때만 묻는다 — 없는 레퍼런스의 배경을 살릴 수는 없다.
          기본은 꺼짐: 색감과 결만 참고하고 구성은 새로 잡는다 (배경 색맞춤 Patch). */}
      {assetId !== undefined && (
        <label className="style-ref__keep">
          <input
            type="checkbox"
            checked={studio.keepReferenceBackgroundOf(activePageId)}
            onChange={(e) => void studio.setKeepReferenceBackground(activePageId, e.target.checked)}
          />
          <span>
            이 레퍼런스의 <b>배경 구성까지</b> 살리기
            <small>꺼 두면 색감·질감만 참고합니다.</small>
          </span>
        </label>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="style-ref__file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void pick(file)
          e.target.value = ''
        }}
      />
    </section>
  )
}
