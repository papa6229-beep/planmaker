/**
 * 완성본에서 배너를 뽑는다 (배너 Patch §5, 자동 배치 제거 Patch).
 *
 * 여기서는 **크기를 고르기만** 한다. 고르면 그 크기의 배너가 페이지로 서고, 배경만
 * 깔린 빈 캔버스가 가운데에 열린다 — 확대해서 보고, 서랍에서 조각을 꺼내 놓고,
 * 끌어 옮기고, 크기를 바꾸고, 지운다. 그래서 이 패널에 미리보기가 없다. 가운데가
 * 곧 미리보기다.
 *
 * 앞선 판에는 여기 "무엇을 버렸는지" 알리는 목록이 있었다. 자동 배치가 사라졌으니
 * 버릴 일도 없다 — 올릴 것은 사람이 서랍에서 고른다.
 */

import { useBannerMaker, sideLabel } from '../../features/studio/useBannerMaker'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { useBannerPresets } from '../../features/studio/useBannerPresets'
import { useState } from 'react'
import { customBannerSpec } from '../../domain/bannerSpec'
import { fromDraft, toDraft, type PresetDraft } from '../../domain/bannerPresets'
import { PanelFold } from './PanelFold'

export function BannerPanel() {
  const banner = useBannerMaker()
  const generation = useImageGeneration()
  const { presets, save, edited } = useBannerPresets()
  const [custom, setCustom] = useState({ width: '', height: '' })
  /** 프리셋을 고치는 중인가. 고치는 동안에는 뽑기 버튼 대신 입력줄이 선다. */
  const [drafts, setDrafts] = useState<PresetDraft[] | null>(null)
  // 만드는 동안·만든 뒤에는 결과 유무와 상관없이 남는다. 만드는 도중 가운데가
  // 잠깐 다른 페이지를 가리키는데, 그때 사라지면 방금 만든 배너의 안내가 함께
  // 사라진다 — 무엇을 버렸는지가 그 안내에만 있다.
  if (banner === null || generation === null) return null
  if (!generation.hasResult && banner.state.kind === 'idle') return null

  const busy = banner.state.kind === 'working' || generation.state.kind === 'running'
  const result = banner.state.kind === 'done' ? banner.state.result : null

  return (
    <PanelFold id="banner" title="배너 뽑기" note="배경만 깔린 배너 캔버스">
      <section className="banner" aria-label="배너 뽑기">
        <p className="banner__note">
          고른 크기로 배너 캔버스를 엽니다. 배경만 깔리고 조각은 올라오지 않습니다 — 필요한 것을 아래
          <b> 조각 서랍</b>에서 꺼내 놓으세요. 새로 그리지 않으므로 AI 호출이 없습니다.
        </p>

        {drafts === null ? (
          <div className="banner__specs">
          {presets.map((spec) => (
            <button
              key={spec.id}
              type="button"
              className="btn btn--primary banner__make"
              disabled={busy}
              title={
                spec.siblings.length === 0
                  ? spec.label
                  : `${spec.label} · 같은 배치로 ${spec.siblings.map((s) => `${String(s.width)}×${String(s.height)}`).join(', ')}`
              }
              onClick={() => banner.make(spec.id)}
            >
              {spec.width}×{spec.height} {banner.viewingSpecId === spec.id ? '다시 뽑기' : '뽑기'}
            </button>
          ))}
          <button
            type="button"
            className="btn banner__edit-presets"
            onClick={() => setDrafts(presets.map(toDraft))}
          >
            크기 고치기
          </button>
          </div>
        ) : (
          /* 쇼핑몰이 개편되면 크기가 바뀌고, 새 자리가 생기면 여섯째가 필요해진다.
             적어 둔 다섯을 코드에 박아 두면 그때마다 사람을 불러야 한다. */
          <div className="banner__presets" role="group" aria-label="배너 크기 프리셋">
            <p className="banner__note">
              이 브라우저에 저장됩니다. <b>같이 저장할 크기</b>는 뽑지 않고 알려만 주는 값입니다 — 하나
              만들어 두고 크기만 바꿔 저장하는 그 크기입니다.
            </p>
            <div className="banner__preset banner__preset--head" aria-hidden="true">
              <span className="banner__preset-label">이름</span>
              <span className="banner__preset-size">가로</span>
              <span className="banner__custom-x"> </span>
              <span className="banner__preset-size">세로</span>
              <span className="banner__preset-siblings">같이 저장할 크기</span>
              <span className="banner__preset-drop"> </span>
            </div>
            {drafts.map((draft, index) => {
              const set = (patch: Partial<PresetDraft>) =>
                setDrafts((list) => (list ?? []).map((d, i) => (i === index ? { ...d, ...patch } : d)))
              const bad = fromDraft(draft) === null
              return (
                <div className={`banner__preset${bad ? ' is-bad' : ''}`} key={`row-${String(index)}`}>
                  <input
                    className="banner__preset-label"
                    value={draft.label}
                    aria-label={`프리셋 ${String(index + 1)} 이름`}
                    placeholder="이름"
                    onChange={(e) => set({ label: e.target.value })}
                  />
                  <input
                    className="banner__preset-size"
                    value={draft.width}
                    aria-label={`프리셋 ${String(index + 1)} 가로`}
                    onChange={(e) => set({ width: e.target.value })}
                  />
                  <span className="banner__custom-x">×</span>
                  <input
                    className="banner__preset-size"
                    value={draft.height}
                    aria-label={`프리셋 ${String(index + 1)} 세로`}
                    onChange={(e) => set({ height: e.target.value })}
                  />
                  <input
                    className="banner__preset-siblings"
                    value={draft.siblings}
                    aria-label={`프리셋 ${String(index + 1)} 형제 크기`}
                    placeholder="형제 크기 (840×78, 500×387)"
                    onChange={(e) => set({ siblings: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn--danger banner__preset-drop"
                    aria-label={`프리셋 ${String(index + 1)} 삭제`}
                    title="이 크기를 목록에서 뺍니다"
                    onClick={() => setDrafts((list) => (list ?? []).filter((_, i) => i !== index))}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
            <div className="banner__preset-actions">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setDrafts((list) => [...(list ?? []), { id: '', label: '', width: '', height: '', siblings: '' }])
                }
              >
                크기 추가
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  // 모양이 어긋난 줄은 저장하지 않는다. 전부 어긋나면 기본값으로
                  // 돌아간다 — 되돌릴 길이 없는 편집은 만들지 않는다.
                  save(drafts.map(fromDraft).filter((s): s is NonNullable<typeof s> => s !== null))
                  setDrafts(null)
                }}
              >
                저장
              </button>
              <button type="button" className="btn" onClick={() => setDrafts(null)}>
                취소
              </button>
              {edited && (
                <button
                  type="button"
                  className="btn"
                  title="처음 적어 둔 다섯 크기로 돌아갑니다"
                  onClick={() => {
                    save([])
                    setDrafts(null)
                  }}
                >
                  기본값으로
                </button>
              )}
            </div>
          </div>
        )}

        {/* 프리셋 말고 그때그때 필요한 크기로도. */}
        <div className="banner__custom">
          <label className="banner__custom-field">
            <span>가로</span>
            <input
              type="number"
              min={1}
              value={custom.width}
              aria-label="배너 가로"
              onChange={(e) => setCustom((c) => ({ ...c, width: e.target.value }))}
            />
          </label>
          <span className="banner__custom-x">×</span>
          <label className="banner__custom-field">
            <span>세로</span>
            <input
              type="number"
              min={1}
              value={custom.height}
              aria-label="배너 세로"
              onChange={(e) => setCustom((c) => ({ ...c, height: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || customBannerSpec(Number(custom.width), Number(custom.height)) === null}
            onClick={() => {
              const spec = customBannerSpec(Number(custom.width), Number(custom.height))
              if (spec !== null) banner.make(spec.id)
            }}
          >
            이 크기로
          </button>
        </div>

        {banner.state.kind === 'working' && <p className="banner__status">만드는 중…</p>}
        {banner.state.kind === 'failed' && <p className="banner__status banner__status--bad">{banner.state.message}</p>}

        {result !== null && (
          <div className="banner__result">
            <p className="banner__size">
              {result.spec.label} · {result.spec.width}×{result.spec.height}
              {result.spec.siblings.length > 0 && (
                <span className="banner__siblings">
                  {' '}
                  · 같은 배치로 {result.spec.siblings.map((s) => `${s.width}×${s.height}`).join(', ')} 도 저장하세요
                </span>
              )}
            </p>

            {result.edges.length > 0 && (
              <div className="banner__edges">
                <span className="banner__edges-title">끝단 색</span>
                {result.edges.map((edge) => (
                  <button
                    key={edge.side}
                    type="button"
                    className="banner__edge"
                    title={`${sideLabel(edge.side)} ${edge.hex} 복사`}
                    onClick={() => void navigator.clipboard?.writeText(edge.hex)}
                  >
                    <span className="banner__swatch" style={{ background: edge.hex }} aria-hidden="true" />
                    {sideLabel(edge.side)} {edge.hex}
                  </button>
                ))}
              </div>
            )}

            {result.centerFallback && (
              <p className="banner__status">배경에서 잔잔한 자리를 고르지 못해 원본 배경을 그대로 썼습니다.</p>
            )}

            <p className="banner__note">
              저장은 위의 <b>이미지 저장</b>으로 합니다 — 배너도 한 장의 완성본입니다.
            </p>
          </div>
        )}
      </section>
    </PanelFold>
  )
}
