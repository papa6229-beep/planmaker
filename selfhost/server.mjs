/**
 * PLANMAKER self-host 서버.
 *
 * Vercel 없이 Node 프로세스 하나로 두 가지를 낸다.
 *
 *  - 화면: `dist/`(Vite 빌드 결과). `vercel.json`의 rewrite와 같은 규칙으로,
 *    `/api/`가 아닌 주소는 파일이 없으면 앱 화면(`index.html`)을 돌려준다.
 *  - 서버 함수: `dist-ssr/api/*.js`(selfhost/build-api.mjs 결과). Vercel이 부르던
 *    그 함수를 **고치지 않고** 그대로 `(req, res)`로 부른다.
 *
 * ## 시간 제한을 새로 만들지 않는다
 *
 * 이미지 한 장이 몇 분씩 걸린다. 그 사이 어디서든 끊기면 그림은 서버에서 만들어지고
 * 화면에는 실패만 남는다. 그래서 이 파일에서 두 자리를 연다.
 *
 *  1. Node HTTP 서버의 요청 시간 제한(`requestTimeout`, 기본 300초)을 끈다.
 *  2. Node에 내장된 `fetch`는 응답 헤더를 **300초까지만** 기다린다. 어댑터는 그림이
 *     다 만들어진 뒤에야 헤더를 보내므로, 긴 생성이 이 자리에서 끊긴다. 그래서
 *     `http:` 주소(같은 기계의 어댑터)로 나가는 호출만 제한 없는 `node:http`로
 *     보낸다. `https:`(OpenAI 지시 다듬기)는 내장 `fetch` 그대로다.
 *
 * 남는 상한은 PLANMAKER가 원래 가진 설정 하나뿐이다 — `LOCAL_IMAGE_TIMEOUT_MS`.
 *
 * ## 실행
 *
 *   VITE_PLANMAKER_SURFACE=studio npm run build   → dist/
 *   node selfhost/build-api.mjs                   → dist-ssr/api/
 *   node --env-file=/etc/planmaker/planmaker.env selfhost/server.mjs
 *
 * 자세한 순서는 selfhost/README.md.
 */

import http from 'node:http'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOST = process.env.HOST || '0.0.0.0'
const PORT = Number(process.env.PORT || 3000)
const STATIC_DIR = path.resolve(process.env.PLANMAKER_STATIC_DIR || path.join(ROOT, 'dist'))
const API_DIR = path.resolve(process.env.PLANMAKER_API_DIR || path.join(ROOT, 'dist-ssr', 'api'))

// ── 어댑터 호출: 응답 대기 제한 없는 fetch ─────────────────────────────────

const nativeFetch = globalThis.fetch.bind(globalThis)

function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('This operation was aborted', 'AbortError')
}

/**
 * `http:` 주소만 `node:http`로 보낸다. 본문은 플랫폼이 직접 인코딩한다 —
 * `FormData`는 `new Response(form)`이 경계(boundary)까지 붙인 multipart로 바꾼다.
 * 그 밖의 호출(https, Request 객체)은 내장 fetch로 넘긴다.
 */
async function fetchWithoutWaitLimit(input, init = {}) {
  if (input instanceof Request) return nativeFetch(input, init)
  const url = new URL(String(input))
  if (url.protocol !== 'http:') return nativeFetch(input, init)

  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  const signal = init.signal ?? undefined

  let body
  if (init.body !== undefined && init.body !== null && method !== 'GET' && method !== 'HEAD') {
    const encoded = new Response(init.body)
    body = Buffer.from(await encoded.arrayBuffer())
    const type = encoded.headers.get('content-type')
    if (type !== null && !headers.has('content-type')) headers.set('content-type', type)
    headers.set('content-length', String(body.length))
  }

  return await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const outgoing = http.request(url, { method, headers: Object.fromEntries(headers) }, (incoming) => {
      const chunks = []
      incoming.on('data', (chunk) => chunks.push(chunk))
      incoming.on('error', reject)
      incoming.on('end', () => {
        const responseHeaders = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue
          if (Array.isArray(value)) for (const v of value) responseHeaders.append(name, v)
          else responseHeaders.set(name, value)
        }
        const status = incoming.statusCode ?? 502
        const noBody = status === 204 || status === 205 || status === 304
        try {
          resolve(
            new Response(noBody ? null : Buffer.concat(chunks), {
              status,
              statusText: incoming.statusMessage ?? '',
              headers: responseHeaders,
            }),
          )
        } catch (err) {
          reject(err)
        }
      })
    })
    // 소켓이 오래 조용해도 끊지 않는다 — 어댑터는 그림이 끝날 때까지 말이 없다.
    outgoing.setTimeout(0)
    outgoing.on('error', (err) => reject(signal?.aborted ? abortError(signal) : err))
    signal?.addEventListener(
      'abort',
      () => {
        outgoing.destroy()
        reject(abortError(signal))
      },
      { once: true },
    )
    outgoing.end(body)
  })
}

globalThis.fetch = fetchWithoutWaitLimit

// ── 서버 함수 ──────────────────────────────────────────────────────────────

const apiHandlers = new Map()

async function loadApiHandlers() {
  if (!existsSync(API_DIR)) {
    throw new Error(`API 빌드가 없습니다: ${API_DIR}\n먼저 실행: node selfhost/build-api.mjs`)
  }
  for (const file of readdirSync(API_DIR)) {
    if (!file.endsWith('.js')) continue
    const mod = await import(pathToFileURL(path.join(API_DIR, file)).href)
    if (typeof mod.default === 'function') apiHandlers.set(file.slice(0, -'.js'.length), mod.default)
  }
  if (apiHandlers.size === 0) throw new Error(`API 함수를 하나도 찾지 못했습니다: ${API_DIR}`)
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('content-length', Buffer.byteLength(text))
  res.end(text)
}

async function serveApi(req, res, name) {
  const handler = apiHandlers.get(name)
  if (handler === undefined) {
    sendJson(res, 404, { error: { code: 'not_found', message: '없는 API 주소입니다.' } })
    return
  }
  try {
    await handler(req, res)
  } catch (err) {
    console.error(`[selfhost] /api/${name} 처리 중 예외:`, err)
    if (!res.headersSent) sendJson(res, 500, { error: { code: 'unknown', message: '서버 오류가 발생했습니다.' } })
    else res.destroy()
  }
}

// ── 화면 ───────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

function serveFile(req, res, filePath) {
  const relative = path.relative(STATIC_DIR, filePath).split(path.sep).join('/')
  res.statusCode = 200
  res.setHeader('content-type', MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('content-length', statSync(filePath).size)
  // 빌드마다 이름이 바뀌는 파일만 오래 둔다. 앱 화면은 매번 새로 확인한다.
  res.setHeader('cache-control', relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath)
    .on('error', () => res.destroy())
    .pipe(res)
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('allow', 'GET, HEAD')
    res.end()
    return
  }
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    res.statusCode = 400
    res.end()
    return
  }
  const candidate = path.resolve(STATIC_DIR, `.${decoded}`)
  const inside = candidate === STATIC_DIR || candidate.startsWith(STATIC_DIR + path.sep)
  if (inside && existsSync(candidate) && statSync(candidate).isFile()) {
    serveFile(req, res, candidate)
    return
  }
  // 확장자가 있는 파일 주소가 없으면 404다. 앱 화면을 JS 자리에 돌려주면
  // 브라우저가 HTML을 스크립트로 읽다가 알 수 없는 오류를 낸다.
  const ext = path.extname(decoded)
  if (ext !== '' && ext !== '.html') {
    res.statusCode = 404
    res.end()
    return
  }
  // vercel.json과 같은 규칙: `/api/`가 아닌 나머지 주소는 앱 화면으로 간다.
  serveFile(req, res, path.join(STATIC_DIR, 'index.html'))
}

// ── 시작 ───────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const started = Date.now()
  let pathname
  try {
    pathname = new URL(req.url ?? '/', 'http://selfhost.local').pathname
  } catch {
    res.statusCode = 400
    res.end()
    return
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const name = pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '')
    // 요청 한 줄 기록. 헤더·본문·키는 남기지 않는다.
    res.on('finish', () => {
      console.log(`${new Date().toISOString()} ${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`)
    })
    void serveApi(req, res, name)
    return
  }
  serveStatic(req, res, pathname)
})

// 요청 시간 제한을 두지 않는다 (위 설명 1).
server.requestTimeout = 0
server.timeout = 0

await loadApiHandlers()
if (!existsSync(path.join(STATIC_DIR, 'index.html'))) {
  throw new Error(`화면 빌드가 없습니다: ${STATIC_DIR}\n먼저 실행: VITE_PLANMAKER_SURFACE=studio npm run build`)
}

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'PLANMAKER_ACCESS_CODE',
  'IMAGE_PROVIDER',
  'LOCAL_IMAGE_API_URL',
  'LOCAL_IMAGE_API_KEY',
  'LOCAL_IMAGE_TIMEOUT_MS',
  'LOCAL_IMAGE_MODEL',
]

server.listen(PORT, HOST, () => {
  console.log(`[selfhost] PLANMAKER http://${HOST}:${PORT}/studio`)
  console.log(`[selfhost] API: ${[...apiHandlers.keys()].map((name) => `/api/${name}`).join(', ')}`)
  // 값은 찍지 않는다. 있는지 없는지만.
  console.log(
    `[selfhost] env: ${ENV_KEYS.map((key) => `${key}=${(process.env[key] ?? '').trim() === '' ? 'missing' : 'set'}`).join(' ')}`,
  )
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[selfhost] ${signal} — 종료합니다`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
