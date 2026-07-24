/** Renders all export/import dialogs; each self-gates on the IO state. */
import { ExportValidationDialog } from './ExportValidationDialog'
import { ExportProgress } from './ExportProgress'
import { ImportDialog } from '../import/ImportDialog'

export function EventBriefIoDialogs() {
  return (
    <>
      <ExportValidationDialog />
      <ExportProgress />
      <ImportDialog />
    </>
  )
}
