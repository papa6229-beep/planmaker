/**
 * 쓰기 하나를 감싸 성공·실패를 알린다 (저장 실패 알리기 Patch).
 *
 * 저장 경로마다 try/catch 를 흩뿌리는 대신 저장소 함수 하나를 감싼다. 새 저장
 * 경로가 생겨도 그 경로가 여기를 지나가면 배선을 따로 하지 않아도 된다 —
 * 빠뜨릴 수 있는 배선을 아예 만들지 않는 쪽이 낫다.
 *
 * 실패는 **삼키지 않는다**. 알리기만 하고 그대로 다시 던진다. 이미 실패를 보고
 * 판단하는 자리들이 있고(생성 결과 저장, 파일 채택), 그 판단을 여기서 조용히
 * 없애면 알림 하나를 얻고 그보다 중요한 것을 잃는다.
 */

import { reportSaveFailed, reportSaveOk } from './saveHealthStore'
import type { SaveTarget } from '../domain/saveHealth'

export async function watchSave<T>(target: SaveTarget, now: number, write: () => Promise<T>): Promise<T> {
  try {
    const result = await write()
    reportSaveOk()
    return result
  } catch (err) {
    reportSaveFailed(target, err, now)
    throw err
  }
}
