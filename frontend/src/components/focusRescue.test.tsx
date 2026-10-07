import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useFocusRescue } from './focusRescue'

function Screen({ fallback = false }: { fallback?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusRescue(ref)
  const [shown, setShown] = useState(true)
  return (
    <div ref={ref}>
      <h1>화면 제목</h1>
      {fallback && (
        <p tabIndex={-1} data-focus-fallback>
          대체 목적지
        </p>
      )}
      {shown && (
        <button type="button" onClick={() => setShown(false)}>
          사라지는 버튼
        </button>
      )}
    </div>
  )
}

describe('useFocusRescue', () => {
  it('누른 요소가 사라지고 이웃이 없으면 화면 제목(h1)으로 포커스를 옮긴다', async () => {
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: '사라지는 버튼' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '화면 제목' })).toHaveFocus())
  })

  it('화면이 정한 대체 목적지가 있으면 h1보다 먼저 간다', async () => {
    render(<Screen fallback />)
    await userEvent.click(screen.getByRole('button', { name: '사라지는 버튼' }))
    await waitFor(() => expect(screen.getByText('대체 목적지')).toHaveFocus())
  })
})
