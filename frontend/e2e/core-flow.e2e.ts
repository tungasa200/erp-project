// 핵심 흐름 E2E (P4-06): 가입 → 빠른 입력 → 계획 기반 기록 확정 → 하루 마감 → 이메일 인증 → 내보내기.
// 실제 서버(gateway·identity·worklog)와 Mailpit을 쓴다. 매번 새 이메일로 가입하므로 DB를 비우지 않아도 된다.
import { expect, test, type Page } from '@playwright/test'
import { latestCode } from './mailpit'

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

test('가입부터 내보내기까지', async ({ page, request, isMobile }) => {
  const slot = pastSlotToday()
  test.skip(slot === null, '서울 0시 32분 전에는 오늘 안에 끝난 계획을 만들 수 없음')
  const email = `e2e-${Date.now()}-${letters(4)}@worklog.test`
  const title = `시험 회의 ${letters(6)}`

  // 1. 가입: 랜딩 → 가입 화면, 약관 동의 후 가입하면 홈으로 간다(인증은 내보내기 전까지만 하면 됨)
  await page.goto('/')
  await page.getByRole('link', { name: '무료로 시작하기' }).filter({ visible: true }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: '회원가입' })).toBeVisible()
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD)
  await page.getByLabel('비밀번호 확인').fill(PASSWORD)
  await page.getByRole('checkbox', { name: '전체 동의' }).check()
  await page.getByRole('button', { name: '회원가입', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('region', { name: '이메일 인증 안내' })).toBeVisible()

  // 2. 빠른 입력: 시간을 적으면 업무와 일정이 함께 만들어진다. 이미 끝난 시간이라 바로 확인 대기가 된다
  await quickAdd(page, `오늘 ${slot} ${title}`, isMobile)
  await expect(toast(page, '업무와 일정 1개를 추가했어요')).toBeVisible()

  // 3. 계획 기반 기록 확정: 확인 대기는 기록 목록을 불러올 때 생기므로 홈을 다시 연다
  await page.reload()
  await page.getByRole('button', { name: `${title} 했어요`, exact: true }).click()
  await expect(toast(page, '1건을 했어요로 기록했어요')).toBeVisible()

  // 4. 하루 마감: 오늘 일지 카드 → 넘길 업무 → 이슈 → 마감하고 확정(새 사용자는 작성자 정보 물음이 먼저 뜸)
  const logCard = page.locator('section', { has: page.getByRole('heading', { level: 2, name: '오늘 일지' }) })
  await logCard.getByRole('button', { name: '하루 마감' }).click()
  const close = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '다음', exact: true }) })
  await close.getByRole('button', { name: '다음', exact: true }).click()
  await page.getByLabel('이슈 및 특이사항 (선택)').fill('E2E 시험')
  await expect(page.getByRole('region', { name: '일지 미리보기' })).toContainText(title)
  await page.getByRole('button', { name: '마감하고 확정' }).click()
  await page.getByRole('dialog', { name: '작성자 정보를 넣을까요?' }).getByRole('button', { name: '나중에' }).click()
  const done = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '오늘 일지를 확정했어요' }) })
  await expect(done).toBeVisible()

  // 5·6. 내보내기 → 미인증이라 인증부터: 메일의 코드를 넣으면 고른 형식(PDF)으로 바로 내려받는다
  await done.getByRole('button', { name: '내보내기' }).click()
  const exportDialog = page.getByRole('dialog', { name: '내보내기' })
  await expect(exportDialog.getByRole('radio', { name: 'PDF' })).toBeChecked()
  await exportDialog.getByRole('button', { name: '내려받기' }).click()
  // 가입 직후 60초 안이면 다시 보내기가 거절되어(429) 가입 때 받은 코드가 그대로 유효하다
  const resend = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/users/me/email-verification'),
  )
  await page
    .getByRole('dialog', { name: '이메일 인증이 필요해요' })
    .getByRole('button', { name: '인증 코드 받기' })
    .click()
  const code = await latestCode(request, email, (await resend).ok() ? 2 : 1)

  const download = page.waitForEvent('download')
  await page.getByRole('dialog', { name: '이메일 인증' }).getByLabel('인증번호').fill(code)
  await expect(toast(page, '이메일 인증을 마쳤어요')).toBeVisible()
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
  await expect(toast(page, '파일을 내려받았어요')).toBeVisible()
  await expect(page.getByRole('region', { name: '이메일 인증 안내' })).toBeHidden()
})
