/**
 * Image input helpers (WORK_PLAN §11). Accepts PNG/JPG/WEBP/GIF, preserves the
 * original filename, and keeps binary bytes intact (so transparency and GIF
 * animation survive). Pure/DOM-light so most of it is unit-testable.
 */

import type { ImageMimeType } from '../../domain/briefSchema'

export const ACCEPTED_MIME_TYPES: readonly ImageMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

const ACCEPTED = new Set<string>(ACCEPTED_MIME_TYPES)

/** True when the file is a supported image type. */
export function isAcceptedImage(file: { type: string }): boolean {
  return ACCEPTED.has(file.type)
}

export function isAcceptedMime(mime: string): mime is ImageMimeType {
  return ACCEPTED.has(mime)
}

/** Filename without its extension, for a default product name. */
export function baseName(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'))
  const name = slash >= 0 ? fileName.slice(slash + 1) : fileName
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export interface ImageSize {
  width: number
  height: number
}

/**
 * Reads an image's intrinsic size by decoding it in the browser. Resolves null
 * if decoding is unavailable (e.g. jsdom) or fails, so callers can proceed
 * without dimensions.
 */
export function readImageSize(blob: Blob): Promise<ImageSize | null> {
  return new Promise((resolve) => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Image === 'undefined') {
      resolve(null)
      return
    }
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.addEventListener(
      'load',
      () => {
        const size: ImageSize = { width: img.naturalWidth, height: img.naturalHeight }
        URL.revokeObjectURL(url)
        resolve(img.naturalWidth > 0 ? size : null)
      },
      { once: true },
    )
    img.addEventListener(
      'error',
      () => {
        URL.revokeObjectURL(url)
        resolve(null)
      },
      { once: true },
    )
    img.src = url
  })
}

/** Pulls image files out of a clipboard paste event, if any. */
export function imageFilesFromClipboard(items: DataTransferItemList | null | undefined): File[] {
  if (!items) return []
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && ACCEPTED.has(item.type)) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  return files
}
