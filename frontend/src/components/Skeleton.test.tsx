import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Skeleton } from './Skeleton'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Skeleton (화면정의서 2장 로딩)', () => {
  it('0.3초 안에는 아무것도 그리지 않고, 그 뒤에 "불러오는 중" 상태로 보인다', () => {
    render(<Skeleton count={4} />)
    act(() => vi.advanceTimersByTime(299))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('불러오는 중')
    expect(status.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4)
  })

  it('0.3초 전에 로딩이 끝나 사라지면 끝까지 보이지 않는다', () => {
    const { unmount } = render(<Skeleton shape="chip" />)
    act(() => vi.advanceTimersByTime(200))
    unmount()
    act(() => vi.advanceTimersByTime(500))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('line은 글자 자리에 들어가는 막대 하나다', () => {
    render(<Skeleton shape="line" />)
    act(() => vi.advanceTimersByTime(300))
    expect(screen.getByRole('status').tagName).toBe('SPAN')
  })
  it('끊긴 동안에는 막대 대신 연결되면 불러온다는 안내를 보인다 (P1-X-04)', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<Skeleton count={4} offlineText="연결되면 업무를 불러올게요" />)
    act(() => vi.advanceTimersByTime(300))
    expect(screen.getByRole('status')).toHaveTextContent('연결되면 업무를 불러올게요')
    vi.restoreAllMocks()
  })
})
