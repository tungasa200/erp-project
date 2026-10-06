import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ME, json, problem, renderApp } from '../test/renderApp'
import { CalendarPage } from './CalendarPage'
import { handleScheduleMock } from './mockSchedules'

const routes = [
  { path: '/calendar/list', element: <CalendarPage /> },
  { path: '/calendar/:view/:date', element: <CalendarPage /> },
]

// 2026-10-07(수) 서울 10:00–11:00, 평일 반복
const standup = {
  id: 'schedule-standup',
  title: '팀 스탠드업',
  allDay: false,
  startAt: '2026-10-07T01:00:00.000Z',
  endAt: '2026-10-07T02:00:00.000Z',
  startDate: null,
  endDate: null,
  timezone: 'Asia/Seoul',
  recurrence: {
    frequency: 'WEEKLY',
    weekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    until: '2026-10-09',
  },
  taskId: null,
  memo: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 0,
  overrides: {},
}

/** 일정 요청은 가짜 일정 서버로, 나머지는 로그인 사용자·빈 프로젝트 목록으로 답한다 */
function stubServer() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('/api/worklog/schedules')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      return handleScheduleMock(method, url, body, { json, problem })!
    }
    if (url === '/api/users/me') return json(200, ME)
    if (url.startsWith('/api/worklog/projects')) return json(200, { items: [] })
    if (url === '/api/worklog/tasks' && method === 'POST') {
      const body = JSON.parse(String(init!.body))
      return json(201, task('task-new', body.title, body.dueDate ?? null))
    }
    if (url.startsWith('/api/worklog/tasks?')) {
      // 일정 없는 업무만(scheduled=false) — 일정이 연결된 업무는 빠진다
      const linked = new Set(
        JSON.parse(localStorage.getItem('worklog.mock.schedules') ?? '[]').map((x: { taskId: string }) => x.taskId),
      )
      return json(200, { items: tasks.filter((t) => !linked.has(t.id)) })
    }
    return problem(404, 'NOT_FOUND')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const task = (id: string, title: string, dueDate: string | null) => ({
  id,
  title,
  status: 'TODO',
  priority: 'NORMAL',
  progress: 0,
  dueDate,
  projectId: null,
  tagIds: [],
  hasSchedule: false,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 0,
})
const tasks = [task('task-report', '9월 매출 보고서', '2026-10-06'), task('task-idea', '아이디어 정리', null)]

beforeEach(() => {
  localStorage.setItem('worklog.mock.schedules', JSON.stringify([standup]))
})

// matchMedia 등 테스트에서 바꾼 전역을 다음 테스트로 넘기지 않는다
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('캘린더', () => {
  it('주 보기: 주 시작 요일·공휴일·반복 회차를 그린다', async () => {
    stubServer()
    renderApp('/calendar/week/2026-10-07', routes)
    expect(await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })).toBeInTheDocument()
    // 그리드는 첫 로딩(스켈레톤) 뒤에 그려진다
    expect(await screen.findByText('대체공휴일(개천절)')).toBeInTheDocument()
    expect(screen.getByText('한글날')).toBeInTheDocument()
    // until 10/9까지 수·목·금 3회
    expect(await screen.findAllByRole('button', { name: /^팀 스탠드업, 10:00–11:00, 반복$/ })).toHaveLength(3)
  })

  it('단축키 M으로 월 보기, J로 다음 달, K로 이전 달', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })
    await user.keyboard('m')
    expect(await screen.findByRole('heading', { level: 1, name: '2026년 10월' })).toBeInTheDocument()
    await user.keyboard('j')
    expect(await screen.findByRole('heading', { level: 1, name: '2026년 11월' })).toBeInTheDocument()
    await user.keyboard('k')
    await user.keyboard('k')
    expect(await screen.findByRole('heading', { level: 1, name: '2026년 9월' })).toBeInTheDocument()
  })

  it('일정 만들기 → 상세 모달에서 저장하면 그리드에 나타난다', async () => {
    const fetchMock = stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })
    await user.click(screen.getByRole('button', { name: '일정 만들기' }))
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(within(dialog).getByText('일정 이름을 적어 주세요')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('제목'), '견적서 작성')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 일정' })).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
    expect(await screen.findByRole('button', { name: /^견적서 작성, / })).toBeInTheDocument()
  })

  it('반복 일정 삭제: 범위를 묻고, "이 일정만"이면 그 회차만 빠진 뒤 토스트로 되돌릴 수 있다', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    const blocks = await screen.findAllByRole('button', { name: /^팀 스탠드업, / })
    blocks[0].focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
    await user.click(await within(dialog).findByRole('button', { name: '삭제' }))

    const scope = await screen.findByRole('alertdialog', { name: '반복 일정을 삭제할까요?' })
    expect(within(scope).getByLabelText('이 일정만')).toBeChecked()
    await user.click(within(scope).getByRole('button', { name: '확인' }))

    await waitFor(() => expect(screen.getAllByRole('button', { name: /^팀 스탠드업, / })).toHaveLength(2))
    // 대화상자가 돌려준 블록이 사라지면 포커스는 body가 아니라 캘린더 제목으로(P1-07-18)
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-focus-fallback'))
    expect(screen.getByText('일정을 삭제했어요')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^팀 스탠드업, / })).toHaveLength(3))
  })

  it('상세 모달에서 시간을 바꿔 저장하면 포커스는 다시 그려진 같은 일정 블록으로', async () => {
    // 반복 없는 일정: 10-08(목) 서울 14:00–15:00
    const review = { ...standup, id: 'schedule-review', title: '주간 리뷰', recurrence: null }
    Object.assign(review, { startAt: '2026-10-08T05:00:00.000Z', endAt: '2026-10-08T06:00:00.000Z' })
    localStorage.setItem('worklog.mock.schedules', JSON.stringify([standup, review]))
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    ;(await screen.findByRole('button', { name: /^주간 리뷰, 14:00–15:00/ })).focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
    fireEvent.change(within(dialog).getByLabelText('시작'), { target: { value: '16:00' } })
    fireEvent.change(within(dialog).getByLabelText('종료'), { target: { value: '17:00' } })
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    const moved = await screen.findByRole('button', { name: /^주간 리뷰, 16:00–17:00/ })
    await waitFor(() => expect(moved).toHaveFocus())
  })

  it.each([
    ['이 일정만', /^팀 스탠드업, 11:00–12:00/, 1],
    ['모든 일정', /^팀 스탠드업, 11:00–12:00/, 3],
  ])(
    '반복 회차 시간을 범위 대화상자(%s)를 거쳐 저장하면 포커스는 그날의 같은 일정 블록으로',
    async (label, moved, count) => {
      stubServer()
      const user = userEvent.setup()
      renderApp('/calendar/week/2026-10-07', routes)
      // 10-07(수) 회차
      ;(await screen.findAllByRole('button', { name: /^팀 스탠드업, 10:00–11:00/ }))[0].focus()
      await user.keyboard('{Enter}')
      const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
      fireEvent.change(within(dialog).getByLabelText('시작'), { target: { value: '11:00' } })
      fireEvent.change(within(dialog).getByLabelText('종료'), { target: { value: '12:00' } })
      await user.click(within(dialog).getByRole('button', { name: '저장' }))
      const scope = await screen.findByRole('alertdialog', { name: '반복 일정을 수정할까요?' })
      await user.click(within(scope).getByLabelText(label))
      await user.click(within(scope).getByRole('button', { name: '확인' }))

      await waitFor(() => expect(screen.getAllByRole('button', { name: moved })).toHaveLength(count))
      await waitFor(() =>
        expect(document.activeElement).toHaveAttribute('data-focus-group', 'schedule-standup@2026-10-07'),
      )
      expect(document.activeElement).toHaveAccessibleName(moved)
    },
  )

  it('데스크톱에서 연 업무 패널은 창이 태블릿·모바일 폭으로 줄면 접힌다', async () => {
    let width = 1280
    const listeners = new Set<() => void>()
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        get matches() {
          const max = /max-width: (\d+)px/.exec(query)
          const min = /min-width: (\d+)px/.exec(query)
          return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
        },
        addEventListener: (_: string, l: () => void) => listeners.add(l),
        removeEventListener: (_: string, l: () => void) => listeners.delete(l),
      })),
    )
    stubServer()
    renderApp('/calendar/week/2026-10-07', routes)
    expect(await screen.findByRole('complementary', { name: '할 일 상자' })).toBeInTheDocument()

    act(() => {
      width = 390
      listeners.forEach((l) => l())
    })
    expect(screen.queryByRole('complementary', { name: '할 일 상자' })).not.toBeInTheDocument()

    // 1024~1279px도 접힘이 기본(P1-07-15)
    act(() => {
      width = 1280
      listeners.forEach((l) => l())
    })
    expect(screen.getByRole('complementary', { name: '할 일 상자' })).toBeInTheDocument()
    act(() => {
      width = 1024
      listeners.forEach((l) => l())
    })
    expect(screen.queryByRole('complementary', { name: '할 일 상자' })).not.toBeInTheDocument()
  })

  it('저장이 칸 오류로 막히면 오류 문구를 그 칸에 연결하고 포커스를 옮긴다 (P1-05-03)', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })
    await user.click(screen.getByRole('button', { name: '일정 만들기' }))
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    await user.type(within(dialog).getByLabelText('제목'), '겹침')
    fireEvent.change(within(dialog).getByLabelText('시작'), { target: { value: '15:00' } })
    fireEvent.change(within(dialog).getByLabelText('종료'), { target: { value: '14:00' } })
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    const end = within(dialog).getByLabelText('종료')
    const message = within(dialog).getByRole('alert')
    expect(message).toHaveTextContent('끝나는 시각을 시작보다 뒤로 골라 주세요')
    expect(end).toHaveAttribute('aria-invalid', 'true')
    expect(end).toHaveAttribute('aria-describedby', message.id)
    await waitFor(() => expect(end).toHaveFocus())
    expect(within(dialog).getByLabelText('시작')).not.toHaveAttribute('aria-invalid')

    // 반복 횟수 칸도 같은 방식
    fireEvent.change(end, { target: { value: '16:00' } })
    await user.click(within(dialog).getByRole('button', { name: '매일' }))
    await user.click(within(dialog).getByLabelText('횟수'))
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    const count = within(dialog).getByLabelText('반복 횟수')
    expect(count).toHaveAttribute('aria-invalid', 'true')
    expect(count).toHaveAccessibleDescription('반복 횟수는 1~999 사이로 적어 주세요')
    await waitFor(() => expect(count).toHaveFocus())
  })

  it('충돌 띠의 [새로 불러오기]는 다른 곳에서 바꾼 최신 값으로 칸을 다시 채운다 (P1-05-05)', async () => {
    const review = { ...standup, id: 'schedule-review', title: '주간 리뷰', recurrence: null }
    Object.assign(review, { startAt: '2026-10-08T05:00:00.000Z', endAt: '2026-10-08T06:00:00.000Z' })
    localStorage.setItem('worklog.mock.schedules', JSON.stringify([standup, review]))
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    ;(await screen.findByRole('button', { name: /^주간 리뷰, / })).focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
    await waitFor(() => expect(within(dialog).getByLabelText('제목')).toHaveValue('주간 리뷰'))

    // 다른 탭에서 제목을 바꿔 저장한 상태
    const stored = JSON.parse(localStorage.getItem('worklog.mock.schedules')!)
    const other = stored.find((x: { id: string }) => x.id === 'schedule-review')
    Object.assign(other, { title: '주간 리뷰 A수정', version: other.version + 1 })
    localStorage.setItem('worklog.mock.schedules', JSON.stringify(stored))

    await user.type(within(dialog).getByLabelText('메모'), '내 메모')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await user.click(await within(dialog).findByRole('button', { name: '새로 불러오기' }))
    await waitFor(() => expect(within(dialog).getByLabelText('제목')).toHaveValue('주간 리뷰 A수정'))
    expect(within(dialog).getByLabelText('메모')).toHaveValue('')
  })

  it('매주 기본 요일은 지금 시작일의 요일만, 직접 고른 요일은 시작일을 바꿔도 남는다 (P1-06-02)', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })
    await user.click(screen.getByRole('button', { name: '일정 만들기' }))
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    const date = within(dialog).getByLabelText('날짜')
    fireEvent.change(date, { target: { value: '2026-10-12' } }) // 월
    fireEvent.change(date, { target: { value: '2026-10-13' } }) // 화
    await user.click(within(dialog).getByRole('button', { name: '매주' }))
    const days = within(within(dialog).getByRole('group', { name: '반복 요일' }))
    const pressed = () =>
      days
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent)
    expect(pressed()).toEqual(['화'])

    // 목을 직접 고르고 시작일을 수요일로: 화(시작일이라 들어갔던 요일)는 빠지고 목은 남는다
    await user.click(days.getByRole('button', { name: '목' }))
    fireEvent.change(date, { target: { value: '2026-10-14' } })
    expect(pressed()).toEqual(['수', '목'])
  })

  it('업무 상세 [캘린더에 배치]로 오면 그 업무의 만들기 창을 한 번 연다', async () => {
    stubServer()
    const user = userEvent.setup()
    const { router } = renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })
    await act(() =>
      router.navigate('/calendar/day/2026-10-07', {
        state: { scheduleTask: { id: 'task-report', title: '9월 매출 보고서' } },
      }),
    )
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    expect(within(dialog).getByLabelText('제목')).toHaveValue('9월 매출 보고서')
    // state는 지워 닫은 뒤 다시 열리지 않는다
    await waitFor(() => expect(router.state.location.state).toBeNull())
    await user.click(within(dialog).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog', { name: '새 일정' })).not.toBeInTheDocument()
  })

  it('오프라인이면 단축키 C로 만들기 창이 열리지 않는다 (P1-X-04)', async () => {
    stubServer()
    const user = userEvent.setup()
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })
    await user.keyboard('c')
    expect(screen.queryByRole('dialog', { name: '새 일정' })).not.toBeInTheDocument()
    onLine.mockRestore()
  })

  it('업무 패널: 마감순 카드, 날짜 없는 업무는 접고, "일정 잡기"로 업무에 연결된 일정을 만든다', async () => {
    const fetchMock = stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    const panel = await screen.findByRole('complementary', { name: '할 일 상자' })
    expect(await within(panel).findByText('9월 매출 보고서')).toBeInTheDocument()
    expect(within(panel).queryByText('아이디어 정리')).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: '날짜 없는 업무 1개 더 보기' }))
    expect(within(panel).getByText('아이디어 정리')).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: '9월 매출 보고서 일정 잡기' }))
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    expect(within(dialog).getByLabelText('제목')).toHaveValue('9월 매출 보고서')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(within(panel).queryByText('9월 매출 보고서')).not.toBeInTheDocument())
    // 배치한 카드가 사라지면 포커스는 같은 자리의 이웃 카드로
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/ 일정 잡기$/))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post![1]!.body))).toMatchObject({ title: '9월 매출 보고서', taskId: 'task-report' })
  })

  it('P로 업무 패널을 닫고 연다', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('complementary', { name: '할 일 상자' })
    await user.keyboard('p')
    expect(screen.queryByRole('complementary', { name: '할 일 상자' })).not.toBeInTheDocument()
    await user.keyboard('p')
    expect(screen.getByRole('complementary', { name: '할 일 상자' })).toBeInTheDocument()
  })

  it('업무 패널 빠른 입력으로 업무를 만들면 되돌리기 토스트가 뜬다', async () => {
    const fetchMock = stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    const panel = await screen.findByRole('complementary', { name: '할 일 상자' })
    await user.type(within(panel).getByLabelText('업무 빠른 입력'), '보고서 정리{Enter}')
    expect(await screen.findByText('업무를 만들었어요')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/worklog/tasks' && init?.method === 'POST')
    expect(JSON.parse(String(post![1]!.body))).toMatchObject({ title: '보고서 정리' })
    expect(within(panel).getByLabelText('업무 빠른 입력')).toHaveValue('')
  })
})
