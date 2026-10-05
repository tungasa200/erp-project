import { describe, expect, it } from 'vitest'
import { todayIn } from './dates'
import { parseQuickInput, toDraft } from './parse'

// 2026-10-07은 수요일
const TODAY = '2026-10-07'
const parse = (text: string, weekStart?: number) => parseQuickInput(text, { today: TODAY, weekStart })

describe('parseQuickInput', () => {
  it('요구사항 예시 한 줄을 모두 해석한다', () => {
    expect(parse('14-16 견적서 작성 #영업 !높음 ~금')).toEqual({
      title: '견적서 작성',
      time: { start: '14:00', end: '16:00' },
      project: '영업',
      priority: 'HIGH',
      due: '2026-10-09',
    })
  })

  it('낱말 순서와 관계없이 읽는다', () => {
    expect(parse('#영업 견적서 ~내일 작성 14-16')).toMatchObject({
      title: '견적서 작성',
      project: '영업',
      due: '2026-10-08',
      time: { start: '14:00', end: '16:00' },
    })
  })

  it('빈 입력', () => {
    expect(parse('   ')).toEqual({ title: '' })
  })

  describe('시간', () => {
    it.each([
      ['9:30-10:30', '09:30', '10:30'],
      ['9:30-10', '09:30', '10:00'],
      ['9-12', '09:00', '12:00'],
      ['23-24', '23:00', '24:00'],
      ['14–16', '14:00', '16:00'],
      ['11-1', '11:00', '13:00'], // 끝이 앞서면 오후
      ['10-9', '10:00', '21:00'],
      ['9-9', '09:00', '21:00'],
    ])('%s → %s–%s', (input, start, end) => {
      expect(parse(`${input} 회의`)).toEqual({ title: '회의', time: { start, end } })
    })

    it.each(['25-26', '12-12', '9:60-10', '24-1', '16-14', '24:30-25'])('%s는 시간이 아니라 제목', (input) => {
      expect(parse(`${input} 회의`)).toEqual({ title: `${input} 회의` })
    })
  })

  describe('날짜', () => {
    it.each([
      ['어제', '2026-10-06'],
      ['오늘', '2026-10-07'],
      ['내일', '2026-10-08'],
      ['모레', '2026-10-09'],
      ['수요일', '2026-10-07'], // 오늘 포함 가장 가까운 요일
      ['금요일', '2026-10-09'],
      ['월요일', '2026-10-12'],
      ['이번주 월요일', '2026-10-05'],
      ['다음주 수요일', '2026-10-14'],
      ['다음 주 수요일', '2026-10-14'],
      ['다음주수요일', '2026-10-14'],
      ['다음주 일', '2026-10-18'],
      ['다다음주 화', '2026-10-20'],
      ['지난주 금요일', '2026-10-02'],
      ['10/12', '2026-10-12'],
      ['10월 12일', '2026-10-12'],
      ['10월12일', '2026-10-12'],
      ['1/3', '2027-01-03'], // 가장 가까운 해
      ['4/10', '2026-04-10'],
    ])('%s → %s', (input, date) => {
      expect(parse(`${input} 보고`)).toEqual({ title: '보고', date, dateText: input })
    })

    it('주 시작이 일요일이면 주 경계가 바뀐다', () => {
      // 일요일 시작: 이번 주는 10/4(일)~10/10(토)
      expect(parse('다음주 일요일', 7).date).toBe('2026-10-11')
      expect(parse('이번주 일요일', 7).date).toBe('2026-10-04')
    })

    it.each(['금 정리', '일 정리', '오늘의 회고', '다음주 회의', '2/30 정산', '13/1 정산', '10월 정산'])(
      '"%s"는 날짜로 보지 않는다',
      (input) => {
        expect(parse(input)).toEqual({ title: input })
      },
    )
  })

  describe('마감·프로젝트·우선순위', () => {
    it.each([
      ['~금', '2026-10-09'],
      ['~금요일', '2026-10-09'],
      ['~내일', '2026-10-08'],
      ['~10/12', '2026-10-12'],
      ['~다음주 수요일', '2026-10-14'],
      ['~다음주수', '2026-10-14'],
    ])('%s → 마감 %s', (input, due) => {
      expect(parse(`보고서 ${input} 제출`)).toEqual({ title: '보고서 제출', due })
    })

    it('우선순위 세 가지', () => {
      expect(parse('a !높음').priority).toBe('HIGH')
      expect(parse('a !보통').priority).toBe('MEDIUM')
      expect(parse('a !낮음').priority).toBe('LOW')
    })

    it('해석하지 못한 기호 낱말은 제목에 남는다', () => {
      expect(parse('# ! ~ !급함 ~아무때나 #')).toEqual({ title: '# ! ~ !급함 ~아무때나 #' })
    })

    it('같은 종류가 두 번 나오면 처음 것만 쓰고 나머지는 제목에 남긴다', () => {
      expect(parse('#가 #나 !높음 !낮음 오늘 내일 1-2 3-4 메모')).toEqual({
        title: '#나 !낮음 내일 3-4 메모',
        project: '가',
        priority: 'HIGH',
        date: '2026-10-07',
        dateText: '오늘',
        time: { start: '01:00', end: '02:00' },
      })
    })

    it('객체 기본 속성 이름을 문법으로 오해하지 않는다', () => {
      expect(parse('constructor toString')).toEqual({ title: 'constructor toString' })
    })
  })
})

describe('toDraft', () => {
  const draft = (text: string) => toDraft(parse(text), TODAY)

  it('시간만 있으면 오늘 일정', () => {
    expect(draft('14-16 견적서')).toEqual({ title: '견적서', schedule: { date: TODAY, start: '14:00', end: '16:00' } })
  })

  it('날짜와 시간이 있으면 그날 일정', () => {
    expect(draft('내일 10-11 스프린트 리뷰 #개발')).toEqual({
      title: '스프린트 리뷰',
      project: '개발',
      schedule: { date: '2026-10-08', start: '10:00', end: '11:00' },
    })
  })

  it('시각 없는 날짜는 마감 (A안)', () => {
    expect(draft('내일 보고서 작성')).toEqual({ title: '보고서 작성', due: '2026-10-08' })
  })

  it('~ 마감이 따로 있으면 날짜 글자는 제목으로 돌아간다', () => {
    expect(draft('다음주 수요일 회의 준비 ~금')).toEqual({ title: '다음주 수요일 회의 준비', due: '2026-10-09' })
  })
})

describe('todayIn', () => {
  it('사용자 시간대로 오늘을 구한다', () => {
    const now = new Date('2026-10-04T15:30:00Z') // 서울 10/5 00:30
    expect(todayIn('Asia/Seoul', now)).toBe('2026-10-05')
    expect(todayIn('UTC', now)).toBe('2026-10-04')
  })
})
