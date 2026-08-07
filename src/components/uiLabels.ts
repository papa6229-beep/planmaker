/**
 * Korean display labels for enum values used across the UI. Kept separate from
 * the domain layer so domain code stays presentation-free.
 *
 * 한때 여기에는 팔레트의 두 상위 묶음, 간소화된 팔레트 구획, 우선순위·AI 노출
 * 라벨이 함께 있었다. 팔레트가 네 갈래 "무엇을 넣을까요?"로 바뀌고 검사기에서
 * 우선순위·노출 설정이 빠지면서 셋 다 부르는 곳이 없어졌다 (훑기 §1). 부르는
 * 곳이 없는 표는 다음 사람에게 "이것도 쓰이는 길이 있다"고 거짓말을 한다.
 */

import type { BlockCategory } from '../domain/blockTypes'

export const CATEGORY_LABELS: Record<BlockCategory, string> = {
  text: '문구',
  image: '이미지',
  structure: '행사정보',
  reference: '참고 / 링크',
}
