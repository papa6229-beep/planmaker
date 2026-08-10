/**
 * 프리셋을 이 브라우저에 남긴다 (프리셋 관리 Patch).
 *
 * 작업 파일(`.eventbrief`)이 아니라 **이 브라우저**에 둔다. 프리셋은 쇼핑몰이 정한
 * 크기이지 이 이벤트의 성질이 아니라서, 파일에 담으면 이벤트마다 따로 놀고 새
 * 파일을 열 때마다 다시 적어야 한다. 여기 두면 어느 파일을 열어도 같은 다섯이다.
 *
 * API 키와는 다른 자리다. 키는 어떤 저장소에도 남기지 않는다는 규칙이 있고, 여기
 * 담기는 것은 숫자 몇 개뿐이다.
 *
 * 읽지 못하면 기본값으로 간다. 저장에 실패해도 지금 화면은 그대로 돈다 — 프리셋
 * 하나 때문에 배너를 못 뽑는 일은 없어야 한다.
 */

import { useCallback, useEffect, useState } from 'react'
import { readPresets, writePresets } from '../../domain/bannerPresets'
import { BANNER_SPECS, type BannerSpec } from '../../domain/bannerSpec'

export const BANNER_PRESET_KEY = 'planmaker.bannerPresets.v1'

function load(): readonly BannerSpec[] {
  try {
    const raw = window.localStorage.getItem(BANNER_PRESET_KEY)
    return raw === null ? BANNER_SPECS : readPresets(JSON.parse(raw))
  } catch {
    return BANNER_SPECS
  }
}

export interface BannerPresetsApi {
  presets: readonly BannerSpec[]
  /** 목록을 통째로 갈아 끼운다. 빈 목록을 주면 기본값으로 돌아간다. */
  save: (specs: readonly BannerSpec[]) => void
  /** 손댄 적이 있는가 — `기본값으로` 버튼을 보일지가 여기서 갈린다. */
  edited: boolean
}

export function useBannerPresets(): BannerPresetsApi {
  const [presets, setPresets] = useState<readonly BannerSpec[]>(BANNER_SPECS)
  const [edited, setEdited] = useState(false)

  // 첫 그림 뒤에 읽는다. 서버에서 그린 화면과 처음 그림이 달라지지 않게.
  useEffect(() => {
    const stored = load()
    setPresets(stored)
    setEdited(stored !== BANNER_SPECS)
  }, [])

  const save = useCallback((specs: readonly BannerSpec[]) => {
    const next = specs.length === 0 ? BANNER_SPECS : specs
    setPresets(next)
    setEdited(next !== BANNER_SPECS)
    try {
      if (specs.length === 0) window.localStorage.removeItem(BANNER_PRESET_KEY)
      else window.localStorage.setItem(BANNER_PRESET_KEY, JSON.stringify(writePresets(next)))
    } catch {
      // 못 남겨도 이번 판은 그대로 쓴다. 다음에 열면 기본값으로 돌아올 뿐이다.
    }
  }, [])

  return { presets, save, edited }
}
