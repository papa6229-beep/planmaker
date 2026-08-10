/**
 * Vercel 서버 함수 — 이 배포가 어느 갈래인가 (서버 키 Patch).
 *
 * 브라우저가 키를 물을지 암구호를 물을지 정하기 위해 한 번 부른다. 내용은
 * `src/services/accessModeHandler.ts`에 있고, 여기서는 환경변수를 읽어 넘긴다.
 *
 * 환경을 읽는 일이 이 파일들에만 있는 것은 일부러다. 안쪽(`src/services`)이
 * `process.env`를 직접 읽으면, 검사가 검사를 돌리는 사람의 노트북 환경변수에
 * 따라 다른 길로 간다.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleAccessMode } from '../src/services/accessModeHandler.js'
import { readServerEnv } from '../src/services/serverAccess.js'

/** 설명이 객체 바깥에 있는 이유는 `api/generate-image.ts`와 같다. */
export const config = {
  runtime: 'nodejs',
}

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const response = handleAccessMode(readServerEnv(process.env))
  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}
