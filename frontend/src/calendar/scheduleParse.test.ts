import { describe, expect, it } from 'vitest'
import { parseForSchedule } from './scheduleParse'

const options = { today: '2026-10-07', weekStart: 1 }

describe('일정 빠른 생성 해석 (P1-09-09)', () => {
  it('@프로젝트·#태그는 제목에 그대로 남기고, 시간은 해석한다', () => {
    const parsed = parseForSchedule('견적 회의 @영업 #결제 #견적 15-16', options)
    expect(parsed.title).toBe('견적 회의 @영업 #결제 #견적')
    expect(parsed.time).toEqual({ start: '15:00', end: '16:00' })
    expect(parsed.project).toBeUndefined()
    expect(parsed.tags).toBeUndefined()
  })

  it('!우선순위·~마감도 제목에 남기고, 날짜는 해석한다', () => {
    const parsed = parseForSchedule('내일 보고서 검토 !높음 ~금', options)
    expect(parsed.title).toBe('보고서 검토 !높음 ~금')
    expect(parsed.date).toBe('2026-10-08')
    expect(parsed.priority).toBeUndefined()
    expect(parsed.due).toBeUndefined()
  })

  it('기호가 없으면 빠른 입력 해석과 같다', () => {
    expect(parseForSchedule('점심 미팅 12-13', options)).toMatchObject({
      title: '점심 미팅',
      time: { start: '12:00', end: '13:00' },
    })
  })
})
