/**
 * 만든 이미지를 파일로 내놓는 일 (실작업 UI 마감 §5).
 *
 * 여기서 이미지를 새로 만들지 않는다. 자산 저장소에 있는 840px 작업본을 꺼내
 * 그대로 내놓을 뿐이다 — 다시 그리면 이미 값을 치른 그림이 한 번 더 손상되고,
 * 모델을 다시 부르면 없어도 될 결제가 생긴다.
 *
 * 압축은 기획서 파일이 이미 쓰고 있는 JSZip을 그대로 쓴다. 이미지 저장 하나 때문에
 * 새 의존성을 들이지 않는다.
 */

import JSZip from 'jszip'
import { getAsset } from './assetStore'
import type { ImageSavePlan } from '../domain/imageSaveFile'

export interface SavedImageFile {
  fileName: string
  blob: Blob
}

/** 자산 저장소에서 계획대로 꺼낸다. 없는 자산은 조용히 빠지지 않고 실패한다. */
export async function collectSavedImages(plan: ImageSavePlan): Promise<SavedImageFile[]> {
  const files: SavedImageFile[] = []
  for (const file of plan.files) {
    const asset = await getAsset(file.assetId)
    if (asset === undefined) throw new Error('저장할 이미지를 찾지 못했습니다.')
    files.push({ fileName: file.fileName, blob: asset.blob })
  }
  return files
}

/** 여러 장을 한 묶음으로. 이름과 순서는 계획 그대로다. */
export async function zipSavedImages(files: readonly SavedImageFile[]): Promise<Blob> {
  const zip = new JSZip()
  for (const file of files) zip.file(file.fileName, file.blob)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
