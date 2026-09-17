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
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { setBackgroundEdit, useDesignTools } from '../../features/studio/designTools'

const IMAGE_ACCEPT = ACCEPTED_MIME_TYPES.join(',')

export function BackgroundTools() {
  const studio = useStudioJob()
  const { activePageId } = useBriefDocument()
  const { storeImage, getUrl } = useAssets()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const generation = useImageGeneration()
  const { backgroundEdit } = useDesignTools()
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

      {/* 크기·자리 조절 (배경 크기 Patch, 2026-09-17). 배너는 손잡이가 늘 서 있으므로 묻지 않는다. */}
      {background !== undefined && studio.bannerSpecOf(activePageId) === null && (
        <div className="bg-tools__row">
          <button
            type="button"
            className={`btn${backgroundEdit ? ' is-active' : ''}`}
            aria-pressed={backgroundEdit}
            title="캔버스에서 배경을 끌어 옮기고, 모서리로 크기를 바꿉니다"
            onClick={() => setBackgroundEdit(!backgroundEdit)}
          >
            {backgroundEdit ? '조절 끝내기' : '크기·위치 조절'}
          </button>
          {background.rect !== undefined && (
            <button
              type="button"
              className="btn"
              title="배경이 캔버스를 다시 꽉 채웁니다"
              onClick={() => {
                studio.markStep()
                const { rect: _rect, ...rest } = background
                void studio.setBackground(activePageId, rest).then(() => generation?.recomposePage(activePageId))
              }}
            >
              캔버스에 맞추기
            </button>
          )}
        </div>
      )}

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
