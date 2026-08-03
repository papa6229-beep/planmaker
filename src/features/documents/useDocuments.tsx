/**
 * Brief library state (기획서 보관함 §6).
 *
 * Owns the list of saved briefs and the one-time import of the old single
 * autosave row. Components read and act through this hook; none of them touch
 * IndexedDB, which stays behind `services/documentStore`.
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
import {
  createDocument,
  deleteDocument,
  duplicateDocument,
  listDocuments,
  migrateSingleAutosave,
  type DocumentSummary,
} from '../../services/documentStore'
import { loadDocument as loadLegacyAutosave } from '../../services/assetStore'
import { createEmptyDocument } from '../../domain/pageSchema'
import { createEmptyProject } from '../../domain/factory'
import { DEFAULT_BRIEF_TITLE } from '../editor/briefEditor'
import type { RequestTeam } from '../../domain/requestTeam'

export interface DocumentsApi {
  /** Saved briefs, most recently edited first. */
  documents: DocumentSummary[]
  /** False until the first listing (and the legacy import) has completed. */
  loaded: boolean
  /** Creates an empty brief — owned by `team` when one is given — and returns its id. */
  createNew: (team?: RequestTeam) => Promise<string>
  /** Copies a brief into an independent new one; returns the copy's id. */
  duplicate: (id: string) => Promise<string | null>
  /** Removes a brief from this browser. Delivered snapshots are untouched. */
  remove: (id: string) => Promise<void>
  /** Re-reads the list (after a save, delivery, or copy). */
  refresh: () => Promise<void>
}

const DocumentsContext = createContext<DocumentsApi | null>(null)

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const startedRef = useRef(false)

  const refresh = useCallback(async () => {
    setDocuments(await listDocuments())
  }, [])

  // Import the legacy single-autosave brief once, then list.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void (async () => {
      try {
        await migrateSingleAutosave(() => loadLegacyAutosave(), Date.now())
      } catch {
        // Leave the flag unset so the next start retries; listing still works.
      }
      try {
        setDocuments(await listDocuments())
      } catch {
        setDocuments([])
      }
      setLoaded(true)
    })()
  }, [])

  const createNew = useCallback(async (team?: RequestTeam) => {
    const project = createEmptyProject(DEFAULT_BRIEF_TITLE)
    // 팀은 게이트에서 한 번 정해지고, 그 뒤로는 기획서가 스스로 지닌다.
    if (team !== undefined) project.requestTeam = team
    const doc = createEmptyDocument(project)
    const id = await createDocument(doc, Date.now())
    await refresh()
    return id
  }, [refresh])

  const duplicate = useCallback(
    async (id: string) => {
      const copyId = await duplicateDocument(id, Date.now())
      await refresh()
      return copyId
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteDocument(id)
      await refresh()
    },
    [refresh],
  )

  const api = useMemo<DocumentsApi>(
    () => ({ documents, loaded, createNew, duplicate, remove, refresh }),
    [documents, loaded, createNew, duplicate, remove, refresh],
  )

  return <DocumentsContext.Provider value={api}>{children}</DocumentsContext.Provider>
}

export function useDocuments(): DocumentsApi {
  const api = useContext(DocumentsContext)
  if (api === null) throw new Error('useDocuments must be used within a DocumentsProvider')
  return api
}
