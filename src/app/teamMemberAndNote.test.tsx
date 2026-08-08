/**
 * 누가 했는지, 팀끼리 무엇을 말했는지 (작성기 요청 3·4).
 *
 * 게이트는 팀만 물었다. 한 팀에서 여럿이 쓰므로 팀만으로는 나중에 "누가 했는지"를
 * 알 수 없었고, 팀 안에서 주고받는 말을 적을 자리도 없었다.
 *
 * 메모가 셋이 되었다는 것이 이 Patch의 위험한 자리다. 셋은 **받는 사람이 다르다.**
 *
 *  - `designerNote` — 디자인팀 작업자에게. 파일을 따라 작업판까지 간다.
 *  - `aiNote` — 이미지 AI에게. 작업판에서 작업자가 적는다.
 *  - `teamNote` — **같은 팀끼리만.** 어디로도 가지 않는다.
 *
 * 셋이 한 화면에 있으므로, 새 것이 앞의 둘이 가는 길에 얹히기 쉽다. 그러면 팀
 * 내부의 지적이 그림에 반영되려 하거나 남의 팀에게 읽힌다. 그 길이 막혀 있는지가
 * 여기서 지키는 것이다.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { buildBriefFile } from '../domain/summaryBuilder'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { pageAsEventBrief } from '../domain/briefMigration'
import {
  MEMBER_NAME_MAX,
  clearSelectedTeam,
  selectMember,
  selectTeam,
  selectedMember,
  selectedTeam,
} from '../features/team/teamSession'

beforeEach(() => {
  localStorage.clear()
})

describe('§29-1 작업자 이름은 팀과 함께 산다', () => {
  it('넣고 읽는다', () => {
    selectMember('김하늘')
    expect(selectedMember()).toBe('김하늘')
  })

  it('앞뒤 공백만 적은 것은 이름이 아니다', () => {
    selectMember('   ')
    expect(selectedMember()).toBeNull()
  })

  it('목록 한 줄에 들어갈 만큼만 담는다', () => {
    selectMember('가'.repeat(MEMBER_NAME_MAX + 30))
    expect(selectedMember()!.length).toBe(MEMBER_NAME_MAX)
  })

  it('팀을 떠나면 이름도 함께 떠난다', () => {
    // 남겨 두면 다음 사람의 작업에 앞사람 이름이 찍힌다.
    selectTeam('marketing')
    selectMember('김하늘')
    clearSelectedTeam()
    expect(selectedTeam()).toBeNull()
    expect(selectedMember()).toBeNull()
  })
})

describe('§29-2 팀 내부 메모는 팀 밖으로 나가지 않는다', () => {
  function docWithNotes() {
    const project = createEmptyProject('메모 시험')
    project.concept = '단정하게'
    project.designerNote = '이 문구는 강조해 주세요'
    project.teamNote = '가격 문구를 8월 기준으로 고쳐 주세요'
    const doc = createEmptyDocument(project)
    doc.pages[0]!.blocks = [createBlock('free_text', { id: 'blk', content: '가을 신상' })]
    return doc
  }

  it('AI 요약에 담기지 않는다 — 컨셉과 디자인팀 전달사항은 담긴다', () => {
    const doc = docWithNotes()
    const summary = buildBriefFile(pageAsEventBrief(doc, doc.pages[0]!))
    const text = JSON.stringify(summary)

    // 실패하면 팀 안에서 주고받은 지적이 그림에 반영되려 한다.
    expect(text).not.toContain('8월 기준으로')
    // 옆의 둘은 그대로 간다 — 새 칸을 막으려다 있던 길까지 막으면 안 된다.
    expect(text).toContain('이 문구는 강조해 주세요')
    expect(text).toContain('단정하게')
  })

  it('기획서와 함께 저장되고 다시 열린다', () => {
    // 나가지 않는 것과 남지 않는 것은 다르다. 지적을 받은 팀원이 파일을 열었을 때
    // 그 지적이 없으면 이 기능은 아무 일도 하지 않은 것이다.
    const doc = docWithNotes()
    const reopened = JSON.parse(JSON.stringify(doc)) as typeof doc
    expect(reopened.project.teamNote).toBe('가격 문구를 8월 기준으로 고쳐 주세요')
  })

  it('세 메모가 서로 섞이지 않는다', () => {
    const project = createEmptyProject('세 갈래')
    project.designerNote = '디자인팀에게'
    project.aiNote = 'AI에게'
    project.teamNote = '팀끼리'
    expect([project.designerNote, project.aiNote, project.teamNote]).toEqual(['디자인팀에게', 'AI에게', '팀끼리'])
  })
})
