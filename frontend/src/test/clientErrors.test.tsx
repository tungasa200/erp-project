// P4-13 화면 오류 수집 (POST /api/client-errors, contracts/gateway.yaml 0.2.0)
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { installClientErrorReporting, reportClientError, resetClientErrorsForTest } from '../api/clientErrors'
import { ErrorPage } from '../pages/ErrorPage'
import { problem, renderApp, stubFetch } from './renderApp'

beforeAll(() => installClientErrorReporting())

beforeEach(() => resetClientErrorsForTest())

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const reports = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls
    .filter(([input]) => String(input) === '/api/client-errors')
    .map(([, init]) => ({ init, body: JSON.parse(String(init?.body)) }))

const ok204 = () => new Response(null, { status: 204 })

describe('P4-13 화면 오류 수집', () => {
  it('화면을 그리다 난 오류는 RENDER로 한 번 보낸다. 주소의 쿼리·#과 쿠키는 보내지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = stubFetch({ 'POST /api/client-errors': ok204 })
    function Broken(): never {
      throw new Error('boom')
    }
    renderApp('/?code=secret#x', [{ errorElement: <ErrorPage />, children: [{ path: '/', element: <Broken /> }] }])
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()

    await waitFor(() => expect(reports(fetchMock)).toHaveLength(1))
    const [{ init, body }] = reports(fetchMock)
    expect(body).toMatchObject({ kind: 'RENDER', message: 'boom' })
    expect(body.stack).toContain('boom')
    expect(body.url).not.toMatch(/secret|#/)
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', keepalive: true })
  })

  it('서버 오류로 오류 화면이 뜨면 보내지 않는다(서버 로그에 이미 남음)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = stubFetch({ 'GET /api/users/me': () => problem(500, 'INTERNAL_ERROR') })
    renderApp('/calendar')
    expect(await screen.findByRole('heading', { name: '잠시 문제가 생겼어요' })).toBeInTheDocument()
    expect(reports(fetchMock)).toHaveLength(0)
  })

  it('같은 오류는 한 번만, 한 페이지에서 10건까지만 보낸다', () => {
    const fetchMock = stubFetch({ 'POST /api/client-errors': ok204 })
    const same = new Error('same')
    reportClientError('ERROR', same)
    reportClientError('ERROR', same)
    expect(reports(fetchMock)).toHaveLength(1)
    for (let i = 0; i < 20; i++) reportClientError('ERROR', new Error(`e${i}`))
    expect(reports(fetchMock)).toHaveLength(10)
  })

  it('직전에 실패한 API 응답의 traceId를 relatedTraceId로 붙인다', async () => {
    const traceId = '0123456789abcdef0123456789abcdef'
    const fetchMock = stubFetch({
      'GET /api/worklog/broken': () => {
        const res = problem(500, 'INTERNAL_ERROR')
        res.headers.set('X-Trace-Id', traceId)
        return res
      },
      'POST /api/client-errors': ok204,
    })
    await expect(api.request('/api/worklog/broken')).rejects.toThrow()
    reportClientError('UNHANDLED_REJECTION', new Error('after'))
    expect(reports(fetchMock)[0].body).toMatchObject({ kind: 'UNHANDLED_REJECTION', relatedTraceId: traceId })
  })

  it('window error·unhandledrejection을 보내고, 리소스 불러오기 실패는 보내지 않는다', () => {
    const fetchMock = stubFetch({ 'POST /api/client-errors': ok204 })
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('on window'), message: 'on window' }))
    window.dispatchEvent(new Event('error'))
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown }
    rejection.reason = new Error('rejected')
    window.dispatchEvent(rejection)
    expect(reports(fetchMock).map((r) => [r.body.kind, r.body.message])).toEqual([
      ['ERROR', 'on window'],
      ['UNHANDLED_REJECTION', 'rejected'],
    ])
  })

  it('Error가 아닌 값은 내용 없이 종류만 보낸다(입력값이 섞이지 않게)', () => {
    const fetchMock = stubFetch({ 'POST /api/client-errors': ok204 })
    reportClientError('UNHANDLED_REJECTION', { password: 'secret' })
    expect(reports(fetchMock)[0].body.message).toBe('Non-Error [object Object]')
  })

  it('보내기가 실패해도 다시 보내거나 오류를 내지 않는다', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fetchMock)
    expect(() => reportClientError('ERROR', new Error('x'))).not.toThrow()
    reportClientError('ERROR', new Error('x'))
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
