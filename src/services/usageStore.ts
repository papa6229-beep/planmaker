/**
 * 부른 횟수와 토큰을 적어 두는 장부 (사용량 기록 Patch).
 *
 * 작업 자료가 아니다. 그래서 작업 저장소(`event-brief-studio`)와 **다른 테이블**에
 * 둔다 — 작업판 저장소를 비우는 일이 요금 기록까지 지우면, 비운 뒤로 이번 달에
 * 얼마를 썼는지 알 길이 없어진다.
 *
 * `.eventbrief` 파일에도 실리지 않는다. 파일은 남에게 건네는 것이고, 이 장부는
 * 이 브라우저가 얼마를 썼는지에 대한 기록이다.
 *
 * ## 적다가 실패해도 작업은 계속된다
 *
 * `recordCall`은 던지지 않는다. 부르는 쪽은 `void`로 던져 놓고 잊는다 — 장부에
 * 한 줄 못 적었다고 방금 만든 이미지를 잃을 이유가 없다.
 */

import Dexie, { type Table } from 'dexie'
import { USAGE_KEEP, type UsageCall } from '../domain/imageUsage'

interface UsageRow extends UsageCall {
  id?: number
}

class UsageDB extends Dexie {
  calls!: Table<UsageRow, number>

  constructor() {
    super('event-brief-usage')
    this.version(1).stores({ calls: '++id, at' })
  }
}

let dbInstance: UsageDB | null = null

function db(): UsageDB {
  dbInstance ??= new UsageDB()
  return dbInstance
}

/** 검사 이음매 — 한 검사가 연 연결이 다음 검사로 새지 않게 한다. */
export function resetUsageStoreForTests(): void {
  dbInstance = null
}

/**
 * 호출 한 건을 적는다. **실패는 삼킨다.**
 *
 * 오래된 것은 `USAGE_KEEP`만 남기고 앞에서부터 지운다. 장부가 무한히 자라면
 * 브라우저 저장 한도를 작업 자료와 나눠 쓰게 되고, 그러면 기록하려던 것이
 * 기록을 방해한다.
 */
export async function recordCall(call: UsageCall): Promise<void> {
  try {
    const table = db().calls
    await table.add({ ...call })
    const count = await table.count()
    if (count <= USAGE_KEEP) return
    const stale = await table.orderBy('at').limit(count - USAGE_KEEP).primaryKeys()
    await table.bulkDelete(stale)
  } catch {
    // 장부는 작업이 아니다. 못 적어도 방금 만든 것은 그대로 남는다.
  }
}

/** 적어 둔 것 전부, 오래된 것부터. 못 읽으면 빈 목록이다. */
export async function listCalls(): Promise<UsageCall[]> {
  try {
    const rows = await db().calls.orderBy('at').toArray()
    return rows.map(({ id: _id, ...call }) => call)
  } catch {
    return []
  }
}

/** 장부를 비운다. 작업 자료는 건드리지 않는다. */
export async function clearUsage(): Promise<void> {
  try {
    await db().calls.clear()
  } catch {
    // 이미 없는 것과 같다.
  }
}
