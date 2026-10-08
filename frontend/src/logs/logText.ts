// 일지 글자 규칙: 문서 영역(LogPaper)과 텍스트 복사(SCR-LOG-05 ①, 서식명세 3.4)가 함께 쓴다.
import { formatMinutes, toZoned } from '../calendar/time'
import { WEEKDAY_NAMES, isoWeekday } from '../quickInput/dates'
import type { LogContent, LogPlan, LogType } from './api'
import { progressLabel } from './api'
import { periodText } from './format'

export const SECTION: Record<LogType, string> = { DAILY: '금일 실적', WEEKLY: '이번 주 실적', MONTHLY: '이번 달 실적' }
export const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
export const mdw = (date: string) => `${md(date)} (${WEEKDAY_NAMES[isoWeekday(date) - 1]})`

/** 계획 예정 칸: 일정 시각, 없으면 마감일 */
export function planWhen(p: LogPlan, timeZone: string): string {
  if (p.scheduledAt) {
    const z = toZoned(p.scheduledAt, timeZone)
    return `${mdw(z.date)} ${formatMinutes(z.minutes)}`
  }
  return p.dueDate ? `마감 ${mdw(p.dueDate)}` : ''
}

export function metricsLine(type: LogType, c: LogContent): string {
  const m = c.metrics
  // 서식명세 2.5: 월간만 "완료 업무·기록", 일간·주간은 결과별 건수
  if (type === 'MONTHLY') {
    const parts = [
      m.completedTaskCount && `완료 업무 ${m.completedTaskCount}건`,
      m.recordCount && `기록 ${m.recordCount}건`,
    ]
    return parts.filter(Boolean).join(' · ') || '없음'
  }
  const parts = [
    m.done && `완료 ${m.done}건`,
    m.inProgress && `진행 중 ${m.inProgress}건`,
    m.reviewRequested && `검토 요청 ${m.reviewRequested}건`,
  ].filter(Boolean)
  if (parts.length === 0) return '없음'
  const going = c.achievements.filter((a) => a.outcome === 'IN_PROGRESS')
  const names = going.slice(0, 3).map((a) => `${a.text} ${a.progress != null ? `${a.progress}%` : '진행 중'}`)
  const extra = going.length > 3 ? ` 외 ${going.length - 3}건` : ''
  return `${parts.join(' · ')}${names.length > 0 ? ` (${names.join(', ')}${extra})` : ''}`
}

interface TextInput {
  type: LogType
  periodStart: string
  periodEnd: string
  content: LogContent
  draft: boolean
  timeZone: string
}

/**
 * 서식명세 3.4: 결재란·선·쪽 번호 없이 문서와 같은 순서. 첫 줄 "업무일지 · 2026년 10월 7일 (수) · 홍길동(개발팀)",
 * 구분 제목 "■ 금일 실적", 행 "1. 업무 내용 — 결과 (70%)". 소요시간 표는 넣지 않는다.
 */
export function logToText({ type, periodStart, periodEnd, content: c, draft, timeZone }: TextInput): string {
  const { name, organization } = c.author
  const who = name ? `${name}${organization ? `(${organization})` : ''}` : organization
  const head = [`${c.title}${draft ? ' [초안]' : ''}`, periodText(type, periodStart, periodEnd), who]
    .filter(Boolean)
    .join(' · ')

  const rows = <T>(items: T[], line: (item: T) => string) =>
    items.length > 0 ? items.map((item, i) => `${i + 1}. ${line(item)}`) : ['없음']
  const achievements = rows(c.achievements, (a) => {
    const progress = progressLabel(a)
    return `${a.text}${a.result ? ` — ${a.result}` : ''}${progress ? ` (${progress})` : ''}`
  })
  const plans = rows(c.plans, (p) => {
    const when = planWhen(p, timeZone)
    return `${p.text}${when ? ` (${when})` : ''}`
  })

  return [
    head,
    '',
    `■ ${SECTION[type]}`,
    ...achievements,
    '',
    '■ 진행 현황',
    metricsLine(type, c),
    '',
    `■ ${c.planTitle}`,
    ...plans,
    '',
    '■ 이슈 및 특이사항',
    c.issues?.trim() || '없음',
  ].join('\n')
}
