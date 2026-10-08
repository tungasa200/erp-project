import { describe, expect, it } from 'vitest'
import { parseForSchedule } from './scheduleParse'

const options = { today: '2026-10-07', weekStart: 1 }

describe('일정 빠른 생성 해석 (P1-09-09)', () => {
  it('@프로젝트·#태그는 제목에 그대로 남기고, 시간은 해석한다', () => {
    const parsed = parseForSchedule('견적 회의 @영업 #결제 #견적 15-16', options)
    expect(parsed.title).toBe('견적 회의 @영업 #결제 #견적')
    expect(parsed.time).toEqual({ start: '15:00', end: '16:00' })
    expect(parsed).not.toHaveProperty('project')
    expect(parsed).not.toHaveProperty('tags')
  })

  it('!우선순위·~마감도 제목에 남기고, 날짜는 해석한다', () => {
    const parsed = parseForSchedule('내일 보고서 검토 !높음 ~금', options)
    expect(parsed.title).toBe('보고서 검토 !높음 ~금')
    expect(parsed.date).toBe('2026-10-08')
    expect(parsed).not.toHaveProperty('priority')
    expect(parsed).not.toHaveProperty('due')
  })

  it('기호가 없으면 빠른 입력 해석과 같다', () => {
    expect(parseForSchedule('점심 미팅 12-13', options)).toMatchObject({
      title: '점심 미팅',
      time: { start: '12:00', end: '13:00' },
    })
  })

  it('~를 붙여 쓴 시간 범위도 빠른 입력처럼 읽는다 (D-106)', () => {
    for (const text of ['회의 14 ~15', '회의 14:00 ~15:00', '회의 9:00~10:00', '회의 오후 2시 ~3시']) {
      const parsed = parseForSchedule(text, options)
      expect(parsed.title, text).toBe('회의')
      expect(parsed.time, text).toBeDefined()
    }
    expect(parseForSchedule('회의 14 ~15', options).time).toEqual({ start: '14:00', end: '15:00' })
  })

  it('오전/오후 없는 2시-3시는 24시간 규칙대로 02:00 ([pm 결정])', () => {
    expect(parseForSchedule('점검 2시-3시', options).time).toEqual({ start: '02:00', end: '03:00' })
  })

  it('~마감 뒤 낱말까지 마감으로 읽힌 글자는 제목에 그대로 남는다', () => {
    const parsed = parseForSchedule('보고서 ~다음주 수요일 15-16', options)
    expect(parsed.title).toBe('보고서 ~다음주 수요일')
    expect(parsed.date).toBeUndefined()
    expect(parsed.time).toEqual({ start: '15:00', end: '16:00' })
  })
})
