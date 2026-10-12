// 하루 마감 창(SCR-LOG-03)을 앱 어디서든 연다. 창은 AppShell 하나가 띄운다(홈 띠·일지 카드·팔레트·캘린더 기록 패널이 같은 길).
export interface DayCloseRequest {
  /** 마감할 날(YYYY-MM-DD). 비우면 사용자 시간대의 오늘 */
  date?: string
  /** 팔레트 '빠른 마감': 대기는 그대로, 넘길 일은 기본 선택, 이슈는 비운 채 바로 확정한다 */
  quick?: boolean
}

type Opener = (request: DayCloseRequest) => void

let opener: Opener | null = null

/** AppShell만 부른다. 돌려준 함수로 해제 */
export function registerDayCloseOpener(next: Opener) {
  opener = next
  return () => {
    if (opener === next) opener = null
  }
}

export function openDayClose(request: DayCloseRequest = {}) {
  opener?.(request)
}
