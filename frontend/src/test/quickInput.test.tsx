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

// 빠른 입력이 @·#을 해석할 때 받는 프로젝트·태그 목록
const WORKLOG = {
  'GET /api/worklog/projects?includeArchived=true': () =>
    json(200, {
      items: [
        {
          id: 'p2',
          name: '영업',
          color: 'P2',
          archived: false,
          taskCount: 4,
          openTaskCount: 4,
          createdAt: '2026-10-01T00:00:00Z',
          version: 0,
        },
      ],
    }),
  'GET /api/worklog/tags': () =>
    json(200, { items: [{ id: 't1', name: '결제', usageCount: 4, createdAt: '2026-10-01T00:00:00Z', version: 0 }] }),
}

async function openHome(me: object = ME) {
  stubFetch({ 'GET /api/users/me': () => json(200, me), ...WORKLOG })
  const result = renderApp('/')
  const input = await screen.findByRole('textbox', { name: '빠른 기록' })
  return { ...result, input }
}

describe('SCR-HOME-01 첫 화면 (UX-04)', () => {
  it('설정 없이 바로 입력창과 첫 실행 안내를 보여 준다', async () => {
    await openHome()
    expect(screen.getByText('10월 7일 수요일')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '좋은 오후예요' })).toBeInTheDocument()
    // 첫 실행 안내는 남은 업무가 없다는 응답을 받은 뒤 보인다(P1-11)
    expect(await screen.findByRole('heading', { name: '오늘 할 일을 한 줄로 적어 보세요' })).toBeInTheDocument()
    // D-67: @프로젝트·#태그 (qa P1-10-06)
    expect(
      screen.getByText('시간·@프로젝트·#태그·!우선순위·~마감을 같이 적으면 알아서 나눠 저장해요.'),
    ).toBeInTheDocument()
  })

  it('예시를 누르면 입력창에 채운다', async () => {
    const { input } = await openHome()
    await userEvent.click(await screen.findByRole('button', { name: '견적서 회신 @영업 #결제 !낮음 ~금' }))
    expect(input).toHaveValue('견적서 회신 @영업 #결제 !낮음 ~금')
    expect(input).toHaveFocus()
  })
})

describe('SCR-COM-02 빠른 입력창', () => {
  it('안내 문구를 바꾸지 않으면 기본 문구를 쓴다(캘린더 업무 패널은 짧은 문구를 넘긴다)', async () => {
    const { input } = await openHome()
    expect(input).toHaveAttribute('placeholder', '무엇을 하셨나요? 한 줄로 적어 보세요')
  })

  it('알약의 빈 곳을 눌러도 입력칸에 포커스가 간다 (P1-X-10)', async () => {
    const { input } = await openHome()
    input.blur()
    fireEvent.mouseDown(input.parentElement!)
    expect(input).toHaveFocus()
  })

  it('해석 결과를 실제 날짜 칩으로 미리 보여 준다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '14-16 견적서 작성 @영업 #결제 #견적 !높음 ~금')
    const list = screen.getByRole('list', { name: '해석 결과' })
    // 목록을 받으면 없는 태그(견적)에 "새"가 붙는다
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((c) => c.textContent),
      ).toEqual(['오늘 14:00–16:00', '영업', '#결제', '#견적새', '우선순위 높음', '마감 10/9(금)']),
    )
    expect(screen.getByText('일정과 업무가 함께 만들어져요')).toBeInTheDocument()
  })

  it('@프로젝트는 그 프로젝트 색, #태그는 흰 칩이고 없는 태그는 "새 태그"로 읽힌다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '보고 @영업 #결제 #정산')
    // 사이드바 프로젝트 목록에도 같은 이름이 있어 해석 결과 안에서 찾는다
    const project = await within(await screen.findByRole('list', { name: '해석 결과' })).findByText('영업')
    expect(project).toHaveStyle({ background: 'var(--project-p2-tint)', color: 'var(--project-p2-ink)' })
    expect(screen.getByText('#결제')).toHaveClass('chip', 'tag')
    expect(await screen.findByRole('button', { name: '새 태그 정산' })).toHaveClass('tag', 'tagNew')
  })

  it('없는 프로젝트는 "새 프로젝트 만들기" 칩을 눌러 만든다', async () => {
    const created: unknown[] = []
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      ...WORKLOG,
      'POST /api/worklog/projects': (init) => {
        const body = JSON.parse(String(init?.body)) as { name: string; color: string }
        created.push(body)
        return json(201, {
          id: 'p9',
          ...body,
          archived: false,
          taskCount: 0,
          openTaskCount: 0,
          createdAt: '2026-10-07T00:00:00Z',
          version: 0,
        })
      },
    })
    renderApp('/')
    await userEvent.type(await screen.findByRole('textbox', { name: '빠른 기록' }), '보도자료 @마케팅')
    await userEvent.click(await screen.findByRole('button', { name: '+ 새 프로젝트 "마케팅" 만들기' }))
    // 영업(P2)만 쓰는 중이라 첫 빈 색 P1
    await waitFor(() => expect(created).toEqual([{ name: '마케팅', color: 'P1' }]))
    expect(await within(screen.getByRole('list', { name: '해석 결과' })).findByText('마케팅')).toHaveStyle({
      background: 'var(--project-p1-tint)',
    })
  })

  it('시각 없는 날짜는 마감으로 보여 준다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '다음주 수요일 보고서')
    // 홈의 다가오는 일정 목록과 겹치지 않게 해석 결과 안에서 찾는다
    expect(within(screen.getByRole('list', { name: '해석 결과' })).getByRole('listitem')).toHaveTextContent(
      '마감 10/14(수)',
    )
    expect(screen.getByText('업무가 만들어져요')).toBeInTheDocument()
  })

  describe('Enter', () => {
    async function renderQuick() {
      stubFetch({ 'GET /api/users/me': () => json(200, ME), ...WORKLOG })
      const onSubmit = vi.fn()
      function Wrapper() {
        const [value, setValue] = useState('')
        return <QuickInput value={value} onChange={setValue} onSubmit={onSubmit} />
      }
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <ToastProvider>
              <Wrapper />
            </ToastProvider>
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
      await userEvent.type(input, '14-16 @영업 #결제{Enter}')
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByText('할 일 이름을 적어 주세요')).toBeInTheDocument()
      expect(input).toHaveValue('14-16 @영업 #결제')
    })

    it('제목 없이 Enter를 누르면 오류로 알리고, 다시 적기 시작하면 안내로 돌아간다', async () => {
      const { onSubmit, input } = await renderQuick()
      await userEvent.type(input, '내일 15:00')
      expect(input).not.toHaveAttribute('aria-invalid')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await userEvent.keyboard('{Enter}')
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('할 일 이름을 적어 주세요')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAccessibleDescription(expect.stringContaining('할 일 이름을 적어 주세요'))
      expect(input).toHaveFocus()
      await userEvent.type(input, ' 회의')
      expect(input).not.toHaveAttribute('aria-invalid')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await userEvent.keyboard('{Enter}')
      expect(onSubmit).toHaveBeenCalledWith({
        title: '회의',
        schedule: { date: '2026-10-08', start: '15:00', end: '16:00' },
      })
    })

    it('시간처럼 생겼는데 읽지 못한 낱말은 입력창 아래에 알린다', async () => {
      const { input } = await renderQuick()
      await userEvent.type(input, '회의 14—15')
      expect(input).toHaveAccessibleDescription(expect.stringContaining('시간으로 읽지 못했어요: 14—15'))
      await userEvent.clear(input)
      await userEvent.type(input, '회의 9:00~10:00')
      expect(screen.queryByText(/시간으로 읽지 못했어요/)).not.toBeInTheDocument()
      expect(within(screen.getByRole('list', { name: '해석 결과' })).getByRole('button')).toHaveTextContent(
        '오늘 09:00–10:00',
      )
    })

    it('제목이 있으면 해석 결과로 저장하고 입력을 비운다', async () => {
      const { onSubmit, input } = await renderQuick()
      await userEvent.type(input, '견적서 14-16 @영업 #결제{Enter}')
      expect(onSubmit).toHaveBeenCalledWith({
        title: '견적서',
        project: '영업',
        tags: ['결제'],
        schedule: { date: '2026-10-07', start: '14:00', end: '16:00' },
      })
      await waitFor(() => expect(input).toHaveValue(''))
    })
  })

  it('저장에 실패하면(onSubmit 거부) 입력을 그대로 남긴다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const onSubmit = vi.fn(() => Promise.reject(new Error('저장 실패')))
    function Wrapper() {
      const [value, setValue] = useState('')
      return <QuickInput value={value} onChange={setValue} onSubmit={onSubmit} />
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <ToastProvider>
            <Wrapper />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>,
    )
    const input = await screen.findByRole('textbox', { name: '빠른 입력' })
    await userEvent.type(input, '보고서{Enter}')
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(input).toHaveValue('보고서')
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
    await userEvent.click(within(help).getByRole('button', { name: '내일 10-11 스프린트 리뷰 @개발' }))
    expect(input).toHaveValue('내일 10-11 스프린트 리뷰 @개발')
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
    const { router } = renderApp('/logs')
    await screen.findByRole('heading', { name: '업무일지' })
    await userEvent.keyboard('n')
    expect(await screen.findByRole('textbox', { name: '빠른 기록' })).toHaveFocus()
    expect(router.state.location.pathname).toBe('/')
  })

  it('오프라인이면 N으로 기록하러 가지 않는다 (SCR-SYS-02 ③)', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { router } = renderApp('/logs')
    await screen.findByRole('heading', { name: '업무일지' })
    await userEvent.keyboard('n')
    expect(router.state.location.pathname).toBe('/logs')
    onLine.mockRestore()
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
    await userEvent.keyboard('업무일지{Enter}')
    expect(router.state.location.pathname).toBe('/logs')
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
    // 캘린더 화면이 그날 일정을 받는다
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      ...WORKLOG,
      'GET /api/worklog/schedules': () => json(200, { items: [] }),
      // 캘린더 업무 패널(P1-08)이 일정 없는 업무를 받는다
      'GET /api/worklog/tasks': () => json(200, { items: [] }),
    })
    await userEvent.keyboard('{Control>}k{/Control}10/12')
    expect(screen.getByRole('option', { name: /10\/12\(월\) 캘린더 보기/ })).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/calendar/day/2026-10-12')
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
