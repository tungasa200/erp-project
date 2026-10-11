// Mailpit(시험용 메일 받는 서버, D-179)에서 인증번호를 꺼낸다. API: /api/v1/search, /api/v1/message/{ID}
import { expect, type APIRequestContext } from '@playwright/test'

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025'
const SUBJECT = '[WY Worklog] 이메일 인증번호 안내'

type Summary = { ID: string; Subject: string; Created: string }

async function codeMails(request: APIRequestContext, to: string): Promise<Summary[]> {
  const res = await request.get(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:"${to}"` } })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { messages: Summary[] }
  // 최신 순으로 돌려주지만 순서에 기대지 않고 시각으로 다시 정렬한다
  return body.messages.filter((m) => m.Subject === SUBJECT).sort((a, b) => b.Created.localeCompare(a.Created))
}

/** to로 온 인증 메일이 atLeast통 이상 쌓일 때까지 기다려 가장 새 메일의 6자리 코드를 돌려준다(보낼 때마다 새 코드만 유효). */
export async function latestCode(request: APIRequestContext, to: string, atLeast = 1): Promise<string> {
  let mails: Summary[] = []
  // 메일은 커밋 뒤 비동기로 나가므로 기다린다
  await expect
    .poll(async () => (mails = await codeMails(request, to)).length, { timeout: 20_000, message: `${to} 인증 메일` })
    .toBeGreaterThanOrEqual(atLeast)
  const res = await request.get(`${MAILPIT_URL}/api/v1/message/${mails[0].ID}`)
  expect(res.ok()).toBeTruthy()
  const { Text } = (await res.json()) as { Text: string }
  const code = Text.match(/^\s*(\d{6})\s*$/m)?.[1]
  expect(code, '메일 본문의 6자리 인증번호').toBeTruthy()
  return code!
}
