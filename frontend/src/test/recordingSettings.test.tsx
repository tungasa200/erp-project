// SCR-SET-03 설정 — 기록 옵션 (P2-05, TIME-09, PATCH /api/worklog/me/settings)
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Settings = { timeTrackingEnabled: boolean; version: number } & Record<string, unknown>
type PatchHook = (body: Record<string, unknown>) => Response | undefined

const DEFAULTS: Settings = {
  timeTrackingEnabled: false,
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  dailyCloseTime: '18:00',
  version: 0,
}

// worklog를 흉내 낸 서버: version이 맞으면 보낸 칸을 반영하고 version을 올린다
function fakeServer(options: { patch?: PatchHook; initial?: Partial<Settings> } = {}) {
  let settings: Settings = { ...DEFAULTS, ...options.initial }
  const patches: Record<string, unknown>[] = []
  stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/me': () =>
      json(200, {
        userId: ME.id,
        profile: { timezone: 'Asia/Seoul', weekStart: 'MONDAY', workDays: 31 },
        settings,
      }),
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

async function openPage() {
  renderApp('/settings/recording')
  await screen.findByRole('heading', { name: '기록 옵션' })
  return screen.findByRole('switch', { name: '시간 기록' })
}

describe('SCR-SET-03 기록 옵션', () => {
  it('기본은 꺼져 있고, 켜면 생기는 기능과 기록 보존 안내를 보여 준다', async () => {
    fakeServer()
    const toggle = await openPage()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveAccessibleDescription('업무에 쓴 시간을 재고 계획과 비교해요')
    const features = screen.getByRole('list', { name: '켜면 생기는 기능' })
    expect(
      within(features)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['타이머', '계획/실제 타임라인', '빈 시간 메우기', '소요시간 집계'])
    expect(screen.getByText(/꺼도 기존 시간 기록은 보존돼요/)).toBeInTheDocument()
  })

  it('설정 탭에 기록 옵션이 있고, 키보드로 켜면 받은 version으로 바로 저장한다', async () => {
    const { patches } = fakeServer({ initial: { version: 3 } })
    const toggle = await openPage()
    expect(
      within(screen.getByRole('navigation', { name: '설정 메뉴' })).getByRole('link', { name: /기록 옵션/ }),
    ).toHaveAttribute('href', '/settings/recording')
    toggle.focus()
    await userEvent.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(patches).toEqual([{ timeTrackingEnabled: true, version: 3 }]))
    // 다음 저장은 응답의 version으로
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(patches[1]).toEqual({ timeTrackingEnabled: false, version: 4 }))
    expect(toggle).toHaveFocus()
  })

  it('저장에 실패하면 고른 값을 두고 다시 시도를 보여 준다', async () => {
    let fail = true
    const { patches } = fakeServer({ patch: () => (fail ? problem(500, 'INTERNAL', { traceId: 't-1' }) : undefined) })
    const toggle = await openPage()
    await userEvent.click(toggle)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('저장하지 못했어요')
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fail = false
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(patches.at(-1)).toEqual({ timeTrackingEnabled: true, version: 0 })
    expect(toggle).toHaveFocus()
  })

  it('다른 곳에서 먼저 고쳤으면 충돌 띠를 띄우고, 새로 불러오면 서버 값으로 맞춘다', async () => {
    const server = fakeServer()
    const toggle = await openPage()
    server.setServer({ timeTrackingEnabled: true, version: 1 })
    await userEvent.click(toggle) // 꺼짐→켜짐을 version 0으로 보내 409
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('다른 곳에서 먼저 수정됐어요')
    server.setServer({ timeTrackingEnabled: false, version: 2 })
    await userEvent.click(within(banner).getByRole('button', { name: '새로 불러오기' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('switch', { name: '시간 기록' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('heading', { name: '기록 옵션' })).toHaveFocus()
  })

  it('불러오지 못하면 안내와 다시 시도를 보여 준다', async () => {
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/me': () => problem(500, 'INTERNAL'),
    })
    renderApp('/settings/recording')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('설정을 불러오지 못했어요')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('끊긴 동안에는 스위치를 막는다 (SCR-SYS-02 ③)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fakeServer()
    const toggle = await openPage()
    expect(toggle).toBeDisabled()
  })
})
