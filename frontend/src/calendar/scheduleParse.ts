// 일정 빠른 생성(SCR-CAL-06)의 한 줄 해석. 빠른 입력(P1-09)의 parseQuickInput을 쓰되 일정에 쓰지 않는 토큰은 제목에 남긴다.
import { parseQuickInput } from '../quickInput/parse'

/** 해석에서 빼 둘 토큰 표시. 사용자가 입력할 일이 없는 문자(사설 영역)라 그대로 붙였다 뗀다 */
const KEEP = '\uE000'

/**
 * 팝오버는 아직 @프로젝트·#태그·!우선순위·~마감을 쓰지 않으므로(해석 칩·업무로도 만들기는 P2) 그 토큰을 제목에서 지우면
 * 정보가 사라진다(P1-09-09). 해석에서만 빼고 입력 그대로 제목에 남긴다. 날짜·시간(15-16 덮어쓰기)은 그대로 해석한다
 */
export function parseForSchedule(text: string, options: Parameters<typeof parseQuickInput>[1]) {
  const marked = text
    .split(/(\s+)/)
    .map((t) => (/^[@#!~]\S/.test(t) ? KEEP + t : t))
    .join('')
  const parsed = parseQuickInput(marked, options)
  return { ...parsed, title: parsed.title.replaceAll(KEEP, '') }
}
