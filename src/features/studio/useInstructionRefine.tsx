/**
 * AI 지시 다듬기 (실작업 UI 마감 §6, §9, §10).
 *
 * 사람이 쓴 거친 말을 실행 가능한 지시로 바꾸는 텍스트 요청 하나. 이미지를 만들지
 * 않고, 만들라고 시키지도 않는다.
 *
 * 이 provider가 지키는 것은 세 가지다.
 *
 *  - **눌렀을 때만 나간다.** 타이핑에도, 선택에도, 성공 뒤에도 자동으로 나가지
 *    않는다. 한 번 클릭이 한 번 요청이고 자동 재시도는 없다.
 *  - **사람의 글을 대신 덮어쓰지 않는다.** 결과는 제안으로 옆에 놓이고, 적용은
 *    사람이 누른다. 취소하면 아무 일도 없었던 것이 된다.
 *  - **다듬은 뒤 아무것도 시작하지 않는다.** 생성도 부분수정도 사람이 다시 누른다.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'
import { useImageGeneration } from './useImageGeneration'
import { authHeaders } from './apiKeySession'
import { isImageBlock } from '../../domain/blockTypes'
import { BACKGROUND_TARGET_ID, type EditTarget } from '../../domain/editTargets'
import { pageResultOf } from '../../domain/studioJob'
import {
  REFINE_INSTRUCTION_PATH,
  readRefineOutput,
  refineErrorTextFor,
  type RefineImageSlotInfo,
  type RefineRequestBody,
  type RefineSuccess,
  type RefineTargetInput,
  type RefineTextInfo,
} from '../../domain/instructionRefine'
import { getAsset } from '../../services/assetStore'
import { renderPreviewPng } from '../../services/previewRenderer'
import { toAnalysisDataUrl } from '../../services/analysisImage'
import { pageAsEventBrief } from '../../domain/briefMigration'
import { getAllAssets } from '../../services/assetStore'

/** 전체 지시 하나에 대한 제안. */
export interface OverallProposal {
  /** 사람이 쓴 원문 — 제안 옆에 그대로 둔다. */
  original: string
  revised: string
  warnings: string[]
}

/** 대상 하나에 대한 제안. */
export interface TargetProposal {
  targetId: string
  revised: string
  warning?: string
}

export interface InstructionRefineApi {
  // ── 전체 지시 ────────────────────────────────────────────────────────────
  canRefineNote: boolean
  noteBusy: boolean
  noteError: string | null
  noteProposal: OverallProposal | null
  refineNote: () => void
  applyNote: () => void
  dismissNote: () => void

  // ── 대상별 지시 ──────────────────────────────────────────────────────────
  canRefineTargets: boolean
  targetsBusy: boolean
  targetsError: string | null
  proposalFor: (targetId: string) => TargetProposal | null
  hasTargetProposals: boolean
  refineTargets: () => void
  applyTarget: (targetId: string) => void
  applyAllTargets: () => void
  dismissTargets: () => void
}

const RefineContext = createContext<InstructionRefineApi | null>(null)

/** 대상 하나를 요청에 실을 모양으로. 배경은 블록이 아니므로 자기 이름을 쓴다. */
function targetInput(target: EditTarget, instruction: string): RefineTargetInput {
  return {
    blockId: target.blockId ?? target.targetId,
    label: target.label,
    kind: target.kind,
    ...(target.content === undefined ? {} : { content: target.content }),
    ...(target.box === undefined ? {} : { box: target.box }),
    ...(target.productAssetId === undefined ? {} : { hasProduct: true }),
    instruction,
  }
}

export function InstructionRefineProvider({ children }: { children: ReactNode }) {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { getDocument, aiNote, setAiNote, concept, designerNote } = useBriefDocument()

  const [noteBusy, setNoteBusy] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [noteProposal, setNoteProposal] = useState<OverallProposal | null>(null)

  const [targetsBusy, setTargetsBusy] = useState(false)
  const [targetsError, setTargetsError] = useState<string | null>(null)
  /** 대상 키 → 제안. 표시 번호가 아니라 키로 담는다. */
  const [targetProposals, setTargetProposals] = useState<Record<string, TargetProposal>>({})

  /** 요청이 나가 있는 동안은 한 번도 더 나가지 않는다. */
  const runningRef = useRef(false)

  /** 지금 페이지의 사실들 — 두 흐름이 같은 것을 보낸다. */
  const pageFacts = useCallback(() => {
    const doc = getDocument()
    const index = Math.max(0, doc.pages.findIndex((p) => p.id === doc.activePageId))
    const page = doc.pages[index] ?? doc.pages[0]!
    const visible = page.blocks.filter((b) => b.aiVisibility !== 'publishing')

    const texts: RefineTextInfo[] = visible
      .filter((b) => !isImageBlock(b.type) && (b.content ?? '').trim().length > 0)
      .map((b) => ({ blockId: b.id, content: (b.content ?? '').trim(), box: { ...b.position } }))
    const imageSlots: RefineImageSlotInfo[] = visible
      .filter((b) => isImageBlock(b.type))
      .map((b) => ({
        blockId: b.id,
        ...((b.content ?? '').trim().length === 0 ? {} : { description: (b.content ?? '').trim() }),
        box: { ...b.position },
        hasProduct: studio?.job.productImages[b.id] !== undefined,
      }))

    return {
      doc,
      page,
      base: {
        page: {
          title: page.title,
          number: index + 1,
          total: doc.pages.length,
          width: page.canvasWidth,
          height: page.canvasHeight,
        },
        ...(concept.trim().length === 0 ? {} : { concept }),
        ...(designerNote.trim().length === 0 ? {} : { designerNote }),
        texts,
        imageSlots,
        buttons: [] as { blockId: string; text: string }[],
        hasReference: page.reference.assetId !== undefined,
      },
    }
  }, [getDocument, studio, concept, designerNote])

  /**
   * 한 번 부른다. 실패는 사람이 읽는 한 문장으로만 나온다.
   *
   * 서버가 이미 길이와 대상을 확인하지만 여기서 한 번 더 본다. 화면에 붙는 것은
   * 이 값이고, 길거나 어긋난 문장은 **적용하지 않는 것**이 자르는 것보다 낫다
   * (손검수 Patch 1 §6).
   */
  const send = useCallback(
    async (body: RefineRequestBody, allowedBlockIds?: readonly string[]): Promise<RefineSuccess | { error: string }> => {
      // 갈래(자기 키 · 서버 키+암구호)는 `authHeaders`만 안다 (서버 키 Patch).
      const auth = authHeaders()
      if (auth === null) return { error: refineErrorTextFor('missing_api_key') }
      try {
        const response = await fetch(REFINE_INSTRUCTION_PATH, {
          method: 'POST',
          // 자격은 이 요청의 헤더에만 실린다 — 주소에도, 본문에도 없다.
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          const code = (payload as { error?: { code?: string } } | null)?.error?.code
          return { error: refineErrorTextFor(code) }
        }
        const parsed = payload as { scope?: string; result?: unknown } | null
        if (parsed === null || (parsed.scope !== 'overall' && parsed.scope !== 'targets')) {
          return { error: refineErrorTextFor('bad_output') }
        }
        const read = readRefineOutput(
          parsed.scope,
          parsed.result,
          allowedBlockIds === undefined ? {} : { allowedBlockIds },
        )
        if (!read.ok) return { error: refineErrorTextFor(read.code) }
        return read.value
      } catch {
        // 스스로 다시 부르지 않는다. 다음 호출은 사람의 클릭이다.
        return { error: refineErrorTextFor('network_error') }
      }
    },
    [],
  )

  // ── 전체 지시 ──────────────────────────────────────────────────────────────

  const canRefineNote = studio !== null && aiNote.trim().length > 0 && !noteBusy

  const refineNote = useCallback(() => {
    if (runningRef.current || studio === null || aiNote.trim().length === 0) return
    runningRef.current = true
    setNoteBusy(true)
    setNoteError(null)
    setNoteProposal(null)
    const original = aiNote

    void (async () => {
      try {
        const { doc, page, base } = pageFacts()
        // 지금 기획서 페이지를 축소해 함께 보낸다. 실패해도 글만으로 진행한다.
        let previewImage: string | null = null
        try {
          const blobs = new Map((await getAllAssets()).map((a) => [a.id, a.blob]))
          previewImage = await toAnalysisDataUrl(await renderPreviewPng(pageAsEventBrief(doc, page), blobs))
        } catch {
          previewImage = null
        }

        const result = await send({
          scope: 'overall',
          userText: original,
          ...base,
          ...(previewImage === null ? {} : { previewImage }),
        })
        if ('error' in result) {
          setNoteError(result.error)
          return
        }
        if (result.scope !== 'overall') {
          setNoteError(refineErrorTextFor('bad_output'))
          return
        }
        setNoteProposal({ original, revised: result.result.revisedInstruction, warnings: result.result.warnings })
      } finally {
        runningRef.current = false
        setNoteBusy(false)
      }
    })()
  }, [studio, aiNote, pageFacts, send])

  const applyNote = useCallback(() => {
    if (noteProposal === null) return
    setAiNote(noteProposal.revised)
    setNoteProposal(null)
  }, [noteProposal, setAiNote])

  // ── 대상별 지시 ────────────────────────────────────────────────────────────

  const chosen = useMemo(() => {
    if (generation === null) return [] as { target: EditTarget; instruction: string }[]
    return generation.editTargets
      .filter((t) => generation.selectedTargetIds.includes(t.targetId))
      .map((t) => ({ target: t, instruction: generation.instructionFor(t.targetId).trim() }))
      .filter((entry) => entry.instruction.length > 0)
  }, [generation])

  const canRefineTargets = chosen.length > 0 && !targetsBusy

  const refineTargets = useCallback(() => {
    if (runningRef.current || studio === null || generation === null || chosen.length === 0) return
    runningRef.current = true
    setTargetsBusy(true)
    setTargetsError(null)

    void (async () => {
      try {
        const { doc, base } = pageFacts()
        const chosenIds = new Set(chosen.map((c) => c.target.targetId))
        const untouched = generation.editTargets.filter((t) => !chosenIds.has(t.targetId)).map((t) => t.label)

        // 지금 보고 있는 결과를 축소해 함께 보낸다. 없으면 글만으로 진행한다.
        let previewImage: string | null = null
        const current = pageResultOf(studio.job, doc.activePageId)
        if (current !== undefined) {
          const asset = await getAsset(current.assetId)
          if (asset !== undefined) previewImage = await toAnalysisDataUrl(asset.blob)
        }

        const inputs = chosen.map((c) => targetInput(c.target, c.instruction))
        const result = await send(
          {
            scope: 'targets',
            targets: inputs,
            untouched,
            ...base,
            ...(previewImage === null ? {} : { previewImage }),
          },
          inputs.map((t) => t.blockId),
        )
        if ('error' in result) {
          setTargetsError(result.error)
          return
        }
        if (result.scope !== 'targets') {
          setTargetsError(refineErrorTextFor('bad_output'))
          return
        }

        // 돌려받은 blockId를 고른 대상에만 되짚는다. 모르는 id는 버린다 — 어느
        // 대상의 말인지 알 수 없는 문장을 아무 칸에나 넣지 않는다.
        const byBlockId = new Map(chosen.map((c) => [c.target.blockId ?? c.target.targetId, c.target.targetId]))
        const next: Record<string, TargetProposal> = {}
        for (const item of result.result.items) {
          const targetId = byBlockId.get(item.blockId) ?? (item.blockId === BACKGROUND_TARGET_ID ? BACKGROUND_TARGET_ID : undefined)
          if (targetId === undefined) continue
          next[targetId] = {
            targetId,
            revised: item.revisedInstruction,
            ...(item.warning === undefined ? {} : { warning: item.warning }),
          }
        }
        if (Object.keys(next).length === 0) {
          setTargetsError(refineErrorTextFor('bad_output'))
          return
        }
        setTargetProposals(next)
      } finally {
        runningRef.current = false
        setTargetsBusy(false)
      }
    })()
  }, [studio, generation, chosen, pageFacts, send])

  const applyTarget = useCallback(
    (targetId: string) => {
      const proposal = targetProposals[targetId]
      if (proposal === undefined || generation === null) return
      generation.setInstructionFor(targetId, proposal.revised)
      setTargetProposals((all) => {
        const { [targetId]: _applied, ...rest } = all
        return rest
      })
    },
    [targetProposals, generation],
  )

  const applyAllTargets = useCallback(() => {
    if (generation === null) return
    for (const proposal of Object.values(targetProposals)) {
      generation.setInstructionFor(proposal.targetId, proposal.revised)
    }
    setTargetProposals({})
  }, [targetProposals, generation])

  const api = useMemo<InstructionRefineApi | null>(
    () =>
      studio === null
        ? null
        : {
            canRefineNote,
            noteBusy,
            noteError,
            noteProposal,
            refineNote,
            applyNote,
            dismissNote: () => {
              setNoteProposal(null)
              setNoteError(null)
            },
            canRefineTargets,
            targetsBusy,
            targetsError,
            proposalFor: (targetId: string) => targetProposals[targetId] ?? null,
            hasTargetProposals: Object.keys(targetProposals).length > 0,
            refineTargets,
            applyTarget,
            applyAllTargets,
            dismissTargets: () => {
              setTargetProposals({})
              setTargetsError(null)
            },
          },
    [
      studio, canRefineNote, noteBusy, noteError, noteProposal, refineNote, applyNote,
      canRefineTargets, targetsBusy, targetsError, targetProposals, refineTargets, applyTarget, applyAllTargets,
    ],
  )

  return <RefineContext.Provider value={api}>{children}</RefineContext.Provider>
}

/** 작업판 밖(= 작성기 표면)에서는 `null`. */
export function useInstructionRefine(): InstructionRefineApi | null {
  return useContext(RefineContext)
}
