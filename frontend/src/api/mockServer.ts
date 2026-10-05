// 개발용 가짜 서버. contracts/identity.yaml의 응답 형태를 흉내 낸다. 쿠키 대신 localStorage에 세션을 둔다.
// 체험용 계정: demo@example.com / worklog20
// locked@example.com: 로그인 시 429 AUTH_LOCKED, error@example.com: 500, maintenance@example.com: 503 점검(30분)
// deleted@example.com: 로그인은 되지만 이후 요청은 401 USER_DELETED(다른 기기에서 탈퇴한 경우, 새로 고침하면 재현)
// 프로필 수정(PATCH /api/users/me)은 localStorage에 남는다. 탭 두 개에서 고치면 409 VERSION_CONFLICT를 재현할 수 있다.
// 이메일 인증·비밀번호 재설정 코드는 항상 123456 (mockCodes.ts). 가입하면 첫 인증 코드를 자동으로 보낸 것으로 친다.
import { EMAIL_PATTERN, passwordViolations } from '../auth/passwordRules'
import { handleScheduleMock } from '../calendar/mockSchedules'
import { checkCode, codeStatus, issueCode } from './mockCodes'
import { handleWorklog } from './mockWorklog'
import type { FieldError, Problem } from './problem'
import type { Me, ProfileUpdateRequest } from './types'

const STORE_KEY = 'worklog.mock'
const ACCESS_TTL_MS = 10 * 60 * 1000

interface MockState {
  accounts: Record<string, { password: string; id: string; profile?: Partial<Me> }>
  session: { email: string; accessExpiresAt: number } | null
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as MockState
  } catch {
    // 저장소를 못 쓰면 기본값으로 시작
  }
  return { accounts: { 'demo@example.com': { password: 'worklog20', id: 'mock-demo' } }, session: null }
}

function save(state: MockState) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state))
  } catch {
    // 무시
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function problem(status: number, code: string, extra: Partial<Problem> = {}) {
  const body: Problem = {
    type: 'about:blank',
    title: code,
    status,
    code,
    traceId: Math.random().toString(16).slice(2, 10),
    ...extra,
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/problem+json' }
  if (body.retryAfterSeconds !== undefined) headers['Retry-After'] = String(body.retryAfterSeconds)
  return new Response(JSON.stringify(body), { status, headers })
}

function me(email: string, id: string, profile: Partial<Me> = {}): Me {
  return {
    id,
    email,
    emailVerified: false,
    name: null,
    organization: null,
    position: null,
    timezone: 'Asia/Seoul',
    weekStart: 'MONDAY',
    workDays: 31,
    themeAccent: '#4B3FD6',
    themeGround: '#F2F4FA',
    keyboardShortcutsEnabled: true,
    version: 0,
    ...profile,
  }
}

const TEXT_FIELDS = ['name', 'organization', 'position'] as const

function updateProfile(current: Me, body: ProfileUpdateRequest): Me | Response {
  if (body.version !== current.version) return problem(409, 'VERSION_CONFLICT')
  const next: Me = { ...current }
  const errors: FieldError[] = []
  for (const field of TEXT_FIELDS) {
    if (!(field in body)) continue
    const value = body[field]?.trim() || null
    if (value && value.length > 100) errors.push({ field, code: 'TOO_LONG' })
    next[field] = value
  }
  if (body.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.timezone })
      next.timezone = body.timezone
    } catch {
      errors.push({ field: 'timezone', code: 'TIMEZONE_INVALID' })
    }
  }
  if (body.workDays !== undefined) {
    if (body.workDays < 1 || body.workDays > 127) errors.push({ field: 'workDays', code: 'WORK_DAYS_INVALID' })
    next.workDays = body.workDays
  }
  if (body.weekStart !== undefined) next.weekStart = body.weekStart
  if (body.keyboardShortcutsEnabled !== undefined) next.keyboardShortcutsEnabled = body.keyboardShortcutsEnabled
  if (errors.length) return problem(400, 'VALIDATION_FAILED', { errors })
  const changed = JSON.stringify(next) !== JSON.stringify(current)
  return changed ? { ...next, version: current.version + 1 } : current
}

function startSession(state: MockState, email: string) {
  state.session = { email, accessExpiresAt: Date.now() + ACCESS_TTL_MS }
  save(state)
}

export const mockFetch: typeof fetch = async (input, init) => {
  await new Promise((r) => setTimeout(r, 300))
  const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(init.body as string) : {}
  const state = load()

  if (method === 'POST' && path === '/api/auth/signup') {
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    const errors: FieldError[] = []
    if (!EMAIL_PATTERN.test(email)) errors.push({ field: 'email', code: 'EMAIL_INVALID' })
    for (const code of passwordViolations(String(body.password ?? ''), email)) errors.push({ field: 'password', code })
    if (!body.agreeTerms) errors.push({ field: 'agreeTerms', code: 'AGREEMENT_REQUIRED' })
    if (!body.agreePrivacy) errors.push({ field: 'agreePrivacy', code: 'AGREEMENT_REQUIRED' })
    if (errors.length) return problem(400, 'VALIDATION_FAILED', { errors })
    if (email === 'error@example.com') return problem(500, 'INTERNAL_ERROR')
    if (state.accounts[email]) return problem(409, 'EMAIL_ALREADY_EXISTS')
    const id = `mock-${Date.now()}`
    state.accounts[email] = { password: body.password, id }
    startSession(state, email)
    issueCode(`verify:${email}`)
    return json(201, me(email, id))
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    if (email === 'locked@example.com') return problem(429, 'AUTH_LOCKED', { retryAfterSeconds: 892 })
    if (email === 'error@example.com') return problem(500, 'INTERNAL_ERROR')
    if (email === 'maintenance@example.com') return problem(503, 'MAINTENANCE', { retryAfterSeconds: 1800 })
    if (email === 'deleted@example.com') {
      startSession(state, email)
      return json(200, me(email, 'mock-deleted'))
    }
    const account = state.accounts[email]
    if (!account || account.password !== body.password) return problem(401, 'INVALID_CREDENTIALS')
    startSession(state, email)
    return json(200, me(email, account.id, account.profile))
  }

  if (method === 'POST' && path === '/api/auth/refresh') {
    if (!state.session) return problem(401, 'REFRESH_INVALID')
    startSession(state, state.session.email)
    return new Response(null, { status: 204 })
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    state.session = null
    save(state)
    return new Response(null, { status: 204 })
  }

  if (method === 'GET' && path === '/api/users/me') {
    const session = state.session
    if (!session || session.accessExpiresAt < Date.now()) return problem(401, 'UNAUTHENTICATED')
    if (session.email === 'deleted@example.com') return problem(401, 'USER_DELETED')
    const account = state.accounts[session.email]
    return json(200, me(session.email, account?.id ?? 'mock', account?.profile))
  }

  if (path === '/api/auth/password-reset' && method === 'POST') {
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    const issued = issueCode(`reset:${email}`)
    if ('retryAfterSeconds' in issued) return problem(429, 'RESEND_TOO_SOON', issued)
    return json(202, issued)
  }

  if (
    (path === '/api/auth/password-reset/verify' || path === '/api/auth/password-reset/confirm') &&
    method === 'POST'
  ) {
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    const confirm = path.endsWith('/confirm')
    const result = checkCode(`reset:${email}`, body.code, false)
    if (!result.ok) return problem(400, result.code, result.extra as Partial<Problem>)
    if (!confirm) return new Response(null, { status: 204 })
    const errors = passwordViolations(String(body.newPassword ?? ''), email).map((code) => ({
      field: 'newPassword',
      code,
    }))
    if (errors.length) return problem(400, 'VALIDATION_FAILED', { errors })
    checkCode(`reset:${email}`, body.code, true)
    const account = state.accounts[email]
    if (account) {
      account.password = String(body.newPassword)
      account.profile = { ...account.profile, emailVerified: true }
    }
    state.session = null // 모든 기기 로그아웃
    save(state)
    return new Response(null, { status: 204 })
  }

  if (path.startsWith('/api/users/me/email-verification')) {
    const session = state.session
    const account = session && state.accounts[session.email]
    if (!session || !account) return problem(401, 'UNAUTHENTICATED')
    const current = me(session.email, account.id, account.profile)
    const key = `verify:${session.email}`
    if (method === 'GET') return json(200, { verified: current.emailVerified, ...codeStatus(key) })
    if (method === 'POST' && path.endsWith('/confirm')) {
      if (current.emailVerified) return json(200, current)
      const result = checkCode(key, body.code, true)
      if (!result.ok) return problem(400, result.code, result.extra as Partial<Problem>)
      account.profile = { ...account.profile, emailVerified: true, version: current.version + 1 }
      save(state)
      return json(200, me(session.email, account.id, account.profile))
    }
    if (method === 'POST') {
      if (current.emailVerified) return problem(409, 'EMAIL_ALREADY_VERIFIED')
      const issued = issueCode(key)
      if ('retryAfterSeconds' in issued) return problem(429, 'RESEND_TOO_SOON', issued)
      return json(202, issued)
    }
  }

  if (method === 'PATCH' && path === '/api/users/me') {
    const account = state.session && state.accounts[state.session.email]
    if (!state.session || !account) return problem(401, 'UNAUTHENTICATED')
    const result = updateProfile(me(state.session.email, account.id, account.profile), body as ProfileUpdateRequest)
    if (result instanceof Response) return result
    account.profile = result
    save(state)
    return json(200, result)
  }

  if (method === 'POST' && path === '/api/worklog/me/profile/refresh') {
    if (!state.session) return problem(401, 'UNAUTHENTICATED')
    return json(200, {})
  }

  if (path.startsWith('/api/worklog/')) {
    if (!state.session || state.session.accessExpiresAt < Date.now()) return problem(401, 'UNAUTHENTICATED')
    const respond = {
      json,
      problem: (s: number, c: string, e?: Record<string, unknown>) => problem(s, c, e as Partial<Problem>),
    }
    // 일정(P1-05·06)은 캘린더 쪽 mock이 맡는다 (frontend2)
    const handled = handleScheduleMock(method, path, body, respond) ?? handleWorklog(method, path, body, respond)
    if (handled) return handled
  }

  return problem(404, 'NOT_FOUND')
}
