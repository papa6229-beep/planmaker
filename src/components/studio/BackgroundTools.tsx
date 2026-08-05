/**
 * 페이지 배경 (배경 합성 1차 §5, §11).
 *
 * 참고 이미지 옆이 아니라 따로 선다. 둘은 이름이 비슷하지만 하는 일이 정반대다:
 * 참고 이미지는 기획 의도를 확인하려고 잠깐 겹쳐 보는 것이고, 배경은 **최종
 * 결과에 그대로 출력되는** 레이어다. 한 칸에 나란히 두면 어느 쪽이 결과에 남는지
 * 매번 헷갈린다.
 *
 * 배경은 페이지마다 한 장이다. 그래서 버튼은 `넣기`와 `교체` 둘 중 하나만 있고,
 * 두 번째 배경을 만드는 길은 없다.
 */

import { useRef } from 'react'
import { useAssets } from '../../features/assets/useAssets'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { ACCEPTED_MIME_TYPES } from '../../features/assets/imageUtils'

const IMAGE_ACCEPT = ACCEPTED_MIME_TYPES.join(',')

export function BackgroundTools() {
  const studio = useStudioJob()
  const { activePageId } = useBriefDocument()
  const { storeImage, getUrl } = useAssets()
  const fileRef = useRef<HTMLInputElement | null>(null)
  if (studio === null) return null

  const background = studio.backgroundOf(activePageId)
  const url = getUrl(background?.assetId)

  const pick = async (file: File) => {
    const asset = await storeImage(file)
    if (asset === null) return
    await studio.setBackground(activePageId, { assetId: asset.id, source: 'manual' })
  }

  return (
    <section className="bg-tools" aria-label="배경">
      <h2 className="bg-tools__title">배경</h2>
      <p className="bg-tools__note">최종 결과의 맨 뒤에 깔립니다. 참고 이미지와는 다른 자료입니다.</p>

      {url !== undefined && (
        <div className="bg-tools__preview">
          <img src={url} alt="현재 배경" />
          <span className="bg-tools__badge">
            {background?.source === 'ai' ? 'AI가 만든 배경' : '직접 넣은 배경'}
          </span>
        </div>
      )}

      <div className="bg-tools__row">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          {background === undefined ? '배경 넣기' : '배경 교체'}
        </button>
        {background !== undefined && (
          <button type="button" className="btn" onClick={() => void studio.removeBackground(activePageId)}>
            배경 제거
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="bg-tools__file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void pick(file)
          e.target.value = ''
        }}
      />
    </section>
  )
}
