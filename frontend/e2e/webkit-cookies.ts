// WebKit은 http://localhost를 안전한 출처로 보지 않아 Secure 쿠키를 저장하지 않는다(Chromium은 저장).
// 인증 쿠키는 늘 Secure라(AuthCookies) http로 띄운 시험 환경에서는 가입 직후부터 401 → 로그인 화면으로 튕긴다.
// WebKit 프로젝트(webkit·mobile)에서만 /api 응답의 Set-Cookie에서 Secure를 떼어 브라우저에 넘긴다.
// 운영(https)과 서버 코드는 그대로이고, 나머지 속성(HttpOnly·SameSite·Path·Max-Age)은 바꾸지 않는다.
import type { Page } from '@playwright/test'

export async function allowInsecureAuthCookies(page: Page, browserName: string) {
  if (browserName !== 'webkit') return
  await page.route('**/api/**', async (route) => {
    const response = await route.fetch()
    const all = response.headersArray()
    const cookies = all.filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value)
    if (cookies.length === 0) return route.fulfill({ response })
    const headers = Object.fromEntries(
      all.filter((h) => h.name.toLowerCase() !== 'set-cookie').map((h) => [h.name, h.value]),
    )
    // fulfill의 headers는 객체라 Set-Cookie 여러 개는 줄바꿈으로 이어 넘긴다(Playwright가 나눠 적용)
    headers['set-cookie'] = cookies.map((c) => c.replace(/;\s*Secure(?=;|$)/i, '')).join('\n')
    await route.fulfill({ response, headers })
  })
}
