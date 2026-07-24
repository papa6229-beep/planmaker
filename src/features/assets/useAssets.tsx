/**
 * Asset runtime (WORK_PLAN §11, §16). Owns the image binaries that must NOT
 * live in the reducer's serializable state:
 *  - persists each uploaded blob to IndexedDB (transparency / GIF bytes intact),
 *  - keeps an id → objectURL map for display,
 *  - creates or assigns image blocks via the editor.
 *
 * Must be rendered inside <BriefEditorProvider>.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useBriefEditor } from '../editor/useBriefEditor'
import { createId } from '../../domain/factory'
import type { Asset, ImageMimeType } from '../../domain/briefSchema'
import { baseName, isAcceptedImage, isAcceptedMime, readImageSize } from './imageUtils'
import { getAllAssets, putAsset } from '../../services/assetStore'

export interface UploadOptions {
  /** Assign the first image to this block; extra images become new blocks. */
  targetBlockId?: string
  /** Canvas-space drop point for the first newly-created block. */
  position?: { x: number; y: number }
}

export interface AssetsApi {
  /** Live object URLs keyed by asset id. */
  urls: Record<string, string>
  getUrl: (assetId: string | undefined) => string | undefined
  uploadFiles: (files: Iterable<File>, options?: UploadOptions) => Promise<number>
  /**
   * Stores an image binary and returns its Asset metadata WITHOUT creating a
   * block (WORK_PLAN §8.2). Used for page-level reference images, which are
   * auxiliary assets, not output blocks. Returns null if the file is rejected.
   */
  storeImage: (file: File) => Promise<Asset | null>
  loadFromStore: () => Promise<void>
}

const AssetsContext = createContext<AssetsApi | null>(null)

function makeObjectUrl(blob: Blob): string | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  return URL.createObjectURL(blob)
}

function revokeUrl(url: string | undefined): void {
  if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url)
  }
}

export function AssetsProvider({ children }: { children: ReactNode }) {
  const { assignImage, addImageBlock } = useBriefEditor()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const urlsRef = useRef(urls)
  urlsRef.current = urls

  const addUrl = useCallback((assetId: string, blob: Blob) => {
    const url = makeObjectUrl(blob)
    if (url) setUrls((prev) => ({ ...prev, [assetId]: url }))
  }, [])

  const uploadFiles = useCallback<AssetsApi['uploadFiles']>(
    async (files, options = {}) => {
      const accepted = Array.from(files).filter(isAcceptedImage)
      let index = 0
      for (const file of accepted) {
        if (!isAcceptedMime(file.type)) continue
        const mime: ImageMimeType = file.type
        const id = createId('asset')
        const size = await readImageSize(file)

        const asset: Asset = { id, fileName: file.name, mimeType: mime, byteSize: file.size }
        if (size) {
          asset.width = size.width
          asset.height = size.height
        }

        await putAsset({
          id,
          blob: file,
          fileName: file.name,
          mimeType: mime,
          byteSize: file.size,
          ...(size ? { width: size.width, height: size.height } : {}),
        })
        addUrl(id, file)

        const image = { productName: baseName(file.name) }
        if (index === 0 && options.targetBlockId !== undefined) {
          assignImage(options.targetBlockId, asset, image)
        } else if (index === 0 && options.position) {
          addImageBlock(asset, options.position, image)
        } else {
          addImageBlock(asset, undefined, image)
        }
        index += 1
      }
      return index
    },
    [assignImage, addImageBlock, addUrl],
  )

  const storeImage = useCallback<AssetsApi['storeImage']>(async (file) => {
    if (!isAcceptedImage(file) || !isAcceptedMime(file.type)) return null
    const mime: ImageMimeType = file.type
    const id = createId('asset')
    const size = await readImageSize(file)

    const asset: Asset = { id, fileName: file.name, mimeType: mime, byteSize: file.size }
    if (size) {
      asset.width = size.width
      asset.height = size.height
    }
    await putAsset({
      id,
      blob: file,
      fileName: file.name,
      mimeType: mime,
      byteSize: file.size,
      ...(size ? { width: size.width, height: size.height } : {}),
    })
    addUrl(id, file)
    return asset
  }, [addUrl])

  const loadFromStore = useCallback<AssetsApi['loadFromStore']>(async () => {
    const stored = await getAllAssets()
    const next: Record<string, string> = {}
    for (const s of stored) {
      const url = makeObjectUrl(s.blob)
      if (url) next[s.id] = url
    }
    // Revoke any previous URLs before replacing the map.
    for (const url of Object.values(urlsRef.current)) revokeUrl(url)
    setUrls(next)
  }, [])

  // Revoke all object URLs on unmount to avoid leaks.
  useEffect(() => {
    return () => {
      for (const url of Object.values(urlsRef.current)) revokeUrl(url)
    }
  }, [])

  const api = useMemo<AssetsApi>(
    () => ({
      urls,
      getUrl: (assetId) => (assetId === undefined ? undefined : urls[assetId]),
      uploadFiles,
      storeImage,
      loadFromStore,
    }),
    [urls, uploadFiles, storeImage, loadFromStore],
  )

  return <AssetsContext.Provider value={api}>{children}</AssetsContext.Provider>
}

export function useAssets(): AssetsApi {
  const api = useContext(AssetsContext)
  if (api === null) {
    throw new Error('useAssets must be used within an AssetsProvider')
  }
  return api
}
