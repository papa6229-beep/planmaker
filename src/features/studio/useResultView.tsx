/**
 * 완성본을 얼마나 크게 볼 것인가 (완성본 모드 Patch).
 *
 * 기획서 캔버스의 확대·축소(`useCanvasView`)와 **완전히 다른 값**이다. 지금까지
 * 위쪽 확대·축소 막대는 기획서만 움직였고 완성본에는 배율이 아예 없어서, 결과는
 * 화면 폭에 고정된 채 세로로 잘려 나갔다 — 전체를 한 번에 볼 방법이 없었다.
 *
 * 계산은 기획서가 쓰는 순수 모듈(`canvasView.ts`)을 그대로 쓴다. 규칙이 둘로
 * 갈리면 같은 `100%`가 두 화면에서 다른 크기를 뜻하게 된다.
 *
 * 보기 상태다. 저장되지 않고, 결과 이미지에도 남지 않는다.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitToViewZoom,
  zoomIn,
  zoomOut,
} from '../editor/canvasView'

/** 화면에 **통째로** 담을 것인가, 폭만 맞출 것인가, 사람이 정한 배율인가. */
export type ResultFit = 'page' | 'width' | 'manual'

interface ResultViewValue {
  zoom: number
  fit: ResultFit
  stepIn: () => void
  stepOut: () => void
  resetTo100: () => void
  fitWidth: () => void
  fitPage: () => void
  /**
   * 지금 볼 수 있는 자리와 완성본의 논리 크기를 알린다.
   *
   * `page`일 때는 세로까지 들어가야 하므로 높이도 함께 본다 — 폭만 맞추면 긴
   * 페이지는 여전히 잘린다. 그 "전체가 안 보인다"가 이 Patch가 고치는 것이다.
   */
  report: (available: { width: number; height: number }, logical: { width: number; height: number }) => void
  canZoomIn: boolean
  canZoomOut: boolean
}

const ResultViewContext = createContext<ResultViewValue | null>(null)

const EPSILON = 1e-6

export function ResultViewProvider({ children }: { children: ReactNode }) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [fit, setFitState] = useState<ResultFit>('page')
  // 크기 알림은 렌더 밖에서 오므로 최신 값을 ref로 따로 들고 있는다.
  const fitRef = useRef<ResultFit>('page')
  const availRef = useRef({ width: 0, height: 0 })
  const logicalRef = useRef({ width: 0, height: 0 })

  const measure = useCallback((mode: ResultFit): number => {
    const avail = availRef.current
    const logical = logicalRef.current
    if (logical.width <= 0 || avail.width <= 0) return DEFAULT_ZOOM
    const byWidth = fitToViewZoom(logical.width, avail.width)
    if (mode === 'width') return byWidth
    if (logical.height <= 0 || avail.height <= 0) return byWidth
    // 통째로 담으려면 좁은 쪽에 맞춰야 한다.
    return clampZoom(Math.min(byWidth, fitToViewZoom(logical.height, avail.height)))
  }, [])

  const setFit = useCallback(
    (mode: ResultFit) => {
      fitRef.current = mode
      setFitState(mode)
      if (mode !== 'manual') setZoom(measure(mode))
    },
    [measure],
  )

  const report = useCallback(
    (available: { width: number; height: number }, logical: { width: number; height: number }) => {
      availRef.current = available
      logicalRef.current = logical
      if (fitRef.current !== 'manual') setZoom(measure(fitRef.current))
    },
    [measure],
  )

  const setManual = useCallback((next: number) => {
    fitRef.current = 'manual'
    setFitState('manual')
    setZoom(clampZoom(next))
  }, [])

  const value = useMemo<ResultViewValue>(
    () => ({
      zoom,
      fit,
      stepIn: () => setManual(zoomIn(zoom)),
      stepOut: () => setManual(zoomOut(zoom)),
      resetTo100: () => setManual(1),
      fitWidth: () => setFit('width'),
      fitPage: () => setFit('page'),
      report,
      canZoomIn: zoom < MAX_ZOOM - EPSILON,
      canZoomOut: zoom > MIN_ZOOM + EPSILON,
    }),
    [zoom, fit, setManual, setFit, report],
  )

  return <ResultViewContext.Provider value={value}>{children}</ResultViewContext.Provider>
}

export function useResultView(): ResultViewValue | null {
  return useContext(ResultViewContext)
}
