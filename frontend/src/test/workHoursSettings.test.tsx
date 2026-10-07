// SCR-SET-02 ④ 업무 시간대 (P2, TIME-11, PATCH /api/worklog/me/settings)
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Settings = { version: number } & Record<string, unknown>

function fakeServer(options: { patch?: (body: Record<string, unknown>) => Response | undefined } = {}) {
  let settings: Settings = {
    timeTrackingEnabled: false,
    workHoursStart: '09:00',
    workHoursEnd: '18:00',
    dailyCloseTime: '18:00',
    version: 0,
  }
  const patches: Record<string, unknown>[] = []
  stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/me': () => json(200, { userId: ME.id, settings }),
    'PATCH /api/worklog/me/settings': (init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      patches.push(body)
      const custom = options.patch?.(body)
      if (custom) return custom
      if (body.version !== settings.version) return problem(409, 'VERSION_CONFLICT')
      const { version: _, ...fields } = body
      settings = { ...settings, ...fields, version: settings.version + 1 }
      return json(200, settings)
    },
  })
  return { patches, setServer: (next: Partial<Settings>) => (settings = { ...settings, ...next }) }
}

async function openRow() {
  renderApp('/settings/general')
  const group = await screen.findByRole('group', { name: '업무 시간대' })
  return {
    start: within(group).getByLabelText('업무 시작 시각'),
    end: within(group).getByLabelText('업무 종료 시각'),
  }
}

describe('SCR-SET-02 ④ 업무 시간대', () => {
  it('기본 09:00~18:00, 칸을 떠날 때 두 시각을 함께 저장하고 그대로면 다시 보내지 않는다', async () => {
    const server = fakeServer()
    const { start, end } = await openRow()
    expect(start).toHaveValue('09:00')
    expect(end).toHaveValue('18:00')

    start.focus()
    fireEvent.change(start, { target: { value: '08:30' } })
    await userEvent.tab()
    expect(end).toHaveFocus()
    await waitFor(() =>
      expect(server.patches).toEqual([{ workHoursStart: '08:30', workHoursEnd: '18:00', version: 0 }]),
    )
    await userEvent.tab()
    expect(server.patches).toHaveLength(1)
  })

  it('종료가 시작보다 이르면 저장하지 않고 그 항목에 오류, 고치면 저장한다', async () => {
    const server = fakeServer()
    const { start, end } = await openRow()
    end.focus()
    fireEvent.change(end, { target: { value: '08:00' } })
    await userEvent.tab()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('종료 시각은 시작 시각보다 늦어야 해요')
    expect(start).toHaveAttribute('aria-invalid', 'true')
    expect(end).toHaveAccessibleDescription('종료 시각은 시작 시각보다 늦어야 해요')
    expect(server.patches).toEqual([])

    end.focus()
    fireEvent.change(end, { target: { value: '17:00' } })
    await userEvent.tab()
    await waitFor(() =>
      expect(server.patches).toEqual([{ workHoursStart: '09:00', workHoursEnd: '17:00', version: 0 }]),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(end).toHaveAttribute('aria-invalid', 'false')
  })

  it('서버가 순서 오류(INVALID_ORDER)로 거절해도 같은 문구를 그 항목에 보인다', async () => {
    fakeServer({
      patch: () =>
        problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'workHoursEnd', code: 'INVALID_ORDER', message: '' }] }),
    })
    const { start } = await openRow()
    start.focus()
    fireEvent.change(start, { target: { value: '10:00' } })
    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent('종료 시각은 시작 시각보다 늦어야 해요')
  })

  it('다른 곳에서 먼저 고쳤으면(409) 충돌 띠, 새로 불러오면 서버 값으로 채운다', async () => {
    const server = fakeServer()
    server.setServer({ version: 3 })
    const { start } = await openRow()
    server.setServer({ workHoursStart: '07:00', version: 4 })
    start.focus()
    fireEvent.change(start, { target: { value: '10:00' } })
    await userEvent.tab()
    expect(await screen.findByText('다른 곳에서 먼저 수정됐어요. 이 변경은 저장되지 않았어요')).toBeInTheDocument()
    expect(start).toHaveValue('09:00')

    await userEvent.click(screen.getByRole('button', { name: '새로 불러오기' }))
    await waitFor(() => expect(screen.getByLabelText('업무 시작 시각')).toHaveValue('07:00'))
    expect(screen.getByRole('heading', { name: '일반' })).toHaveFocus()
  })
})
