/**
 * Work-request context (WORK_PLAN §6, §13, Step 7). Holds the delivered
 * requests in memory (mirrored to the local IndexedDB repository) and exposes
 * the operations the gate, the image-request list, the editor's 전달하기 action,
 * and the request work page all share. There is no server — this is the whole
 * "queue" for the phase.
 *
 * Wraps the whole route tree so every screen sees the same live counts.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { BriefDocument } from '../../domain/pageSchema'
import {
  computeStats,
  createWorkRequest,
  withStatus,
  type RequestStats,
  type WorkRequest,
  type WorkRequestStatus,
} from '../../domain/workRequest'
import { createId } from '../../domain/factory'
import { listRequests, putRequest } from '../../services/requestStore'

export interface RequestsApi {
  requests: WorkRequest[]
  stats: RequestStats
  loaded: boolean
  getRequest: (id: string | undefined) => WorkRequest | undefined
  /** Creates a submitted request from a document snapshot; returns its id. */
  submit: (doc: BriefDocument, now: string) => Promise<WorkRequest>
  setStatus: (id: string, status: WorkRequestStatus, now: string) => Promise<void>
  /** Persists the design team's working copy without touching the snapshot. */
  saveWorkingDoc: (id: string, doc: BriefDocument, now: string) => Promise<void>
}

const RequestsContext = createContext<RequestsApi | null>(null)

export function RequestsProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<WorkRequest[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listRequests()
      .then((rows) => {
        if (!cancelled) setRequests(rows)
      })
      .catch(() => {
        // ignore: start with an empty queue if IndexedDB is unavailable
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const upsert = useCallback((req: WorkRequest) => {
    setRequests((prev) => {
      const without = prev.filter((r) => r.id !== req.id)
      return [req, ...without].toSorted((a, b) => (a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0))
    })
  }, [])

  const submit = useCallback<RequestsApi['submit']>(
    async (doc, now) => {
      const req = createWorkRequest(createId('req'), doc, now)
      await putRequest(req)
      upsert(req)
      return req
    },
    [upsert],
  )

  const setStatus = useCallback<RequestsApi['setStatus']>(
    async (id, status, now) => {
      const current = requests.find((r) => r.id === id)
      if (!current) return
      const next = withStatus(current, status, now)
      await putRequest(next)
      upsert(next)
    },
    [requests, upsert],
  )

  const saveWorkingDoc = useCallback<RequestsApi['saveWorkingDoc']>(
    async (id, doc, now) => {
      const current = requests.find((r) => r.id === id)
      if (!current) return
      const next: WorkRequest = { ...current, workingDoc: doc, updatedAt: now }
      await putRequest(next)
      upsert(next)
    },
    [requests, upsert],
  )

  const api = useMemo<RequestsApi>(
    () => ({
      requests,
      stats: computeStats(requests),
      loaded,
      getRequest: (id) => (id === undefined ? undefined : requests.find((r) => r.id === id)),
      submit,
      setStatus,
      saveWorkingDoc,
    }),
    [requests, loaded, submit, setStatus, saveWorkingDoc],
  )

  return <RequestsContext.Provider value={api}>{children}</RequestsContext.Provider>
}

export function useRequests(): RequestsApi {
  const api = useContext(RequestsContext)
  if (api === null) throw new Error('useRequests must be used within a RequestsProvider')
  return api
}
