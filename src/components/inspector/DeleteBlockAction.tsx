/** Delete control for the currently-selected block (WORK_PLAN §6.3). */
import { useBriefEditor } from '../../features/editor/useBriefEditor'

export function DeleteBlockAction({ blockId }: { blockId: string }) {
  const { deleteBlock } = useBriefEditor()
  return (
    <button
      type="button"
      className="btn btn--danger inspector__delete"
      onClick={() => deleteBlock(blockId)}
    >
      블록 삭제
    </button>
  )
}
