// SCR-COM-04 되돌리기 토스트의 이동 링크(view): 보관함 복원 "'{업무}'를 복원했어요 · 보기 · 되돌리기" (TASK-04)
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToast } from '../components/useToast'
import { renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Restore({ commit, undo }: { commit: () => void; undo: () => void }) {
  const { showUndo } = useToast()
  return (
    <button
      type="button"
      onClick={() =>
        showUndo({
          group: 'restore',
          message: () => "'견적서'를 복원했어요",
          undo,
          commit,
          view: { label: '보기', to: '/tasks/t1' },
        })
      }
    >
      복원
    </button>
  )
}

const setup = () => {
  stubFetch({})
  const commit = vi.fn()
  const undo = vi.fn()
  const { router } = renderApp('/archive', [
    { path: '/archive', element: <Restore commit={commit} undo={undo} /> },
    { path: '/tasks/t1', element: <h1>견적서 상세</h1> },
  ])
  return { router, commit, undo }
}

describe('되돌리기 토스트 [보기]', () => {
  it('메시지와 되돌리기 사이에 링크로 보이고, 키보드로 누르면 토스트를 닫아 확정하고 그 화면으로 간다', async () => {
    const { router, commit, undo } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '복원' }))

    const view = screen.getByRole('link', { name: '보기' })
    expect(view).toHaveAttribute('href', '/tasks/t1')
    const undoButton = screen.getByRole('button', { name: '되돌리기' })
    expect(view.compareDocumentPosition(undoButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    view.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '견적서 상세' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tasks/t1')
    expect(commit).toHaveBeenCalledTimes(1)
    expect(undo).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: '보기' })).not.toBeInTheDocument()
  })

  it('view가 없으면 링크를 그리지 않는다', async () => {
    stubFetch({})
    function Plain() {
      const { showUndo } = useToast()
      return (
        <button type="button" onClick={() => showUndo({ group: 'g', message: () => '삭제했어요', undo: () => {} })}>
          삭제
        </button>
      )
    }
    renderApp('/', [{ path: '/', element: <Plain /> }])
    await userEvent.setup().click(screen.getByRole('button', { name: '삭제' }))
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
