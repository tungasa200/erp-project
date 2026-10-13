import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Modal, ModalCancelButton } from './Modal'

function Harness({ narrow, dirty }: { narrow?: boolean; dirty?: boolean }) {
  const [open, setOpen] = useState(true)
  if (!open) return <p>닫힘</p>
  return (
    <Modal labelledBy="t" narrow={narrow} dirty={dirty} onClose={() => setOpen(false)}>
      <h2 id="t">창</h2>
      <input aria-label="칸" />
      <ModalCancelButton onClose={() => setOpen(false)}>취소</ModalCancelButton>
    </Modal>
  )
}

function mockWidth(mobile: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: mobile && query === '(max-width: 767px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
}

describe('Modal 모바일 시트 (UX-M-COM-10·COM-02)', () => {
  beforeEach(() => history.replaceState(null, ''))
  afterEach(() => vi.unstubAllGlobals())

  it('모바일 바텀시트는 공용 진입 모션 클래스를 쓰고, 좁은 확인 창과 데스크톱은 쓰지 않는다', () => {
    mockWidth(true)
    const { unmount } = render(<Harness />)
    expect(screen.getByRole('dialog')).toHaveClass('wy-sheet')
    expect(screen.getByRole('dialog').parentElement).toHaveClass('wy-scrim')
    unmount()

    render(<Harness narrow />)
    expect(screen.getByRole('dialog')).not.toHaveClass('wy-sheet')
  })

  it('데스크톱은 모션 클래스·뒤로 가기 기록이 없다', () => {
    mockWidth(false)
    const before = history.length
    render(<Harness />)
    expect(screen.getByRole('dialog')).not.toHaveClass('wy-sheet')
    expect(history.length).toBe(before)
  })

  it('모바일에서 뒤로 가기는 시트를 닫고, 고친 내용이 있으면 먼저 묻는다', async () => {
    mockWidth(true)
    const { unmount } = render(<Harness />)
    history.back()
    await screen.findByText('닫힘')
    unmount()

    const user = userEvent.setup()
    render(<Harness dirty />)
    history.back()
    await screen.findByText('고친 내용이 있어요. 버리고 닫을까요?')
    // [계속 편집]이면 다시 뒤로 가기로 물을 수 있다
    await user.click(screen.getByRole('button', { name: '계속 편집' }))
    history.back()
    await screen.findByText('고친 내용이 있어요. 버리고 닫을까요?')
    await user.click(screen.getByRole('button', { name: '버리고 닫기' }))
    await waitFor(() => expect(screen.getByText('닫힘')).toBeInTheDocument())
  })

  it('[취소]도 고친 내용이 있으면 묻는다(UX-M-REC-54)', async () => {
    mockWidth(false)
    const user = userEvent.setup()
    render(<Harness dirty />)
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.getByText('고친 내용이 있어요. 버리고 닫을까요?')).toBeInTheDocument()
  })
})
