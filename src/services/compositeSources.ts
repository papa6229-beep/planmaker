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
import { FULL_CONTENT_BOX, type ContentBox } from '../domain/photoBox'
import type { ImageAnalysis } from '../domain/imageAnalysis'

export interface CollectedCompositeSources {
  blobs: Map<string, Blob>
  analyses: Map<string, ImageAnalysis>
  /** 블록 번호 → 종이 모양. 두께가 블록마다 다르므로 자산이 아니라 블록으로 센다. */
  papers: Map<string, PaperCanvas>
  /** 블록 번호 → 알파 내용 상자. 화면과 같은 틀로 앉히기 위한 값 (진단 Patch B). */
  boxes: Map<string, ContentBox>
}

export async function collectCompositeSources(plan: CompositePlan): Promise<CollectedCompositeSources> {
  const blobs = new Map<string, Blob>()
  const analyses = new Map<string, ImageAnalysis>()
  const papers = new Map<string, PaperCanvas>()
  const boxes = new Map<string, ContentBox>()

  for (const assetId of compositeAssetIds(plan)) {
    const asset = await getAsset(assetId)
    if (asset === undefined) continue
    blobs.set(assetId, asset.blob)
    const analysis = await analyzeImageBlob(asset.blob)
    if (analysis !== null) analyses.set(assetId, analysis)
  }

  // 알파 경계는 **모든** 그림에서 잰다. 화면이 그것으로 그림을 앉히므로, 결과가
  // 화면과 같으려면 결과도 같은 값을 알아야 한다 (진단 Patch B).
  for (const layer of plan.layers) {
    const blob = blobs.get(layer.assetId)
    if (blob === undefined) continue
    const measured = await measurePhoto(blob)
    const box = measured?.box ?? FULL_CONTENT_BOX
    boxes.set(layer.blockId, box)
    // 종이는 켠 자리만 만든다. 씨앗은 미리보기와 같은 자산 번호라 두 화면의
    // 외곽선이 같고, 두께는 그 블록이 고른 값이다 (한방 생성 Patch §3).
    if (!layer.effects.paperCutout) continue
    const shape = await buildPaperCanvas(blob, box, layer.assetId, layer.effects.paperWeight)
    if (shape !== null) papers.set(layer.blockId, shape)
  }

  return { blobs, analyses, papers, boxes }
}
