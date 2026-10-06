import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKELETON_DELAY_MS } from '../components/useDelayed'
import { TaskPanel } from './TaskPanel'

describe('업무 패널 로딩 (2장)', () => {
  afterEach(() => vi.useRealTimers())

  const renderPanel = (pending: boolean) =>
    render(
      <TaskPanel
        tasks={[]}
        projects={[]}
        today="2026-10-07"
        pending={pending}
        loadingMore={false}
        hasMore={false}
        onLoadMore={vi.fn()}
        onPlace={vi.fn()}
        quickInput={null}
      />,
    )

  it('첫 로딩은 0.3초 뒤에 스켈레톤을 보이고, 빈 상태 문구는 숨긴다', () => {
    vi.useFakeTimers()
    renderPanel(true)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(SKELETON_DELAY_MS))
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
    expect(screen.queryByText('배치할 업무가 없어요')).not.toBeInTheDocument()
  })

  it('불러온 뒤 업무가 없으면 빈 상태 문구', () => {
    renderPanel(false)
    expect(screen.getByText('배치할 업무가 없어요')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
