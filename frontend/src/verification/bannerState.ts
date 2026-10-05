// 미인증 배너를 "이번 로그인 동안" 숨긴 상태 (SCR-COM-07 ③). 로그인·가입·로그아웃 때 지워서 다음 로그인에 다시 보인다.
// 브라우저 저장소를 못 쓰면 숨김이 유지되지 않을 뿐 배너는 정상 동작한다.
const KEY = 'worklog.unverifiedBanner.hiddenFor'

export function isBannerHidden(userId: string): boolean {
  try {
    return sessionStorage.getItem(KEY) === userId
  } catch {
    return false
  }
}

export function hideBanner(userId: string) {
  try {
    sessionStorage.setItem(KEY, userId)
  } catch {
    // 무시
  }
}

export function resetBanner() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // 무시
  }
}
