/**
 * Phase 2 application shell: the 3-column layout (palette · canvas · inspector)
 * plus the top toolbar (WORK_PLAN §6). Wires the editor context and the
 * global Delete/Backspace shortcut for removing the selected block.
 */

import { useEffect } from 'react'
import { BriefEditorProvider, useBriefEditor } from '../features/editor/useBriefEditor'
import { TopToolbar } from '../components/toolbar/TopToolbar'
import { BlockPalette } from '../components/palette/BlockPalette'
import { BriefCanvas } from '../components/canvas/BriefCanvas'
import { PropertiesPanel } from '../components/inspector/PropertiesPanel'

/** True when focus is in a text entry, so Delete must not remove a block. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function DeleteKeyHandler() {
  const { state, deleteBlock } = useBriefEditor()
  const { selectedBlockId } = state

  useEffect(() => {
    if (selectedBlockId === null) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      // Protect text editing: never delete a block while typing (WORK_PLAN §6.6).
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return
      e.preventDefault()
      deleteBlock(selectedBlockId)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedBlockId, deleteBlock])

  return null
}

function Workspace() {
  return (
    <div className="app">
      <TopToolbar />
      <main className="workspace">
        <BlockPalette />
        <BriefCanvas />
        <PropertiesPanel />
      </main>
      <DeleteKeyHandler />
    </div>
  )
}

export function AppShell() {
  return (
    <BriefEditorProvider>
      <Workspace />
    </BriefEditorProvider>
  )
}
