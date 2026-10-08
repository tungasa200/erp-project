// 일정 빠른 생성(SCR-CAL-06)의 한 줄 해석. 빠른 입력(P1-09)의 parseQuickInput을 쓰되 업무에만 쓰는 토큰은 제목에 남긴다.
import { parseQuickInput, replaceSpan } from '../quickInput/parse'

/**
 * "업무로도 만들기"를 끄면 @프로젝트·#태그·!우선순위·~마감을 넣을 곳이 없어 제목에서 지우면 정보가 사라진다(P1-09-09).
 * 빠른 입력과 똑같이 해석한 뒤 날짜·시간 낱말만 원문에서 빼고 나머지는 입력 그대로 제목에 남긴다. "자세히"로 넘길 때도 쓴다.
 * 토큰을 미리 해석에서 빼면 '14 ~15'의 '~15'처럼 시간 범위의 일부까지 빠져 빠른 입력(D-106)과 달라진다
 */
export function parseForSchedule(text: string, options: Parameters<typeof parseQuickInput>[1]) {
  const { time, date, dateText, spans } = parseQuickInput(text, options)
  const cut = [spans.time, spans.date].filter((s) => s !== undefined).sort((a, b) => b[0] - a[0])
  const title = cut
    .reduce((t, s) => replaceSpan(t, s, ''), text)
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
  return { title, time, date, dateText, spans: { time: spans.time, date: spans.date } }
}
