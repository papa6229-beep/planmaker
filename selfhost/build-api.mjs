/**
 * PLANMAKER self-host — API 함수 빌드.
 *
 * `api/*.ts`와 거기서 닿는 `src/**`를 배포와 같은 모듈 방식(`NodeNext`)으로
 * `dist-ssr/`에 emit한다. Vercel이 함수를 만드는 방식과 같다
 * (`src/app/vercelFunctionBundle.test.ts`가 같은 방식으로 산출물을 검사한다).
 *
 * `dist-ssr/`는 이미 `.gitignore`에 있다.
 *
 * 사용: node selfhost/build-api.mjs
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'dist-ssr')
const API_SRC = path.join(ROOT, 'api')

const entries = readdirSync(API_SRC)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
  .map((file) => path.join(API_SRC, file))

if (entries.length === 0) {
  console.error(`[build-api] api/ 폴더에 함수가 없습니다: ${API_SRC}`)
  process.exit(1)
}

rmSync(OUT, { recursive: true, force: true })

const program = ts.createProgram({
  rootNames: entries,
  options: {
    // 배포와 같은 모듈 해석. 확장자 없는 상대경로는 여기서 오류가 된다.
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    outDir: OUT,
    rootDir: ROOT,
    skipLibCheck: true,
    esModuleInterop: true,
    // 타입 오류가 있어도 emit한다 — 배포 빌드도 그렇게 한다. 타입 검사는
    // `npm run build`(tsc -b)가 따로 맡는다.
    noEmitOnError: false,
  },
})
const emitted = program.emit()

mkdirSync(OUT, { recursive: true })
// 함수 폴더가 ESM으로 돈다는 표시. 폴더를 통째로 옮겨도 그대로 켜지게 둔다.
writeFileSync(path.join(OUT, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`)

const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]
if (diagnostics.length > 0) {
  const host = {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => ROOT,
    getNewLine: () => '\n',
  }
  console.warn(`[build-api] TypeScript 진단 ${diagnostics.length}건 (emit은 계속함). 앞의 5건:`)
  console.warn(ts.formatDiagnostics(diagnostics.slice(0, 5), host))
}

const missing = entries
  .map((entry) => path.join(OUT, 'api', `${path.basename(entry, '.ts')}.js`))
  .filter((file) => !existsSync(file))
if (missing.length > 0) {
  console.error(`[build-api] 함수 파일이 만들어지지 않았습니다:\n${missing.join('\n')}`)
  process.exit(1)
}

console.log(
  `[build-api] ${entries.length}개 함수 → ${path.relative(ROOT, path.join(OUT, 'api'))}: ` +
    entries.map((entry) => path.basename(entry, '.ts')).join(', '),
)
