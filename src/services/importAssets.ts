/**
 * Making an imported archive safe to add to the shared asset pool (v1 동결 §3).
 *
 * Every brief in this browser, and every delivered snapshot, shares one pool of
 * image binaries. Opening a file may therefore only ever *add* to it. The one
 * hazard left is an id collision: two files made on different machines can name
 * different pictures the same thing, and writing the incoming one would replace
 * an image another brief is showing. So a colliding asset takes a fresh id, and
 * the imported document is rewritten to match it.
 */

import { remapAssetIds } from '../domain/pageOps'
import { createId } from '../domain/factory'
import type { BriefDocument } from '../domain/pageSchema'
import { getAsset, type StoredAsset } from './assetStore'

/** The blob's bytes, however this environment lets us read them. */
async function readBytes(blob: Blob): Promise<Uint8Array> {
  // `Blob.arrayBuffer` in the browser; `FileReader` where it is missing (jsdom).
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('이미지를 읽지 못했습니다.'))
    reader.readAsArrayBuffer(blob)
  })
}

/**
 * True when two stored blobs hold the same bytes.
 *
 * Anything that cannot be read counts as *different*: the cost of a wrong
 * "same" is another brief's picture being replaced; the cost of a wrong
 * "different" is one duplicated image.
 */
async function sameBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false
  try {
    const [x, y] = await Promise.all([readBytes(a), readBytes(b)])
    return x.every((byte, i) => byte === y[i])
  } catch {
    return false
  }
}

export interface ResolvedImport {
  /** The document with every reference pointing at the id it will be stored as. */
  doc: BriefDocument
  /** Only the assets that actually need writing — identical ones are reused. */
  assets: StoredAsset[]
  /** Old id → new id, for the assets that had to be renamed. */
  renamed: Map<string, string>
}

/**
 * Resolves an imported document's assets against what is already stored.
 *
 * `lookup` is injectable so this can be tested against real blobs; it defaults
 * to the shared asset store.
 */
export async function resolveAssetCollisions(
  doc: BriefDocument,
  assets: readonly StoredAsset[],
  lookup: (id: string) => Promise<StoredAsset | undefined> = getAsset,
): Promise<ResolvedImport> {
  const renamed = new Map<string, string>()
  const toWrite: StoredAsset[] = []

  for (const incoming of assets) {
    const existing = await lookup(incoming.id)
    if (existing === undefined) {
      toWrite.push(incoming)
      continue
    }
    if (existing.mimeType === incoming.mimeType && (await sameBytes(existing.blob, incoming.blob))) {
      // The very same picture: keep the one already stored, write nothing.
      continue
    }
    const freshId = createId('asset')
    renamed.set(incoming.id, freshId)
    toWrite.push({ ...incoming, id: freshId })
  }

  return { doc: remapAssetIds(doc, renamed), assets: toWrite, renamed }
}
