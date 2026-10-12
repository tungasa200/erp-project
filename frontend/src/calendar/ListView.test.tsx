import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ListView } from './ListView'

const DAYS = ['2026-10-07', '2026-10-08']

function renderList(editable: boolean) {
  const onCreate = vi.fn()
  render(
    <ListView
      days={DAYS}
      occurrences={[]}
      timeZone="UTC"
      today={DAYS[0]}
      loading={false}
      canLoadMore={false}
      colorOf={() => null}
      projectNameOf={() => null}
      onOpen={vi.fn()}
      onLoadMore={vi.fn()}
      onCreate={onCreate}
      editable={editable}
    />,
  )
  return onCreate
}

describe('목록 보기 빈 상태 (UX-CAL-75)', () => {
  it('다가오는 일정이 없으면 만드는 방법과 [일정 만들기]를 보인다', async () => {
    const onCreate = renderList(true)
    expect(screen.getByText('다가오는 일정이 없어요')).toBeInTheDocument()
    expect(screen.getByText('일 보기의 빈 시간에서도 바로 만들 수 있어요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '일정 만들기' }))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('오프라인이면 [일정 만들기]는 꺼진다', () => {
    renderList(false)
    expect(screen.getByRole('button', { name: '일정 만들기' })).toBeDisabled()
  })
})
