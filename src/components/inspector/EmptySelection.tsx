/** Shown in the right panel when no block is selected (WORK_PLAN §6). */
export function EmptySelection() {
  return (
    <div className="inspector__empty">
      <p className="inspector__empty-title">선택된 블록이 없습니다</p>
      <p className="inspector__empty-body">
        캔버스에서 블록을 클릭하면 내용·중요도·필수 여부·AI 전달 여부를 편집할 수 있습니다.
      </p>
    </div>
  )
}
