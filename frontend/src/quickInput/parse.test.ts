import { describe, expect, it } from 'vitest'
import { todayIn } from './dates'
import { parseQuickInput, replaceSpan, toDraft, unreadTimeWord } from './parse'

// 2026-10-07은 수요일
const TODAY = '2026-10-07'
// 해석 결과 비교에서는 낱말 위치(spans)를 빼고 본다. 위치는 아래 'spans' 묶음에서 따로 확인한다
const parse = (text: string, weekStart?: number) => {
  const result: Partial<ReturnType<typeof parseQuickInput>> = parseQuickInput(text, { today: TODAY, weekStart })
  delete result.spans
  return result
}

describe('parseQuickInput', () => {
  it('요구사항 예시 한 줄을 모두 해석한다', () => {
    expect(parse('14-16 견적서 작성 @영업 #견적 !높음 ~금')).toEqual({
      title: '견적서 작성',
      time: { start: '14:00', end: '16:00' },
      project: '영업',
      tags: ['견적'],
      priority: 'HIGH',
      due: '2026-10-09',
    })
  })

  it('낱말 순서와 관계없이 읽는다', () => {
    expect(parse('@영업 견적서 ~내일 작성 14-16')).toMatchObject({
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

    // WY-qa 조사표(docs/qa/evidence/P3-quickinput-time/parser-matrix.txt) — 2026-10-08 문법 확장
    it.each([
      ['14-15', '14:00', '15:00'],
      ['14:00-15:00', '14:00', '15:00'],
      ['9:30-10:30', '09:30', '10:30'],
      ['14–15', '14:00', '15:00'],
      ['14~15', '14:00', '15:00'],
      ['14:00~15:00', '14:00', '15:00'],
      ['9:00~10:00', '09:00', '10:00'],
      ['14〜15', '14:00', '15:00'],
      ['14:00～15:00', '14:00', '15:00'],
      ['14:00 - 15:00', '14:00', '15:00'],
      ['14:00 ~ 15:00', '14:00', '15:00'],
      ['14:00 -15:00', '14:00', '15:00'],
      ['14:00- 15:00', '14:00', '15:00'],
      ['14시-15시', '14:00', '15:00'],
      ['14시~15시', '14:00', '15:00'],
      ['14-15시', '14:00', '15:00'],
      ['2시-3시', '02:00', '03:00'], // 오전/오후 없이 쓴 시각은 24시간제 그대로
      ['오후 2시-3시', '14:00', '15:00'], // 끝이 앞서면 오후
      ['오후2시~3시', '14:00', '15:00'],
      ['오전 11시-오후 1시', '11:00', '13:00'],
      ['오후 12시-1시', '12:00', '13:00'],
      ['오전 12시-1시', '00:00', '01:00'],
      ['14시 30분-15시', '14:30', '15:00'],
      ['14시30분~15시30분', '14:30', '15:30'],
      ['11-1', '11:00', '13:00'],
      ['12-1', '12:00', '13:00'],
      ['23-24', '23:00', '24:00'],
      ['0-1', '00:00', '01:00'],
      // 시각 하나는 1시간 일정
      ['14:00', '14:00', '15:00'],
      ['9:00', '09:00', '10:00'],
      ['14시', '14:00', '15:00'],
      ['오후 2시', '14:00', '15:00'],
      ['오후 3시 30분', '15:30', '16:30'],
      ['23:00', '23:00', '24:00'],
    ])('%s → %s–%s (앞·뒤·날짜와 함께)', (input, start, end) => {
      const time = { start, end }
      expect(parse(input)).toEqual({ title: '', time })
      expect(parse(`회의 ${input}`)).toEqual({ title: '회의', time })
      expect(parse(`${input} 회의`)).toEqual({ title: '회의', time })
      expect(parse(`내일 ${input}`)).toEqual({ title: '', time, date: '2026-10-08', dateText: '내일' })
    })

    it.each([
      '14—15', // em dash
      '１４：００-１５：００', // 전각 숫자
      '14:00부터',
      '23:30', // 끝이 24시를 넘는다
      '24:00',
      '24-1',
      '3시간',
      '14', // 숫자만은 시각이 아니다
      '2-3개',
    ])('%s는 시간이 아니라 제목', (input) => {
      expect(parse(`${input} 회의`)).toEqual({ title: `${input} 회의` })
    })

    it('구분자 뒤가 시각이 아니면 앞 시각 하나만 읽는다(마감 ~금, ~10/12와 함께)', () => {
      expect(parse('14:00 ~금 회의')).toEqual({
        title: '회의',
        time: { start: '14:00', end: '15:00' },
        due: '2026-10-09',
      })
      expect(parse('9 ~10/12 회의')).toEqual({ title: '9 회의', due: '2026-10-12' })
    })

    it('오전/오후에 13시 이상은 오전/오후를 제목에 남기고 시각만 읽는다', () => {
      expect(parse('오전 14시 회의')).toEqual({ title: '오전 회의', time: { start: '14:00', end: '15:00' } })
    })

    it('영어 to·부터~까지는 범위로 읽지 않는다', () => {
      expect(parse('14:00 to 15:00 회의')).toEqual({ title: 'to 15:00 회의', time: { start: '14:00', end: '15:00' } })
      expect(parse('14:00부터 15:00까지')).toEqual({ title: '14:00부터 15:00까지' })
    })
  })

  describe('unreadTimeWord (시간으로 읽지 못한 낱말 안내)', () => {
    it.each([
      ['회의 14—15', '14—15'],
      ['１４：００-１５：００ 회의', '１４：００-１５：００'],
      ['14:00부터 15:00까지', '14:00부터'],
      ['24-1 회의', '24-1'],
      ['to 15:00 회의', '15:00'],
      ['오후3시반 회의', '오후3시반'],
    ])('%s → %s', (title, word) => {
      expect(unreadTimeWord(title)).toBe(word)
    })

    it.each(['회의', '3시간 회의', '2-3개 고치기', '10/12 보고', 'v1.2 배포', '1:1 면담'])(
      '%s는 안내하지 않는다',
      (title) => {
        expect(unreadTimeWord(title)).toBeUndefined()
      },
    )
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

  describe('마감·프로젝트·태그·우선순위', () => {
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
      expect(parse('a !보통').priority).toBe('NORMAL')
      expect(parse('a !낮음').priority).toBe('LOW')
    })

    it('해석하지 못한 기호 낱말은 제목에 남는다', () => {
      expect(parse('# @ ! ~ !급함 ~아무때나 #a#b')).toEqual({ title: '# @ ! ~ !급함 ~아무때나 #a#b' })
    })

    it('태그는 여러 개를 입력 순서대로 받고 같은 이름(대소문자 무시)은 하나로 친다', () => {
      expect(parse('#결제 회의 #견적 #API #api #결제')).toEqual({ title: '회의', tags: ['결제', '견적', 'API'] })
    })

    it('태그 이름은 30자까지, 프로젝트 이름은 50자까지', () => {
      const tag31 = `#${'가'.repeat(31)}`
      const project51 = `@${'나'.repeat(51)}`
      expect(parse(`${tag31} ${project51}`)).toEqual({ title: `${tag31} ${project51}` })
      expect(parse(`#${'가'.repeat(30)} @${'나'.repeat(50)}`)).toEqual({
        title: '',
        tags: ['가'.repeat(30)],
        project: '나'.repeat(50),
      })
    })

    it('같은 종류가 두 번 나오면 처음 것만 쓰고 나머지는 제목에 남긴다', () => {
      expect(parse('@가 @나 !높음 !낮음 오늘 내일 1-2 3-4 메모')).toEqual({
        title: '@나 !낮음 내일 3-4 메모',
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
  const draft = (text: string) => toDraft(parseQuickInput(text, { today: TODAY }), TODAY)

  it('시간만 있으면 오늘 일정', () => {
    expect(draft('14-16 견적서')).toEqual({ title: '견적서', schedule: { date: TODAY, start: '14:00', end: '16:00' } })
  })

  it('날짜와 시간이 있으면 그날 일정', () => {
    expect(draft('내일 10-11 스프린트 리뷰 @개발 #스프린트')).toEqual({
      title: '스프린트 리뷰',
      project: '개발',
      tags: ['스프린트'],
      schedule: { date: '2026-10-08', start: '10:00', end: '11:00' },
    })
  })

  it('날짜와 시각 하나가 있으면 그날 1시간 일정', () => {
    expect(draft('내일 15:00 회의')).toEqual({
      title: '회의',
      schedule: { date: '2026-10-08', start: '15:00', end: '16:00' },
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

describe('spans·replaceSpan (P1-09-12 칩 수정)', () => {
  const text = '  14-16 견적서 @영업 #견적 #API  !높음 ~다음주 금 내일'
  const { spans } = parseQuickInput(text, { today: TODAY })
  const at = (s?: [number, number]) => (s ? text.slice(...s) : undefined)

  it('해석한 낱말의 원문 위치를 준다(여러 낱말 마감 포함)', () => {
    expect(at(spans.time)).toBe('14-16')
    expect(at(spans.project)).toBe('@영업')
    expect(at(spans.tags?.['api'])).toBe('#API')
    expect(at(spans.priority)).toBe('!높음')
    expect(at(spans.due)).toBe('~다음주 금')
    expect(at(spans.date)).toBe('내일')
  })

  it('여러 낱말에 걸친 시간은 한 칩 자리로 묶는다', () => {
    const t = '회의 오후 2시 - 3시 @영업'
    const s = parseQuickInput(t, { today: TODAY }).spans
    expect(t.slice(...s.time!)).toBe('오후 2시 - 3시')
    expect(replaceSpan(t, s.time!, '14:00-16:00')).toBe('회의 14:00-16:00 @영업')
  })

  it('그 낱말만 바꾸거나, 빼면서 공백을 하나로 줄인다', () => {
    expect(replaceSpan(text, spans.priority!, '!낮음')).toBe('  14-16 견적서 @영업 #견적 #API  !낮음 ~다음주 금 내일')
    expect(replaceSpan(text, spans.priority!, '')).toBe('  14-16 견적서 @영업 #견적 #API ~다음주 금 내일')
    expect(replaceSpan(text, spans.date!, '')).toBe('  14-16 견적서 @영업 #견적 #API  !높음 ~다음주 금')
    expect(replaceSpan('14-16 회의', [0, 5], '')).toBe('회의')
  })
})
