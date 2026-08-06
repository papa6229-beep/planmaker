/**
 * 합성 계획이 요구하는 그림들을 모은다 (배경 합성 1차 §9, 한방 생성 Patch §2).
 *
 * 두 길이 같은 것을 필요로 한다 — 작업자가 넣은 배경 위에 원본을 얹는 길과,
 * AI가 만든 완성 플레이트 위에 컷아웃만 얹는 길. 모으는 규칙이 두 벌이면 한쪽만
 * 고쳐지고, 그러면 미리보기와 결과의 종이 외곽선이 조용히 갈라진다.
 *
 * **읽기만 한다.** 여기서 자산을 다시 쓰는 자리는 없다.
 */

import { getAsset } from './assetStore'
import { analyzeImageBlob } from './imageAnalysisRunner'
import { measurePhoto } from './photoContent'
import { buildPaperCanvas, type PaperCanvas } from './paperCutoutShape'
import { compositeAssetIds, type CompositePlan } from '../domain/composite'
import type { ImageAnalysis } from '../domain/imageAnalysis'

export interface CollectedCompositeSources {
  blobs: Map<string, Blob>
  analyses: Map<string, ImageAnalysis>
  /** 블록 번호 → 종이 모양. 두께가 블록마다 다르므로 자산이 아니라 블록으로 센다. */
  papers: Map<string, PaperCanvas>
}

/** 알파 경계를 재지 못했을 때 — 그림 전체를 내용으로 본다. */
const FULL_BOX = { x: 0, y: 0, width: 1, height: 1 }

export async function collectCompositeSources(plan: CompositePlan): Promise<CollectedCompositeSources> {
  const blobs = new Map<string, Blob>()
  const analyses = new Map<string, ImageAnalysis>()
  const papers = new Map<string, PaperCanvas>()

  for (const assetId of compositeAssetIds(plan)) {
    const asset = await getAsset(assetId)
    if (asset === undefined) continue
    blobs.set(assetId, asset.blob)
    const analysis = await analyzeImageBlob(asset.blob)
    if (analysis !== null) analyses.set(assetId, analysis)
  }

  // 종이 컷아웃을 켠 자리만 모양을 만든다. 씨앗은 미리보기와 같은 자산 번호라
  // 두 화면의 외곽선이 같고, 두께는 그 블록이 고른 값이다 (한방 생성 Patch §3).
  for (const layer of plan.layers) {
    if (!layer.effects.paperCutout) continue
    const blob = blobs.get(layer.assetId)
    if (blob === undefined) continue
    const measured = await measurePhoto(blob)
    const shape = await buildPaperCanvas(
      blob,
      measured?.box ?? FULL_BOX,
      layer.assetId,
      layer.effects.paperWeight,
    )
    if (shape !== null) papers.set(layer.blockId, shape)
  }

  return { blobs, analyses, papers }
}
