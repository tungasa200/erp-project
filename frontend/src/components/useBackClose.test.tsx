import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useBackClose } from './useBackClose'

function Sheet({ name, onClose, children }: { name: string; onClose: () => void; children?: React.ReactNode }) {
  useBackClose(true, onClose)
  return (
    <div role="dialog" aria-label={name}>
      <button type="button" onClick={onClose}>
        {name} 닫기
      </button>
      {children}
    </div>
  )
}

function Host() {
  const [outer, setOuter] = useState(false)
  const [inner, setInner] = useState(false)
  const [text, setText] = useState('')
  return (
    <>
      <button type="button" onClick={() => setOuter(true)}>
        열기
      </button>
      {outer && (
        <Sheet name="바깥" onClose={() => setOuter(false)}>
          <input aria-label="메모" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" onClick={() => setInner(true)}>
            안쪽 열기
          </button>
          {inner && <Sheet name="안쪽" onClose={() => setInner(false)} />}
        </Sheet>
      )}
    </>
  )
}

const back = () => act(() => history.back())

describe('useBackClose (COM-02)', () => {
  it('뒤로 가기는 맨 위 창 하나만 닫고, 아래 창의 입력은 남는다', async () => {
    const user = userEvent.setup()
    const start = history.length
    render(<Host />)
    await user.click(screen.getByRole('button', { name: '열기' }))
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('button', { name: '안쪽 열기' }))
    expect(history.length).toBe(start + 2)

    await back()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '안쪽' })).toBeNull())
    expect(screen.getByRole('dialog', { name: '바깥' })).toBeTruthy()
    expect(screen.getByLabelText('메모')).toHaveValue('초안')

    await back()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '바깥' })).toBeNull())
  })

  it('[×]로 닫으면 쌓은 기록을 되돌리고, 그 popstate는 다른 듣는 쪽에 가지 않는다', async () => {
    const user = userEvent.setup()
    const routerLike = vi.fn()
    window.addEventListener('popstate', routerLike)
    render(<Host />)
    await user.click(screen.getByRole('button', { name: '열기' }))
    expect(history.state?.wyOverlay).toBeTypeOf('number')

    await user.click(screen.getByRole('button', { name: '바깥 닫기' }))
    await waitFor(() => expect(history.state?.wyOverlay).toBeUndefined())
    expect(routerLike).not.toHaveBeenCalled()
    window.removeEventListener('popstate', routerLike)
  })

  it('창을 닫고 같은 차례에 다른 창을 열면 기록을 하나 더 쌓지 않고 그 자리를 쓴다', async () => {
    function Swap() {
      const [which, setWhich] = useState<'a' | 'b' | null>(null)
      return (
        <>
          <button type="button" onClick={() => setWhich('a')}>
            가 열기
          </button>
          {which === 'a' && (
            <Sheet name="가" onClose={() => setWhich(null)}>
              <button type="button" onClick={() => setWhich('b')}>
                나로 바꾸기
              </button>
            </Sheet>
          )}
          {which === 'b' && <Sheet name="나" onClose={() => setWhich(null)} />}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Swap />)
    await user.click(screen.getByRole('button', { name: '가 열기' }))
    await user.click(screen.getByRole('button', { name: '나로 바꾸기' }))
    await act(() => new Promise((r) => setTimeout(r, 0)))
    // 뒤로 가기 한 번이면 창 기록이 다 빠진다(가의 기록이 남아 헛도는 뒤로 가기가 없다)
    await back()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '나' })).toBeNull())
    await waitFor(() => expect(history.state?.wyOverlay).toBeUndefined())
  })
})
