// 핵심 흐름 E2E (P4-06): 가입 → 빠른 입력 → 계획 기반 기록 확정 → 하루 마감.
// 업무일지 숨김(D-214)으로 내보내기·그 앞 이메일 인증 단계는 뺐다. 실제 서버(gateway·identity·worklog)를 쓴다. 매번 새 이메일로 가입하므로 DB를 비우지 않아도 된다.
import { expect, test, type Page } from '@playwright/test'
import { allowInsecureAuthCookies } from './webkit-cookies'

const PASSWORD = 'e2eFlow2026pw'

/** 서울 시각 기준 지금부터 2분 전에 끝난 30분짜리 구간. 자정 직후라 오늘 안에 못 만들면 null */
function pastSlotToday(): string | null {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date())
    .split(':')
    .map(Number)
  const end = h * 60 + m - 2
  const start = end - 30
  if (start < 0) return null
  const hm = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
  return `${hm(start)}-${hm(end)}`
}

/** 숫자가 섞이면 빠른 입력이 날짜·시간으로 읽을 수 있어 글자만 쓴다 */
function letters(n: number): string {
  return Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')
}

/** 토스트 한 줄(Toast 영역 role=status). 화면에 다른 status 영역이 있어 글자로 좁힌다 */
function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

async function quickAdd(page: Page, line: string, mobile: boolean) {
  if (mobile) {
    // SCR-MOB-01: 하단 탭 가운데 [빠른 기록] → 시트, Enter로 저장하고 닫힌다
    await page.getByRole('navigation', { name: '하단 탭' }).getByRole('button', { name: '빠른 기록' }).click()
    const sheet = page.getByRole('dialog', { name: '빠른 기록' })
    await sheet.getByRole('textbox', { name: '한 줄 입력' }).fill(line)
    await sheet.getByRole('textbox', { name: '한 줄 입력' }).press('Enter')
    await expect(sheet).toBeHidden()
  } else {
    const input = page.getByRole('textbox', { name: '빠른 기록' })
    await input.fill(line)
    await input.press('Enter')
    await expect(input).toHaveValue('')
  }
}

/**
 * 하루 마감 시각을 0시로 바꾼다. 홈은 마감 시각(기본 18:00) 뒤에 띠를 올리고 카드의 [하루 마감]을 숨기므로(SCR-HOME-01),
 * 그대로면 실행 시각에 따라 경로가 갈린다. 0시면 시험이 도는 내내(0시 32분 전은 건너뜀) 띠 경로 하나다.
 * 앱 화면과 같은 출처에서 부르므로 인증 쿠키·Origin 검사를 그대로 통과한다.
 */
async function closeAtMidnight(page: Page) {
  const status = await page.evaluate(async () => {
    const me = await fetch('/api/worklog/me', { credentials: 'same-origin' }).then((r) => r.json())
    const res = await fetch('/api/worklog/me/settings', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ dailyCloseTime: '00:00', version: me.settings.version }),
    })
    return res.status
  })
  expect(status).toBe(200)
}

test('가입부터 하루 마감까지', async ({ page, isMobile, browserName }) => {
  const slot = pastSlotToday()
  test.skip(slot === null, '서울 0시 32분 전에는 오늘 안에 끝난 계획을 만들 수 없음')
  await allowInsecureAuthCookies(page, browserName)
  const email = `e2e-${Date.now()}-${letters(4)}@worklog.test`
  const title = `시험 회의 ${letters(6)}`

  // 1. 가입: 랜딩 → 가입 화면, 약관 동의 후 가입하면 홈으로 간다
  await page.goto('/')
  await page.getByRole('link', { name: '무료로 시작하기' }).filter({ visible: true }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: '회원가입' })).toBeVisible()
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD)
  await page.getByLabel('비밀번호 확인').fill(PASSWORD)
  await page.getByRole('checkbox', { name: '전체 동의' }).check()
  await page.getByRole('button', { name: '회원가입', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await closeAtMidnight(page)

  // 2. 빠른 입력: 시간을 적으면 업무와 일정이 함께 만들어진다. 이미 끝난 시간이라 바로 확인 대기가 된다
  await quickAdd(page, `오늘 ${slot} ${title}`, isMobile)
  await expect(toast(page, '업무와 일정 1개를 추가했어요')).toBeVisible()

  // 3. 계획 기반 기록 확정: 확인 대기는 기록 목록을 불러올 때 생기므로 홈을 다시 연다
  await page.reload()
  await page.getByRole('button', { name: `${title} 했어요`, exact: true }).click()
  await expect(toast(page, '1건을 했어요로 기록했어요')).toBeVisible()

  // 4. 하루 마감: 홈 위 하루 마감 띠 → 넘길 업무 → 이슈 → 오늘 마감 → 완료 창 [닫기]
  //    (마감 시각을 0시로 둬서 띠는 늘 떠 있다. SCR-HOME-01, D-212 Q4)
  //    (업무일지 숨김 D-214: 일지 미리보기·[일지 보기]·[내보내기]·작성자 정보 줄 없음)
  await page.getByRole('region', { name: '하루 마감' }).getByRole('button', { name: '하루 마감' }).click()
  const close = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '다음', exact: true }) })
  await close.getByRole('button', { name: '다음', exact: true }).click()
  await page.getByLabel('이슈 및 특이사항 (선택)').fill('E2E 시험')
  await page.getByRole('button', { name: '오늘 마감', exact: true }).click()
  const done = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '오늘 하루를 마감했어요' }) })
  await expect(done).toBeVisible()
  await expect(done.getByRole('button', { name: '내보내기' })).toHaveCount(0)
  await done.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(done).toBeHidden()

  // 5. 숨긴 일지 화면: 예전 주소로 들어와도 홈으로 돌아온다(D-214)
  await page.goto('/logs')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: '업무일지' })).toHaveCount(0)
})
