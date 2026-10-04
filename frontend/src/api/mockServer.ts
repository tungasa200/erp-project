// 개발용 가짜 서버. contracts/identity.yaml의 응답 형태를 흉내 낸다. 쿠키 대신 localStorage에 세션을 둔다.
// 체험용 계정: demo@example.com / worklog20
// locked@example.com: 로그인 시 429 AUTH_LOCKED, error@example.com: 500, maintenance@example.com: 503 점검(30분)
import { EMAIL_PATTERN, passwordViolations } from '../auth/passwordRules'
import type { FieldError, Problem } from './problem'
import type { Me } from './types'

const STORE_KEY = 'worklog.mock'
const ACCESS_TTL_MS = 10 * 60 * 1000

interface MockState {
  accounts: Record<string, { password: string; id: string }>
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

function me(email: string, id: string): Me {
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
    version: 0,
  }
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
    return json(201, me(email, id))
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    if (email === 'locked@example.com') return problem(429, 'AUTH_LOCKED', { retryAfterSeconds: 892 })
    if (email === 'error@example.com') return problem(500, 'INTERNAL_ERROR')
    if (email === 'maintenance@example.com') return problem(503, 'MAINTENANCE', { retryAfterSeconds: 1800 })
    const account = state.accounts[email]
    if (!account || account.password !== body.password) return problem(401, 'INVALID_CREDENTIALS')
    startSession(state, email)
    return json(200, me(email, account.id))
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
    return json(200, me(session.email, state.accounts[session.email]?.id ?? 'mock'))
  }

  return problem(404, 'NOT_FOUND')
}
