/**
 * 배너에서 무엇이 버티고 무엇이 물러나는가 (배너 Patch §2).
 *
 * 세 이벤트의 배너 열다섯 장을 나란히 놓고 읽은 것을 표로 옮긴 것이다. 규격별
 * 규칙은 **적지 않는다** — "1020×70에서는 기간을 뺀다" 같은 것은 이벤트마다
 * 달랐고(첫 이벤트는 840×640에 기간을 넣었고 둘째는 뺐다), 앞으로도 달라진다.
 *
 * 대신 블록마다 둘만 적는다.
 *
 *  - **중요도** — 자리가 모자랄 때 얼마나 오래 버티는가.
 *  - **양보 방식** — 안 들어갈 때 어떻게 물러나는가. 빼기는 마지막 수단이다.
 *
 * 그러면 규격이 아는 것은 "자리가 이만큼"뿐이고, 규칙이 바뀌어도 표의 숫자만
 * 손대면 된다. 작성자가 이번 이벤트만 기간을 살리고 싶으면 그 블록의 중요도만
 * 올린다.
 *
 * 기본값은 블록 **종류**에서 나온다. 작성자는 이미 "메인 문구"와 "주의 문구"를
 * 구분해서 놓았으므로, 배너를 만들기 위해 새로 적을 것이 없다.
 *
 * ## 열다섯 장에서 읽은 것
 *
 *  - **주의 문구는 열다섯 장 어디에도 없었다.** 세 이벤트 전부. 그래서 배너에
 *    가지 않는다고 적는다.
 *  - **제목과 CTA는 늘 있었다.** 버튼이 없는 배너를 몇 장 보았지만 그것은 예외로
 *    보여 준 것이고, 원래는 들어가는 것이 맞다고 확인받았다.
 *  - **글자가 먼저 죽고 그림이 버틴다.** 70px 띠에서 사은품은 사진만 남고 이름표를
 *    벗었다. 기간·고지·배지처럼 읽어야 아는 것이 먼저 빠졌다.
 *  - **개수를 줄이는 것과 통째로 빠지는 것이 다르다.** 상품 뭉치는 8→5로 줄었고,
 *    기간은 0 아니면 전부였다.
 *  - **개수를 줄일 수 없는 히어로는 배경이 된다.** 이벤트3의 가차 기계는 한 대뿐이라
 *    줄일 수가 없었고, 얇은 띠 두 장에서 잘리지도 빠지지도 않고 **확대해 흐리게
 *    깔렸다.**
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import type { BlockType } from './blockTypes'
import type { BriefBlock } from './briefSchema'

/**
 * 이 블록이 배너에서 맡는 일.
 *
 * 얇은 띠 배너는 세 이벤트 전부 같은 문법이었다 — 왼쪽에 혜택, 가운데 제목,
 * 오른쪽에 행동. 규격별 틀이 자리를 이 이름으로 부르므로, 블록이 어느 자리에
 * 들어갈지는 종류가 아니라 이 값이 정한다.
 */
export type BannerPurpose =
  /** 메인 제목. 열다섯 장 전부에 있었다. */
  | 'title'
  /** 누르게 하는 것 — CTA 버튼. */
  | 'action'
  /** 왜 눌러야 하는가 — 가격, 100% 당첨, 누구나 증정, 사은품. */
  | 'benefit'
  /** 보여 주는 것 — 상품 사진, 히어로. */
  | 'imagery'
  /** 있으면 좋은 것 — 부제, 설명, 기간, 이름표. */
  | 'detail'
  /** 쇼핑몰의 것 — 로고, 코너 리본. 큰 배너에만 남았다. */
  | 'chrome'
  /** 배너에 가지 않는다. */
  | 'none'

/**
 * 안 들어갈 때 물러나는 방법. **덜 아픈 것부터** 적혀 있다.
 *
 * 빼기가 마지막인 것이 요점이다. 앞의 여섯은 전부 "빼기 전에 해 볼 것"이고,
 * 사람이 실제로 하던 일이다.
 */
export type Concession =
  /** 줄바꿈을 바꾼다 — 제목 2줄↔1줄. */
  | 'reflow'
  /** 열 수를 바꾼다 — 브랜드 목록 1열→2열. */
  | 'recolumn'
  /** 눕힌다 — 세로쓰기 `ADULT ONLY - R19`가 1020×70에서 가로로 누웠다. */
  | 'rotate'
  /** 이름표만 벗는다 — 얇은 띠에서 사은품은 사진만 남았다. */
  | 'unlabel'
  /** 개수를 줄인다 — 상품 뭉치 8→5. 줄였다는 표시(`⋮`)는 함께 간다. */
  | 'thin'
  /** 배경으로 내린다 — 확대해 흐리게 깔고 글자 뒤로 보낸다. */
  | 'demote'
  /** 뺀다. */
  | 'drop'

/**
 * 아픈 순서. 표의 양보 목록이 이 차례를 지키는지 검사가 붙든다.
 *
 * 지키지 않으면 자리가 조금 모자랄 뿐인데 블록이 통째로 사라지는 일이 생긴다.
 */
export const CONCESSION_ORDER: readonly Concession[] = [
  'reflow',
  'recolumn',
  'rotate',
  'unlabel',
  'thin',
  'demote',
  'drop',
]

export interface BannerRole {
  purpose: BannerPurpose
  /**
   * 0~100. 클수록 오래 버틴다.
   *
   * 열다섯 장에서 **몇 장에 남았는가**를 눈대중으로 옮긴 값이다. 정확한 숫자가
   * 아니라 차례를 정하는 값이고, 작성자가 이벤트마다 올리고 내릴 수 있어야 한다.
   */
  importance: number
  /** 물러나는 차례. 비어 있으면 물러나지 않는다 — 자리를 못 얻으면 그대로 남는다. */
  concessions: readonly Concession[]
}

/**
 * 블록 종류마다의 기본값.
 *
 * `Record<BlockType, …>`라 종류를 새로 만들면 여기도 채워야 컴파일된다. 새 종류가
 * 배너에서 어떻게 되는지 아무도 정하지 않은 채로 조용히 지나가지 않게 하려는 것이다.
 */
export const BANNER_ROLES: Record<BlockType, BannerRole> = {
  // ── 글자 ────────────────────────────────────────────────────────────────
  /** 열다섯 장 전부. 줄바꿈만 바꾸고 빼지 않는다. */
  main_headline: { purpose: 'title', importance: 100, concessions: ['reflow'] },
  /** `GIFT EVENT`, `BANANAMALL RANDOMBOX` — 큰 것에는 남고 얇은 띠에서는 빠졌다. */
  sub_headline: { purpose: 'detail', importance: 40, concessions: ['reflow', 'drop'] },
  /** `1등상부터 7등상까지…` 설명문. 500×387·800×250에만 있었다. */
  body_text: { purpose: 'detail', importance: 25, concessions: ['reflow', 'drop'] },
  /** `단 한 개만 구매해도 **누구나 증정!**` — 얇은 띠에서도 자주 남았다. */
  emphasis_text: { purpose: 'benefit', importance: 55, concessions: ['reflow', 'rotate', 'drop'] },
  /** 이벤트1은 840×640에 넣었고 이벤트2·3은 어디에도 넣지 않았다. 기본은 잘 빠지는 쪽. */
  period: { purpose: 'detail', importance: 30, concessions: ['drop'] },
  /** `1회뽑기 14,900원` — 70px 띠에서 **맨 앞자리**를 차지했다. */
  price: { purpose: 'benefit', importance: 70, concessions: ['reflow', 'drop'] },
  discount_rate: { purpose: 'benefit', importance: 70, concessions: ['reflow', 'drop'] },
  /** 열다섯 장 어디에도 없었다. 배너에 가지 않는다. */
  caution_text: { purpose: 'none', importance: 0, concessions: [] },
  free_text: { purpose: 'detail', importance: 35, concessions: ['reflow', 'rotate', 'drop'] },

  // ── 그림 ────────────────────────────────────────────────────────────────
  /** 로고 줄은 840×640·500×387에만 남았다. */
  logo: { purpose: 'chrome', importance: 25, concessions: ['drop'] },
  /** 한 대뿐인 히어로는 개수를 줄일 수 없다. 얇은 띠에서는 배경이 된다. */
  main_product_image: { purpose: 'imagery', importance: 75, concessions: ['demote', 'drop'] },
  sub_product_image: { purpose: 'imagery', importance: 45, concessions: ['thin', 'demote', 'drop'] },
  /** 뭉치는 개수부터 줄인다 — 8→5. */
  product_group_image: { purpose: 'imagery', importance: 70, concessions: ['thin', 'demote', 'drop'] },
  /** 참고용이라 완성본에도 나가지 않는다. */
  background_reference_image: { purpose: 'none', importance: 0, concessions: [] },
  existing_full_image: { purpose: 'none', importance: 0, concessions: [] },
  gif_source: { purpose: 'none', importance: 0, concessions: [] },

  // ── 이벤트 구조 ──────────────────────────────────────────────────────────
  benefit: { purpose: 'benefit', importance: 65, concessions: ['reflow', 'drop'] },
  purchase_condition: { purpose: 'benefit', importance: 60, concessions: ['reflow', 'drop'] },
  /** 70px 띠 두 장에서 사진만 남고 이름표를 벗었다. 사은품이 이벤트의 요점이라 오래 버틴다. */
  gift: { purpose: 'benefit', importance: 60, concessions: ['unlabel', 'thin', 'drop'] },
  application_condition: { purpose: 'detail', importance: 30, concessions: ['reflow', 'drop'] },
  /** 브랜드 목록 일곱 줄이 800×250에서 세로 1열→가로 2열로 재배치됐다. */
  option_item: { purpose: 'detail', importance: 30, concessions: ['recolumn', 'thin', 'drop'] },
  winner_count: { purpose: 'benefit', importance: 55, concessions: ['reflow', 'drop'] },
  /** 사은품의 이름표. `unlabel`이 벗기는 것이 이것이다. */
  product_name: { purpose: 'detail', importance: 30, concessions: ['drop'] },
  /** 원래는 늘 들어간다. 넣을지 말지는 규격이 아니라 사람이 정한다. */
  cta_button: { purpose: 'action', importance: 95, concessions: ['reflow'] },
  /** `위 품목 구매시` 같은 구분 머리말. 열다섯 장 어디에도 없었다. */
  divider_section_title: { purpose: 'detail', importance: 20, concessions: ['drop'] },
  group_container: { purpose: 'none', importance: 0, concessions: [] },

  // ── 참고·퍼블리싱 ────────────────────────────────────────────────────────
  // 그림에 나가는 것이 아니라 옆에 적어 두는 것이다. 배너에 갈 일이 없다.
  product_detail_link: { purpose: 'none', importance: 0, concessions: [] },
  button_url: { purpose: 'none', importance: 0, concessions: [] },
  application_form_link: { purpose: 'none', importance: 0, concessions: [] },
  reference_site_link: { purpose: 'none', importance: 0, concessions: [] },
  gif_source_link: { purpose: 'none', importance: 0, concessions: [] },
  publishing_note: { purpose: 'none', importance: 0, concessions: [] },
  manager_note: { purpose: 'none', importance: 0, concessions: [] },
  existing_page_location: { purpose: 'none', importance: 0, concessions: [] },
  revision_reference: { purpose: 'none', importance: 0, concessions: [] },
}

export function bannerRoleOf(type: BlockType): BannerRole {
  return BANNER_ROLES[type]
}

/** 이 종류가 배너에 갈 수 있는가. */
export function goesToBanner(type: BlockType): boolean {
  return BANNER_ROLES[type].purpose !== 'none'
}

/**
 * 배너에 갈 수 있는 블록만, **버틸 차례대로**.
 *
 * 중요도가 같으면 기획서에 놓인 차례를 지킨다. 같은 종류가 여럿일 때 순서가
 * 뒤집히면, 작성자가 위에 둔 것이 배너에서 아래로 가거나 먼저 빠진다.
 */
export function bannerOrder(blocks: readonly BriefBlock[]): BriefBlock[] {
  return blocks
    .filter((block) => goesToBanner(block.type))
    .map((block, index) => ({ block, index }))
    .sort((a, b) => {
      const gap = bannerRoleOf(b.block.type).importance - bannerRoleOf(a.block.type).importance
      return gap !== 0 ? gap : a.index - b.index
    })
    .map((entry) => entry.block)
}

/**
 * 이미 이만큼 물러난 블록이 다음에 할 수 있는 것. 더 물러날 데가 없으면 `null`.
 *
 * `null`은 "빼라"가 아니다. 양보 목록에 `drop`이 없는 블록 — 제목과 CTA — 은 더
 * 물러날 데가 없어도 남는다. 그 둘을 뺄 바에는 배너를 만들지 않는 편이 낫다.
 */
export function nextConcession(type: BlockType, applied: readonly Concession[] = []): Concession | null {
  const done = new Set(applied)
  return BANNER_ROLES[type].concessions.find((step) => !done.has(step)) ?? null
}
