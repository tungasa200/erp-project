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
    // 시간 기록 옵션(timed)과 일 보기 실제 열(SCR-CAL-02 ④)이 받는 빈 시간·합계
    if (url === '/api/worklog/me')
      return json(200, { userId: 'u-1', settings: { timeTrackingEnabled: timed, version: 0 } })
    if (url === '/api/worklog/timer') return json(200, { running: null })
    if (url.startsWith('/api/worklog/records/gaps?')) return json(200, { items: gaps })
    if (url.startsWith('/api/worklog/records/time-summary?'))
      return json(200, { from: '', to: '', totalMin, recordCount: 0, projects: [], tasks: [] })
    // 일 보기 "이날의 기록"·일정 상세 ⑥이 받는 그날 기록과 기록 한 건
    if (url.startsWith('/api/worklog/records?')) return json(200, { items: records })
    const one = /^\/api\/worklog\/records\/([^/?]+)$/.exec(url)
    if (one) {
      const found = records.find((r) => r.id === one[1])
      return found ? json(200, found) : problem(404, 'NOT_FOUND')
    }
    if (url.startsWith('/api/worklog/projects')) return json(200, { items: [] })
    if (url === '/api/worklog/tasks' && method === 'POST') {
      const body = JSON.parse(String(init!.body))
      return json(201, task('task-new', body.title, body.dueDate ?? null))
    }
    const detail = /^\/api\/worklog\/tasks\/([^/?]+)$/.exec(url)
    if (detail) {
      const found = tasks.find((t) => t.id === detail[1])
      return found ? json(200, found) : problem(404, 'NOT_FOUND')
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

const workRecord = (id: string, over: Record<string, unknown>) => ({
  id,
  status: 'CONFIRMED',
  workDate: '2026-10-07',
  content: '',
  taskId: null,
  projectId: null,
  tagIds: [],
  scheduleId: null,
  occurrenceStart: null,
  result: null,
  outcome: null,
  progress: null,
  startAt: null,
  endAt: null,
  durationMin: null,
  deletedAt: null,
  createdAt: '2026-10-07T00:00:00Z',
  updatedAt: '2026-10-07T00:00:00Z',
  version: 0,
  ...over,
})
let records: ReturnType<typeof workRecord>[] = []
let timed = false
let gaps: Record<string, unknown>[] = []
let totalMin = 0

beforeEach(() => {
  localStorage.setItem('worklog.mock.schedules', JSON.stringify([standup]))
  records = []
  timed = false
  gaps = []
  totalMin = 0
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

  it('오프라인이면 일정은 열어 보기만 하고, 기간 이동은 된다 (SCR-SYS-02 ③)', async () => {
    stubServer()
    const user = userEvent.setup()
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderApp('/calendar/week/2026-10-07', routes)
    const panel = await screen.findByRole('complementary', { name: '할 일 상자' })
    expect(await within(panel).findByRole('button', { name: '9월 매출 보고서 일정 잡기' })).toBeDisabled()
    expect(within(panel).getByLabelText('업무 빠른 입력')).toBeDisabled()
    expect(screen.getByRole('button', { name: '일정 만들기' })).toBeDisabled()

    ;(await screen.findAllByRole('button', { name: /^팀 스탠드업, / }))[0].focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
    await waitFor(() => expect(within(dialog).getByLabelText('제목')).toHaveValue('팀 스탠드업'))
    expect(within(dialog).getByRole('status')).toHaveTextContent('연결이 끊겼어요')
    expect(within(dialog).getByLabelText('제목')).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '저장' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '삭제' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('dialog', { name: '일정 편집' })).not.toBeInTheDocument()

    await user.keyboard('j')
    expect(await screen.findByRole('heading', { name: '2026년 10월 12일 – 18일' })).toBeInTheDocument()
    onLine.mockRestore()
  })

  it('편집 중에 연결이 끊기면 칸이 꺼지고 포커스는 닫기 버튼으로 간다', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    ;(await screen.findAllByRole('button', { name: /^팀 스탠드업, / }))[0].focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
    const title = within(dialog).getByLabelText('제목')
    await waitFor(() => expect(title).toHaveValue('팀 스탠드업'))
    title.focus()

    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(title).toBeDisabled()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '닫기' })).toHaveFocus())
    onLine.mockRestore()
    // React Query onlineManager도 offline 이벤트로 멈췄으니 online으로 되돌려 다음 테스트의 저장이 멈추지 않게 한다
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
  })

  it('끊긴 채로 처음 연 일정은 캘린더에 있는 제목·시간·반복을 읽기 전용으로 보이고 나머지는 연결되면 불러온다 (SCR-SYS-02 ③)', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    ;(await screen.findAllByRole('button', { name: /^팀 스탠드업, / }))[0].focus()
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    try {
      await user.keyboard('{Enter}')
      const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
      expect(await within(dialog).findByText('연결이 끊겼어요. 연결되면 나머지를 불러와요')).toBeInTheDocument()
      expect(within(dialog).getByText('팀 스탠드업')).toBeInTheDocument()
      expect(within(dialog).getByText(/10:00~11:00$/)).toBeInTheDocument()
      expect(within(dialog).getByText('반복 일정')).toBeInTheDocument()
      // 고칠 칸·삭제·저장은 없다(열어 보기만)
      expect(within(dialog).queryByRole('textbox')).toBeNull()
      expect(within(dialog).queryByRole('button', { name: '삭제' })).toBeNull()

      onLine.mockRestore()
      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      // 다시 연결되면 저절로 채운다
      await waitFor(() => expect(within(dialog).getByLabelText('제목')).toHaveValue('팀 스탠드업'))
    } finally {
      // 실패해도 React Query onlineManager를 되돌려야 뒤 테스트의 요청이 멈추지 않는다
      onLine.mockRestore()
      act(() => {
        window.dispatchEvent(new Event('online'))
      })
    }
  })

  it('상세 모달에서 업무를 검색해 연결하면 저장 때 taskId를 보낸다 (P1-05-06)', async () => {
    const review = { ...standup, id: 'schedule-review', title: '주간 리뷰', recurrence: null }
    Object.assign(review, { startAt: '2026-10-08T05:00:00.000Z', endAt: '2026-10-08T06:00:00.000Z' })
    localStorage.setItem('worklog.mock.schedules', JSON.stringify([standup, review]))
    const fetchMock = stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    ;(await screen.findByRole('button', { name: /^주간 리뷰, / })).focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
    await user.type(await within(dialog).findByRole('combobox', { name: '연결 업무' }), '보고')
    await user.click(await within(dialog).findByRole('option', { name: '9월 매출 보고서' }))
    expect(await within(dialog).findByRole('link', { name: '9월 매출 보고서' })).toHaveAttribute(
      'href',
      '/tasks/task-report',
    )
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '일정 편집' })).not.toBeInTheDocument())
    const patch = fetchMock.mock.calls.find(
      ([url, init]) => init?.method === 'PATCH' && String(url).endsWith('schedule-review'),
    )
    expect(JSON.parse(String(patch![1]!.body))).toMatchObject({ taskId: 'task-report' })
  })

  it('반복 회차를 "이 일정만" 바꾸며 업무를 연결할 때 시리즈 연결이 실패하면 서버 값으로 다시 맞추고 알린다', async () => {
    const fetchMock = stubServer()
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      init?.method === 'PATCH' && String(input) === '/api/worklog/schedules/schedule-standup'
        ? problem(500, 'INTERNAL_ERROR')
        : base(input, init),
    )
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    ;(await screen.findAllByRole('button', { name: /^팀 스탠드업, 10:00–11:00/ }))[0].focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
    await waitFor(() => expect(within(dialog).getByLabelText('시작')).toHaveValue('10:00'))
    fireEvent.change(within(dialog).getByLabelText('시작'), { target: { value: '11:00' } })
    fireEvent.change(within(dialog).getByLabelText('종료'), { target: { value: '12:00' } })
    await user.type(within(dialog).getByRole('combobox', { name: '연결 업무' }), '보고')
    await user.click(await within(dialog).findByRole('option', { name: '9월 매출 보고서' }))
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    const scope = await screen.findByRole('alertdialog', { name: '반복 일정을 수정할까요?' })
    await user.click(within(scope).getByRole('button', { name: '확인' }))

    expect(await screen.findByText(/이 일정은 바꿨지만 업무 연결은 저장하지 못했어요/)).toBeInTheDocument()
    // 회차 변경 응답의 version으로 시리즈 연결을 보냈다
    const calls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    const occurrence = calls.find(([url]) => String(url).includes('/occurrences/'))!
    const series = calls.find(([url]) => String(url) === '/api/worklog/schedules/schedule-standup')!
    expect(JSON.parse(String(series[1]!.body))).toEqual({ version: 1, taskId: 'task-report' })
    expect(JSON.parse(String(occurrence[1]!.body)).version).toBe(0)
    // 모달은 열린 채 서버 값(바뀐 시각, 연결 없음)으로 다시 채운다
    await waitFor(() => expect(within(dialog).getByLabelText('시작')).toHaveValue('11:00'))
    expect(within(dialog).getByRole('combobox', { name: '연결 업무' })).toBeInTheDocument()
  })

  it('1279px 이하에서 떠 있는 업무 패널은 Esc로 닫히고 포커스는 캘린더 제목으로, 1280px 이상은 그대로', async () => {
    let width = 1024
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        get matches() {
          const max = /max-width: (\d+)px/.exec(query)
          const min = /min-width: (\d+)px/.exec(query)
          return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    )
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })
    expect(screen.queryByRole('complementary', { name: '할 일 상자' })).not.toBeInTheDocument()
    await user.keyboard('p')
    expect(screen.getByRole('complementary', { name: '할 일 상자' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: '할 일 상자' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('1280px 이상에서 그리드 옆 업무 패널은 Esc로 닫히지 않는다', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('complementary', { name: '할 일 상자' })
    await user.keyboard('{Escape}')
    expect(screen.getByRole('complementary', { name: '할 일 상자' })).toBeInTheDocument()
  })

  it.each(['이 일정만', '모든 일정'])(
    '반복 일정을 키보드로 범위 대화상자(%s)를 거쳐 삭제하면 포커스는 캘린더 제목으로 (P1-06-04)',
    async (label) => {
      stubServer()
      const user = userEvent.setup()
      renderApp('/calendar/week/2026-10-07', routes)
      ;(await screen.findAllByRole('button', { name: /^팀 스탠드업, / }))[0].focus()
      await user.keyboard('{Enter}')
      const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
      within(dialog).getByRole('button', { name: '삭제' }).focus()
      await user.keyboard('{Enter}')
      const scope = await screen.findByRole('alertdialog', { name: '반복 일정을 삭제할까요?' })
      await user.click(within(scope).getByLabelText(label))
      within(scope).getByRole('button', { name: '확인' }).focus()
      await user.keyboard('{Enter}')
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      await waitFor(() => expect(document.activeElement).toHaveAttribute('data-focus-fallback'))
    },
  )

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
    expect(within(panel).getByLabelText('업무 빠른 입력')).toHaveAttribute('placeholder', '+ 업무 추가')
    await user.type(within(panel).getByLabelText('업무 빠른 입력'), '보고서 정리{Enter}')
    expect(await screen.findByText('업무를 만들었어요')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/worklog/tasks' && init?.method === 'POST')
    expect(JSON.parse(String(post![1]!.body))).toMatchObject({ title: '보고서 정리' })
    expect(within(panel).getByLabelText('업무 빠른 입력')).toHaveValue('')
  })

  it('일 보기 "이날의 기록": 시간 없는 기록까지 상태와 함께 보이고, 누르면 기록 창, [기록 추가]는 그날 새 기록 (SCR-CAL-02)', async () => {
    stubServer()
    records = [
      workRecord('r-plan', {
        status: 'PENDING',
        content: '팀 스탠드업',
        scheduleId: standup.id,
        occurrenceStart: standup.startAt,
      }),
      workRecord('r-note', { content: '견적 메일 회신', result: '금요일까지 확정' }),
    ]
    const user = userEvent.setup()
    renderApp('/calendar/day/2026-10-07', routes)
    const panel = await screen.findByRole('region', { name: '이날의 기록' })
    const note = await within(panel).findByRole('button', { name: /견적 메일 회신/ })
    expect(note).toHaveTextContent('했어요')
    expect(note).toHaveTextContent('금요일까지 확정')
    expect(within(panel).getByRole('button', { name: /팀 스탠드업/ })).toHaveTextContent('확인 대기')
    // 확인 대기는 시간이 비어 있어 계획 시간을 적는다(홈 확인 대기 목록과 같게)
    expect(within(panel).getByRole('button', { name: /팀 스탠드업/ })).toHaveTextContent('계획 10:00 – 11:00')

    await user.click(within(panel).getByRole('button', { name: /팀 스탠드업/ }))
    const dialog = await screen.findByRole('dialog', { name: '확인 대기 수정' })
    await user.click(within(dialog).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(within(panel).getByRole('button', { name: /팀 스탠드업/ })).toHaveFocus())

    await user.click(within(panel).getByRole('button', { name: '기록 추가' }))
    const add = await screen.findByRole('dialog', { name: '기록 추가' })
    expect(within(add).getByLabelText('날짜')).toHaveValue('2026-10-07')
  })

  it('일 보기 "이날의 기록": 끝나기 전 회차의 확인 대기는 홈 ③처럼 보이지 않는다 (D-31)', async () => {
    // 2026-10-07 서울 10:30 — 스탠드업(10:00–11:00)이 아직 진행 중. 타이머를 1분 미만으로 버리면 서버가 PENDING을 준다
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-07T01:30:00.000Z'))
    stubServer()
    records = [
      workRecord('r-plan', {
        status: 'PENDING',
        content: '팀 스탠드업',
        scheduleId: standup.id,
        occurrenceStart: standup.startAt,
      }),
      workRecord('r-note', { content: '견적 메일 회신' }),
    ]
    try {
      renderApp('/calendar/day/2026-10-07', routes)
      const panel = await screen.findByRole('region', { name: '이날의 기록' })
      await within(panel).findByRole('button', { name: /견적 메일 회신/ })
      expect(within(panel).queryByRole('button', { name: /팀 스탠드업/ })).not.toBeInTheDocument()
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('일정 상세 ⑥ [기록 보기]는 일정 창을 닫고 그 회차의 기록 창을 연다 (SCR-CAL-07)', async () => {
    stubServer()
    records = [
      workRecord('r-plan', {
        status: 'DISMISSED',
        content: '팀 스탠드업',
        scheduleId: standup.id,
        occurrenceStart: standup.startAt,
      }),
    ]
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    const [block] = await screen.findAllByRole('button', { name: /^팀 스탠드업, 10:00–11:00, 반복$/ })
    block.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
    expect(await within(dialog).findByText('안 했어요')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '기록 보기' }))
    const recordDialog = await screen.findByRole('dialog', { name: '기록 수정' })
    expect(screen.queryByRole('dialog', { name: '일정 편집' })).toBeNull()
    // 일정 창은 이미 닫혔으므로 기록 창을 닫으면 그 일정 블록으로 돌아간다
    await waitFor(() => expect(within(recordDialog).getByLabelText(/한 일/)).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^팀 스탠드업, 10:00–11:00, 반복$/ })[0]).toHaveFocus(),
    )
  })

  describe('일 보기 계획/실제 두 열 (SCR-CAL-02 ④, D-105)', () => {
    // 2026-10-07 서울 13:00–14:30 확정 기록, 15:00–16:00 빈 시간
    const timedRecord = () =>
      workRecord('r-quote', {
        content: '견적서 작성',
        startAt: '2026-10-07T04:00:00.000Z',
        endAt: '2026-10-07T05:30:00.000Z',
        durationMin: 90,
      })
    const gap = {
      startAt: '2026-10-07T06:00:00.000Z',
      endAt: '2026-10-07T07:00:00.000Z',
      minutes: 60,
      previous: null,
      plan: null,
      frequent: null,
    }

    it('옵션이 켜지면 실제 열에 시간 기록·빈 시간·합계를 그리고, 기록을 누르면 기록 창, 빈 시간을 누르면 메우기 창', async () => {
      stubServer()
      timed = true
      records = [timedRecord()]
      gaps = [gap]
      totalMin = 90
      const user = userEvent.setup()
      renderApp('/calendar/day/2026-10-07', routes)
      const column = await screen.findByRole('group', { name: '실제, 1시간 30분' })
      expect(screen.getByText('계획')).toBeInTheDocument()
      // 계획 열의 일정 블록은 그대로 있다
      expect(await screen.findByRole('button', { name: /^팀 스탠드업, 10:00–11:00/ })).toBeInTheDocument()

      const block = await within(column).findByRole('button', { name: '견적서 작성, 13:00–14:30' })
      await user.click(block)
      const dialog = await screen.findByRole('dialog', { name: '기록 수정' })
      await user.keyboard('{Escape}')
      expect(dialog).not.toBeInTheDocument()
      await waitFor(() =>
        expect(within(column).getByRole('button', { name: '견적서 작성, 13:00–14:30' })).toHaveFocus(),
      )

      await user.click(within(column).getByRole('button', { name: /^빈 시간 15:00–16:00, 1시간/ }))
      expect(await screen.findByRole('dialog', { name: '빈 시간 메우기' })).toBeInTheDocument()
    })

    it('끊기면 빈 시간 채우기는 꺼지고 기록은 그대로 보인다', async () => {
      stubServer()
      timed = true
      records = [timedRecord()]
      gaps = [gap]
      renderApp('/calendar/day/2026-10-07', routes)
      const column = await screen.findByRole('group', { name: '실제' })
      const gapButton = await within(column).findByRole('button', { name: /^빈 시간 15:00–16:00/ })
      const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      act(() => {
        window.dispatchEvent(new Event('offline'))
      })
      await waitFor(() => expect(gapButton).toBeDisabled())
      expect(gapButton).toHaveAccessibleName(/연결되면 채울 수 있어요/)
      expect(within(column).getByRole('button', { name: '견적서 작성, 13:00–14:30' })).toBeEnabled()
      onLine.mockRestore()
      // react-query의 연결 상태는 전역이라 다음 테스트를 위해 다시 연결한다
      act(() => {
        window.dispatchEvent(new Event('online'))
      })
    })

    it('기록이 없으면 실제 열에 안내한다', async () => {
      stubServer()
      timed = true
      renderApp('/calendar/day/2026-10-07', routes)
      const column = await screen.findByRole('group', { name: '실제' })
      expect(await within(column).findByText('시간을 남긴 기록이 없어요')).toBeInTheDocument()
    })

    it('주 보기에는 실제 열이 없다', async () => {
      stubServer()
      timed = true
      renderApp('/calendar/week/2026-10-07', routes)
      await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })
      expect(screen.queryByRole('group', { name: /^실제/ })).not.toBeInTheDocument()
    })

    it('옵션이 꺼져 있으면 일 보기는 한 열이다', async () => {
      stubServer()
      records = [timedRecord()]
      renderApp('/calendar/day/2026-10-07', routes)
      await screen.findByRole('region', { name: '이날의 기록' })
      await screen.findByRole('button', { name: /^팀 스탠드업, 10:00–11:00/ })
      expect(screen.queryByRole('group', { name: /^실제/ })).not.toBeInTheDocument()
      expect(screen.queryByText('계획')).not.toBeInTheDocument()
    })
  })
})
