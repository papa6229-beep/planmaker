/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Which surface this deployment exposes (타 팀 배포 §3.2). Absent — the public
   * default — means the brief writer alone; only `studio` opens the internal
   * image-generation screens.
   */
  readonly VITE_PLANMAKER_SURFACE?: 'brief-writer' | 'studio'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
