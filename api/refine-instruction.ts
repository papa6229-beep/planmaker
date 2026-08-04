/**
 * Vercel 서버 함수 — 지시 다듬기 한 건 (실작업 UI 마감 §7).
 *
 * 브라우저가 OpenAI를 직접 부르지 않게 하는 것이 이 파일의 유일한 존재 이유다.
 * 내용은 전부 `src/services/refineInstructionHandler.ts`에 있고, 여기서는 Node의
 * 요청을 표준 `Request` 한 개로 바꿔 넘긴 뒤 그 응답을 다시 풀어 쓴다.
 *
 * 이미지 함수와 달리 본문은 JSON 한 덩어리다 — 이미지는 분석용 축소본 한 장이
 * data URL로 그 안에 들어 있고, 원본 자산은 여기까지 오지 않는다.
 *
 * 키는 이 요청의 `X-OpenAI-API-Key` 헤더에서만 온다. 환경변수를 읽지 않으므로
 * 배포 설정에 키를 등록할 필요가 없고, 저장소에도 키가 남지 않는다.
 *
 * 상대경로 import에 `.js`가 붙어 있는 것은 취향이 아니라 조건이다. 이 저장소는
 * `"type": "module"`이고, ESM 런타임은 확장자를 채워 주지 않는다 — 빼면 배포는
 * READY인 채로 첫 호출이 `ERR_MODULE_NOT_FOUND`로 죽는다.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleRefineInstruction } from '../src/services/refineInstructionHandler.js'

/**
 * 배포 설정.
 *
 * `maxDuration`: 추론 강도를 높게 쓰므로 응답이 수십 초 걸릴 수 있다. 기본
 * 실행시간이면 끝난 요청이 시간 초과로 버려질 수 있어 넉넉히 잡는다.
 *
 * 설명이 객체 **바깥**에 있는 것도 조건이다. Vercel은 이 객체를 정적으로 읽는데,
 * 그 파서는 속성 하나를 "이름·콜론·값" 세 조각으로 가정하고 자른다. 속성 바로
 * 위에 `/** … *\/` 주석이 붙으면 조각이 하나 늘어 값 자리에 콜론이 들어앉고,
 * 배포가 `Unhandled type: "ColonToken"`으로 죽는다.
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
}

function toRequest(req: IncomingMessage, body: Buffer): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const v of value) headers.append(name, v)
    else headers.set(name, value)
  }
  const method = req.method ?? 'GET'
  // 주소는 이 함수 안에서만 쓰이고 밖으로 나가지 않는다.
  return new Request(`https://planmaker.local${req.url ?? '/'}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
  })
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)

  const response = await handleRefineInstruction(toRequest(req, Buffer.concat(chunks)), {
    log: (entry) => {
      // 키도, 공급자 원문도 없다. 조사에 필요한 것만.
      console.error('[refine-instruction]', JSON.stringify(entry))
    },
  })

  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}
