/**
 * 배포된 함수가 실제로 **켜지는지** 보는 검사.
 *
 * 앞선 실패는 배포가 아니라 호출에서 났다. 배포는 READY였고, 파일도 전부 올라가
 * 있었는데, 첫 호출이 이렇게 죽었다.
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *     '/var/task/src/services/generateImageHandler'
 *
 * 이 저장소는 `"type": "module"`이므로 함수도 ESM으로 돈다. ESM에서 상대경로
 * import는 확장자를 생략할 수 없다 — 번들러가 채워 주던 `.js`를 Node는 채워 주지
 * 않는다. 화면 쪽 빌드는 번들러가 해결해 주기 때문에 끝까지 초록불이었고, 그래서
 * 어떤 기존 검사도 이걸 볼 수 없었다.
 *
 * 그래서 여기서는 함수를 실제로 **빌드해서 실행한다**. 배포와 같은 모듈 방식
 * (`NodeNext`)으로 `api/`의 진입 파일과 거기서 닿는 `src/**`를 한 폴더에 emit하고,
 * 그 옆에 `{"type":"module"}`을 둔 뒤, 나온 파일을 그대로 `import()`한다. Vercel이
 * 만드는 산출물과 같은 배치이고, 여기서 켜지지 않으면 배포에서도 켜지지 않는다.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const REPO_ROOT = resolve(__dirname, '../..')
const ENTRY = join(REPO_ROOT, 'api/generate-image.ts')

/** 배포가 만드는 것과 같은 산출물을 만든다. 반환값은 진입 파일의 경로. */
function buildFunction(): { entryJs: string; diagnostics: ts.Diagnostic[] } {
  const outDir = mkdtempSync(join(tmpdir(), 'fn-build-'))
  const program = ts.createProgram({
    rootNames: [ENTRY],
    options: {
      // 배포와 같은 모듈 해석. 여기서 확장자 없는 상대경로는 오류가 된다.
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      outDir,
      rootDir: REPO_ROOT,
      skipLibCheck: true,
      // 오류가 있어도 emit한다 — 배포도 그렇게 하고, 그래서 실행에서 터졌다.
      noEmitOnError: false,
      esModuleInterop: true,
    },
  })
  const emitResult = program.emit()
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics]

  // 함수 폴더가 ESM으로 돌아간다는 표시. Vercel 산출물도 이 파일을 함께 둔다.
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
  mkdirSync(join(outDir, 'api'), { recursive: true })
  return { entryJs: join(outDir, 'api/generate-image.js'), diagnostics }
}

describe('배포된 함수는 실제로 켜져야 한다', () => {
  it('emits an entry file where the deployment expects one', () => {
    const { entryJs } = buildFunction()
    expect(existsSync(entryJs)).toBe(true)
  })

  it('has no relative import the ESM runtime cannot resolve', () => {
    const { diagnostics } = buildFunction()
    // TS2835 = "Relative import paths need explicit file extensions".
    // 배포 로그에서 경고로 지나갔던 바로 그 진단이다.
    const missingExtension = diagnostics
      .filter((d) => d.code === 2835)
      .map((d) => `${d.file?.fileName ?? '?'}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
    expect(missingExtension).toEqual([])
  })

  /**
   * 산출물은 **진짜 Node에서** 실행한다. 검사 안에서 `import()`하면 vitest의 모듈
   * 파이프라인이 대신 해석해 주기 때문에, 정작 배포가 쓰는 Node의 해석기를
   * 지나가지 않는다 — 그 차이가 이번 실패를 놓친 이유와 같은 종류다.
   */
  it('loads and answers a fake key with a structured 401, in real Node', () => {
    const { entryJs } = buildFunction()
    const outDir = resolve(entryJs, '../..')
    const child = join(outDir, 'run.mjs')

    writeFileSync(
      child,
      `
import { pathToFileURL } from 'node:url'
const entry = await import(pathToFileURL(${JSON.stringify(entryJs)}).href)
if (typeof entry.default !== 'function') throw new Error('entry has no handler')

const { handleGenerateImage } = await import(
  pathToFileURL(${JSON.stringify(join(outDir, 'src/services/generateImageHandler.js'))}).href
)

// 공급자는 호출하지 않는다. 잘못된 키에 OpenAI가 주는 모양만 흉내 내어,
// 배선이 끝까지 이어지는지와 우리 오류 분류가 나오는지를 본다.
const stub = async () =>
  new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'Incorrect API key: ' + KEY } }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_stub_1' },
  })
const KEY = 'sk-fake-not-a-real-key'

const form = new FormData()
form.set('prompt', '테스트 프롬프트')
form.set('size', '832x992')
form.append('images[]', new File([new Uint8Array([137, 80, 78, 71])], '1-page-layout.png', { type: 'image/png' }))

const res = await handleGenerateImage(
  new Request('https://planmaker.local/api/generate-image', {
    method: 'POST',
    headers: { 'X-OpenAI-API-Key': KEY },
    body: form,
  }),
  { requestImage: undefined, fetch: stub },
)
const text = await res.text()
console.log(JSON.stringify({ status: res.status, body: JSON.parse(text), leaked: text.includes(KEY) }))
`,
    )

    const out = execFileSync(process.execPath, [child], { encoding: 'utf8', timeout: 60_000 }).trim()
    const result = JSON.parse(out.split('\n').pop() ?? '{}') as {
      status: number
      body: { error?: { code?: string } }
      leaked: boolean
    }

    expect(result.status).toBe(401)
    expect(result.body.error?.code).toBe('invalid_api_key')
    // 공급자가 되돌려 준 문장에 키가 들어 있어도 우리 응답에는 없다.
    expect(result.leaked).toBe(false)
  }, 120_000)
})
