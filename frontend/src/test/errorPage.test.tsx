import { useQuery } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { ErrorPage } from '../pages/ErrorPage'
import { problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// 화면을 그리는 데 꼭 필요한 조회는 throwOnError로 실패를 라우터 errorElement까지 올린다.
function NeedsData() {
  const { data } = useQuery({
    queryKey: ['needs-data'],
    queryFn: () => api.request<{ name: string }>('/api/worklog/needs-data'),
    throwOnError: true,
  })
  return <p>{data?.name}</p>
}

const routes = [{ errorElement: <ErrorPage />, children: [{ path: '/', element: <NeedsData /> }] }]

describe('SCR-SYS-02 ① 서버 오류 페이지', () => {
  it('화면에 필요한 조회가 5xx로 실패하면 다시 시도 버튼과 문의 코드를 보여 준다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch({ 'GET /api/worklog/needs-data': () => problem(500, 'INTERNAL_ERROR') })
    renderApp('/', routes)

    expect(await screen.findByRole('heading', { name: '잠시 문제가 생겼어요' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.getByText('trace-123')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '복사' })).toBeInTheDocument()
  })

  it('로그인 상태 조회가 5xx로 실패하면 로그인 화면이 아니라 오류 페이지를 보여 준다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch({ 'GET /api/users/me': () => problem(500, 'INTERNAL_ERROR') })
    const { router } = renderApp('/calendar')

    expect(await screen.findByRole('heading', { name: '잠시 문제가 생겼어요' })).toBeInTheDocument()
    expect(screen.getByText('trace-123')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/calendar')
  })

  it('렌더 중 오류에 문의 코드가 없으면 다시 시도 버튼만 보여 준다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch({})
    function Broken(): never {
      throw new Error('boom')
    }
    renderApp('/', [{ errorElement: <ErrorPage />, children: [{ path: '/', element: <Broken /> }] }])

    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.queryByText(/문의 코드/)).not.toBeInTheDocument()
  })
})
