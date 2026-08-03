/**
 * Vercel 서버 함수 — 이미지 생성 한 건 (1단계 §9).
 *
 * 브라우저가 OpenAI를 직접 부르지 않게 하는 것이 이 파일의 유일한 존재 이유다.
 * 내용은 전부 `src/services/generateImageHandler.ts`에 있고, 여기서는 Node의
 * 요청을 표준 `Request` 한 개로 바꿔 넘긴 뒤 그 응답을 다시 풀어 쓴다. 그래야
 * 생성 로직을 Vercel 없이 그대로 검사할 수 있다.
 *
 * 표준 `Request`로 바꾸는 이유는 multipart 파싱 때문이다. Node 18부터
 * `Request.formData()`가 multipart를 읽으므로, 파싱 라이브러리를 하나 더 들이지
 * 않아도 된다.
 *
 * 키는 이 요청의 `X-OpenAI-API-Key` 헤더에서만 온다. 환경변수를 읽지 않으므로
 * 배포 설정에 키를 등록할 필요가 없고, 저장소에도 키가 남지 않는다.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleGenerateImage } from '../src/services/generateImageHandler'

export const config = {
  runtime: 'nodejs',
  /**
   * 이미지 생성은 수십 초가 걸린다. 기본 실행시간이면 성공한 생성이 시간 초과로
   * 버려질 수 있어 넉넉히 잡는다. 이 값이 현재 요금제에서 실제로 허용되는
   * 상한인지는 배포 전에 확인하지 못했다.
   */
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

  const response = await handleGenerateImage(toRequest(req, Buffer.concat(chunks)), {
    log: (entry) => {
      // 키도, 공급자 원문도 없다. 조사에 필요한 것만.
      console.error('[generate-image]', JSON.stringify(entry))
    },
  })

  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}
