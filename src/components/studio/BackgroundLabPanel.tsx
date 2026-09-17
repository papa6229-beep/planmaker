/**
 * 배경 후보 칸 (배경 후보 Patch, 2026-09-17). 세로 칸의 줄 맞춤 아래.
 *
 * 제품을 보고 어울리는 장면을 만든 뒤 제품만 지운 배경이 **요청할 때마다 하나씩 쌓이고**,
 * `적용`을 누를 때만 지금 배경과 바뀐다. 밀려난 배경도 후보로 남아 번갈아 끼워 볼 수 있다.
 */

import { useRef, useState } from 'react'
import { useAssets } from '../../features/assets/useAssets'
import { useBackgroundLab, type LabStep } from '../../features/studio/useBackgroundLab'
import { ACCEPTED_MIME_TYPES } from '../../features/assets/imageUtils'
import { SCENE_BASIS_LABEL } from '../../domain/backgroundLab'
import { PanelFold } from './PanelFold'

const IMAGE_ACCEPT = ACCEPTED_MIME_TYPES.join(',')

const STEP_LABEL: Record<LabStep, string> = {
  scene: '장면 만드는 중… (1/2)',
  clean: '제품 지우는 중… (2/2)',
  save: '후보에 담는 중…',
}

export function BackgroundLabPanel() {
  const lab = useBackgroundLab()
  const { getUrl } = useAssets()
  const [note, setNote] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  if (lab === null) return null

  const candidates = lab.lab.candidates
  const referenceUrl = getUrl(lab.reference?.assetId)
  const cannot =
    lab.productCount === 0
      ? '이미지 블록에 실제 제품 이미지를 연결하면 만들 수 있습니다.'
      : lab.busyElsewhere
        ? '다른 페이지의 후보를 만드는 중입니다.'
        : null

  return (
    <PanelFold id="bg-lab" title="배경 후보" note={`${String(candidates.length)}장`} defaultOpen>
      <section className="bg-lab" aria-label="배경 후보">
        <p className="bg-lab__hint">
          제품을 보고 어울리는 배경을 만든 뒤 제품만 지워 여기에 쌓습니다. <strong>적용</strong>을 누를 때만 배경이
          바뀝니다. 후보 1장에 AI 호출 2회.
        </p>

        <div className="bg-lab__ref">
          {referenceUrl !== undefined ? (
            <img className="bg-lab__ref-thumb" src={referenceUrl} alt="" />
          ) : (
            <span className="bg-lab__ref-thumb bg-lab__ref-thumb--empty" aria-hidden="true" />
          )}
          <div className="bg-lab__ref-text">
            <span className="bg-lab__ref-label">분위기 그림</span>
            <span className="bg-lab__ref-value">
              {lab.reference === null ? '없음 — 제품만 보고 만듭니다' : SCENE_BASIS_LABEL[lab.reference.basis]}
            </span>
            <span className="bg-lab__ref-actions">
              <button type="button" className="btn bg-lab__small" onClick={() => fileRef.current?.click()}>
                {lab.lab.referenceAssetId === undefined ? '그림 첨부' : '교체'}
              </button>
              {lab.lab.referenceAssetId !== undefined && (
                <button type="button" className="btn bg-lab__small" onClick={() => void lab.detach()}>
                  첨부 빼기
                </button>
              )}
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT}
            hidden
            aria-label="배경 후보 분위기 그림 첨부"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file !== undefined) void lab.attach(file)
            }}
          />
        </div>

        <p className="bg-lab__products">
          보여 줄 제품: {lab.productCount === 0 ? '없음' : `${String(lab.productCount)}장 (큰 이미지 블록 순)`}
        </p>

        <textarea
          className="bg-lab__note"
          rows={2}
          aria-label="배경 후보 요청"
          placeholder="예: 대리석 테이블 위, 아침 햇살 / 여름 바닷가 느낌으로"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="button"
          className="btn btn--primary bg-lab__make"
          disabled={lab.busy !== null || cannot !== null}
          title={cannot ?? '비워 두면 제품과 어울리는 배경을 만듭니다'}
          onClick={() => void lab.make(note)}
        >
          {lab.busy !== null ? STEP_LABEL[lab.busy] : '후보 만들기'}
        </button>
        {cannot !== null && <p className="bg-lab__muted">{cannot}</p>}
        {lab.error !== null && (
          <p className="bg-lab__error" role="alert">
            {lab.error}
          </p>
        )}

        {candidates.length > 0 && (
          <ul className="bg-lab__list" aria-label="쌓인 배경 후보">
            {candidates.map((c) => {
              const applied = c.assetId === lab.currentAssetId
              const url = getUrl(c.assetId)
              const label = c.note.length > 0 ? c.note : SCENE_BASIS_LABEL[c.basis]
              return (
                <li key={c.id} className={`bg-lab__item${applied ? ' is-applied' : ''}`}>
                  {url !== undefined ? (
                    <img className="bg-lab__thumb" src={url} alt={label} title={label} />
                  ) : (
                    <span className="bg-lab__thumb bg-lab__thumb--missing">그림 없음</span>
                  )}
                  <span className="bg-lab__caption" title={label}>
                    {label}
                  </span>
                  <span className="bg-lab__item-actions">
                    {applied ? (
                      <span className="bg-lab__applied">적용 중</span>
                    ) : (
                      <button
                        type="button"
                        className="btn bg-lab__small"
                        aria-label={`${label} 적용`}
                        disabled={url === undefined}
                        onClick={() => void lab.apply(c)}
                      >
                        적용
                      </button>
                    )}
                    {!applied && (
                      <button
                        type="button"
                        className="btn bg-lab__small"
                        aria-label={`${label} 삭제`}
                        onClick={() => void lab.remove(c.id)}
                      >
                        삭제
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </PanelFold>
  )
}
