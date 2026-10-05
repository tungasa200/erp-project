import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { ToastProvider } from '../components/Toast'
import { useToast } from '../components/useToast'
import { QuickInput } from '../quickInput/QuickInput'
import { json, ME, renderApp, stubFetch } from './renderApp'

// 서울 2026-10-07(수) 12:00. 타이머는 진짜로 두고 Date만 고정한다.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openHome(me: object = ME) {
  stubFetch({ 'GET /api/users/me': () => json(200, me) })
  const result = renderApp('/')
  const input = await screen.findByRole('textbox', { name: '빠른 기록' })
  return { ...result, input }
}

describe('SCR-HOME-01 첫 화면 (UX-04)', () => {
  it('설정 없이 바로 입력창과 첫 실행 안내를 보여 준다', async () => {
    await openHome()
    expect(screen.getByText('10월 7일 수요일')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '좋은 오후예요' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '오늘 할 일을 한 줄로 적어 보세요' })).toBeInTheDocument()
  })

  it('예시를 누르면 입력창에 채운다', async () => {
    const { input } = await openHome()
    await userEvent.click(screen.getByRole('button', { name: '견적서 회신 #영업 !높음 ~금' }))
    expect(input).toHaveValue('견적서 회신 #영업 !높음 ~금')
    expect(input).toHaveFocus()
  })
})

describe('SCR-COM-02 빠른 입력창', () => {
  it('해석 결과를 실제 날짜 칩으로 미리 보여 준다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '14-16 견적서 작성 #영업 !높음 ~금')
    const chips = within(screen.getByRole('list', { name: '해석 결과' })).getAllByRole('listitem')
    expect(chips.map((c) => c.textContent)).toEqual(['오늘 14:00–16:00', '#영업', '우선순위 높음', '마감 10/9(금)'])
    expect(screen.getByText('일정과 업무가 함께 만들어져요')).toBeInTheDocument()
  })

  it('시각 없는 날짜는 마감으로 보여 준다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '다음주 수요일 보고서')
    expect(screen.getByRole('listitem')).toHaveTextContent('마감 10/14(수)')
    expect(screen.getByText('업무가 만들어져요')).toBeInTheDocument()
  })

  describe('Enter', () => {
    async function renderQuick() {
      stubFetch({ 'GET /api/users/me': () => json(200, ME) })
      const onSubmit = vi.fn()
      function Wrapper() {
        const [value, setValue] = useState('')
        return <QuickInput value={value} onChange={setValue} onSubmit={onSubmit} />
      }
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <Wrapper />
          </AuthProvider>
        </QueryClientProvider>,
      )
      const input = await screen.findByRole('textbox', { name: '빠른 입력' })
      return { onSubmit, input }
    }

    it('비었거나 공백뿐이면 안내 없이 무시한다', async () => {
      const { onSubmit, input } = await renderQuick()
      await userEvent.type(input, '   {Enter}')
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.queryByText('할 일 이름을 적어 주세요')).not.toBeInTheDocument()
      expect(screen.queryByRole('list', { name: '해석 결과' })).not.toBeInTheDocument()
    })

    it('제목 없이 문법 낱말만 있으면 안내하고 저장하지 않는다', async () => {
      const { onSubmit, input } = await renderQuick()
      await userEvent.type(input, '14-16 #영업{Enter}')
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByText('할 일 이름을 적어 주세요')).toBeInTheDocument()
      expect(input).toHaveValue('14-16 #영업')
    })

    it('제목이 있으면 해석 결과로 저장하고 입력을 비운다', async () => {
      const { onSubmit, input } = await renderQuick()
      await userEvent.type(input, '견적서 14-16 #영업{Enter}')
      expect(onSubmit).toHaveBeenCalledWith({
        title: '견적서',
        project: '영업',
        schedule: { date: '2026-10-07', start: '14:00', end: '16:00' },
      })
      await waitFor(() => expect(input).toHaveValue(''))
    })
  })

  it('Esc로 입력을 비운다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '회의{Escape}')
    expect(input).toHaveValue('')
  })

  it('? 아이콘으로 문법 도움말을 열고 예시를 고르면 채운 뒤 닫는다', async () => {
    const { input } = await openHome()
    await userEvent.click(screen.getByRole('button', { name: '문법 도움말' }))
    const help = screen.getByRole('dialog', { name: '한 줄 입력 문법' })
    await userEvent.click(within(help).getByRole('button', { name: '내일 10-11 스프린트 리뷰 #개발' }))
    expect(input).toHaveValue('내일 10-11 스프린트 리뷰 #개발')
    expect(screen.queryByRole('dialog', { name: '한 줄 입력 문법' })).not.toBeInTheDocument()
  })
})

describe('UX-09 키보드 단축키', () => {
  it('N은 빠른 입력창으로 이동하고, 입력창 안에서는 글자로 입력된다', async () => {
    const { input } = await openHome()
    await userEvent.keyboard('n')
    expect(input).toHaveFocus()
    expect(input).toHaveValue('')
    await userEvent.keyboard('n')
    expect(input).toHaveValue('n')
  })

  it('다른 화면에서 N을 누르면 홈 입력창으로 간다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { router } = renderApp('/calendar')
    await screen.findByRole('heading', { name: '캘린더' })
    await userEvent.keyboard('n')
    expect(await screen.findByRole('textbox', { name: '빠른 기록' })).toHaveFocus()
    expect(router.state.location.pathname).toBe('/')
  })

  it('설정에서 끄면 한 글자 단축키는 동작하지 않지만 Ctrl+K는 동작한다', async () => {
    const { input } = await openHome({ ...ME, keyboardShortcutsEnabled: false })
    await userEvent.keyboard('n')
    expect(input).not.toHaveFocus()
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: '명령 팔레트' })).toBeInTheDocument()
  })
})

describe('SCR-COM-03 명령 팔레트', () => {
  it('Ctrl+K로 열고 화면 이름으로 이동한다', async () => {
    const { router } = await openHome()
    await userEvent.keyboard('{Control>}k{/Control}')
    const palette = screen.getByRole('dialog', { name: '명령 팔레트' })
    expect(within(palette).getByRole('option', { name: /업무 추가/ })).toHaveTextContent('N')
    await userEvent.keyboard('캘린더{Enter}')
    expect(router.state.location.pathname).toBe('/calendar')
    expect(screen.queryByRole('dialog', { name: '명령 팔레트' })).not.toBeInTheDocument()
  })

  it('Esc로 닫으면 원래 포커스로 돌아간다', async () => {
    const { input } = await openHome()
    input.focus()
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('combobox')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '명령 팔레트' })).not.toBeInTheDocument()
    expect(input).toHaveFocus()
  })

  it('최근 사용 항목을 입력 전에 보여 준다', async () => {
    await openHome()
    await userEvent.keyboard('{Control>}k{/Control}통계{Enter}')
    await userEvent.keyboard('{Control>}k{/Control}')
    const recent = screen.getByRole('group', { name: '최근 사용' })
    expect(within(recent).getByRole('option', { name: /통계/ })).toBeInTheDocument()
  })

  it('맞는 명령이 없으면 업무로 추가를 제안하고, 고르면 홈 입력창에 채운다', async () => {
    const { input } = await openHome()
    await userEvent.keyboard('{Control>}k{/Control}보고서 작성 ~금')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('‘보고서 작성 ~금’을 업무로 추가')
    await userEvent.keyboard('{Enter}')
    expect(input).toHaveValue('보고서 작성 ~금')
    expect(input).toHaveFocus()
  })

  it('날짜를 적으면 그날 캘린더로 이동한다', async () => {
    const { router } = await openHome()
    await userEvent.keyboard('{Control>}k{/Control}10/12')
    expect(screen.getByRole('option', { name: /10\/12\(월\) 캘린더 보기/ })).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/calendar')
    expect(router.state.location.search).toBe('?date=2026-10-12')
  })
})

describe('SCR-COM-04 되돌리기 토스트', () => {
  function Harness({ calls }: { calls: string[] }) {
    const { showUndo } = useToast()
    const count = useRef(0)
    const archive = () => {
      const k = ++count.current
      showUndo({
        group: 'archive',
        message: (n) => `업무 ${n}개를 보관했어요`,
        undo: () => void calls.push(`undo-${k}`),
      })
    }
    return (
      <button type="button" onClick={archive}>
        보관
      </button>
    )
  }

  function setup() {
    vi.useFakeTimers()
    const calls: string[] = []
    render(
      <ToastProvider>
        <Harness calls={calls} />
      </ToastProvider>,
    )
    return { calls, button: screen.getByRole('button', { name: '보관' }) }
  }

  it('연속 동작은 하나로 누적하고, 되돌리면 나중 동작부터 되돌린다', async () => {
    const { calls, button } = setup()
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(screen.getByText('업무 3개를 보관했어요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await act(async () => {})
    expect(calls).toEqual(['undo-3', 'undo-2', 'undo-1'])
    expect(screen.queryByText(/보관했어요/)).not.toBeInTheDocument()
  })

  it('5초 뒤 닫히고, 마우스를 올리고 있으면 유지한다', () => {
    const { button } = setup()
    fireEvent.click(button)
    const toast = screen.getByText('업무 1개를 보관했어요').parentElement!
    act(() => vi.advanceTimersByTime(3000))
    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(10000))
    expect(screen.getByText('업무 1개를 보관했어요')).toBeInTheDocument()
    fireEvent.mouseLeave(toast)
    act(() => vi.advanceTimersByTime(1900))
    expect(screen.getByText('업무 1개를 보관했어요')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByText('업무 1개를 보관했어요')).not.toBeInTheDocument()
  })

  it('Ctrl+Z로 되돌리고, 입력창 안의 Ctrl+Z는 건드리지 않는다', async () => {
    const { calls, button } = setup()
    fireEvent.click(button)
    const field = document.createElement('input')
    document.body.append(field)
    fireEvent.keyDown(field, { code: 'KeyZ', key: 'z', ctrlKey: true })
    expect(calls).toEqual([])
    fireEvent.keyDown(document.body, { code: 'KeyZ', key: 'z', ctrlKey: true })
    await act(async () => {})
    expect(calls).toEqual(['undo-1'])
    expect(screen.queryByText(/보관했어요/)).not.toBeInTheDocument()
    field.remove()
  })
})
