import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { json, ME, problem, renderApp, stubFetch } from '../test/renderApp'
import type { AppNotification } from './api'
import { notificationHref, notificationText, notificationTime } from './format'
import { NotificationBell } from './NotificationBell'
import { NotificationSettings } from './NotificationSettings'
import { NotificationsPage } from './NotificationsPage'

const n = (id: string, extra: Partial<AppNotification> = {}): AppNotification => ({
  id,
  type: 'DAILY_CLOSE',
  date: '2026-10-09',
  pendingCount: 3,
  logType: null,
  periodStart: null,
  createdAt: '2026-10-09T09:00:00Z',
  readAt: null,
  ...extra,
})

const ITEMS = [
  n('n-close'),
  n('n-week', {
    type: 'LOG_SUGGESTION',
    logType: 'WEEKLY',
    periodStart: '2026-10-05',
    pendingCount: null,
    createdAt: '2026-10-09T09:05:00Z',
  }),
  n('n-month', {
    type: 'LOG_SUGGESTION',
    logType: 'MONTHLY',
    periodStart: '2026-09-01',
    pendingCount: null,
    createdAt: '2026-09-30T09:05:00Z',
    readAt: '2026-10-01T00:00:00Z',
  }),
]

const SETTINGS = {
  timeTrackingEnabled: false,
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  dailyCloseTime: '18:30',
  dailyCloseNotifyEnabled: true,
  version: 4,
}

function setup(
  options: {
    items?: AppNotification[]
    unreadCount?: number
    listError?: boolean
    notifyEnabled?: boolean
    path?: string
  } = {},
) {
  let items = options.items ?? ITEMS
  let failList = options.listError ?? false
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/me': () =>
      json(200, { userId: 'u-1', settings: { ...SETTINGS, dailyCloseNotifyEnabled: options.notifyEnabled ?? true } }),
    'GET /api/worklog/notifications': () => {
      if (failList) {
        failList = false
        return problem(500, 'INTERNAL')
      }
      const unreadCount = options.unreadCount ?? items.filter((x) => !x.readAt).length
      return json(200, { items, unreadCount, nextCursor: null })
    },
    'POST /api/worklog/notifications/n-close/read': () => new Response(null, { status: 204 }),
    'POST /api/worklog/notifications/read-all': () => {
      items = items.map((x) => ({ ...x, readAt: x.readAt ?? '2026-10-10T00:00:00Z' }))
      return new Response(null, { status: 204 })
    },
    'PATCH /api/worklog/me/settings': () => json(200, { ...SETTINGS, dailyCloseNotifyEnabled: true, version: 5 }),
  })
  const result = renderApp(options.path ?? '/notifications', [
    { path: '/notifications', element: <NotificationsPage /> },
    { path: '/bell', element: <NotificationBell /> },
    { path: '/settings/notifications', element: <NotificationSettings /> },
    { path: '/logs/:type/:date', element: <h1>일지 화면</h1> },
    { path: '/', element: <h1>홈</h1> },
  ])
  return { fetchMock, ...result }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SCR-COM-05 알림 글자·경로', () => {
  it('하루 마감은 확인 대기 수를, 지난 날이면 날짜를 붙인다', () => {
    expect(notificationText(n('a'), '2026-10-09')).toEqual({
      title: '하루 마감 시간이에요',
      sub: '확인 대기 3건이 있어요. 1분이면 끝나요',
    })
    expect(notificationText(n('a', { pendingCount: 0 }), '2026-10-10').sub).toBe(
      '10/9(금) · 오늘 남긴 기록을 확정해 하루를 마감해요',
    )
  })

  it('하루 마감은 그날 일지에서 마감 창을, 제안은 그 일지로', () => {
    expect(notificationHref(ITEMS[0])).toBe('/logs/daily/2026-10-09?close=1')
    expect(notificationHref(ITEMS[1])).toBe('/logs/weekly/2026-10-05')
    expect(notificationHref(ITEMS[2])).toBe('/logs/monthly/2026-09')
  })

  it('시각은 사용자 시간대 기준 오늘·어제·날짜', () => {
    // 2026-10-09T15:30Z = 서울 10/10 00:30
    expect(notificationTime('2026-10-09T15:30:00Z', 'Asia/Seoul', '2026-10-10')).toBe('오늘 00:30')
    expect(notificationTime('2026-10-09T15:30:00Z', 'UTC', '2026-10-10')).toBe('어제 15:30')
    expect(notificationTime('2026-10-01T00:00:00Z', 'Asia/Seoul', '2026-10-10')).toBe('10월 1일')
    expect(notificationTime('2025-12-31T00:00:00Z', 'Asia/Seoul', '2026-10-10')).toBe('2025년 12월 31일')
  })
})

describe('SCR-COM-05 알림 센터', () => {
  it('최신순 목록, 안 읽은 항목은 읽지 않음으로 읽힌다', async () => {
    setup()
    const list = await screen.findByRole('list', { name: '알림 목록' })
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(links[0]).toHaveAccessibleName(/^읽지 않음,\s*하루 마감 시간이에요 .*확인 대기 3건/)
    expect(links[1]).toHaveTextContent('주간 일지를 만들 차례예요')
    expect(links[2]).toHaveTextContent('9월 월간 일지를 만들 수 있어요')
    expect(links[2]).not.toHaveAccessibleName(/읽지 않음/)
  })

  it('항목을 누르면 읽음 처리하고 그 화면으로 간다', async () => {
    const { fetchMock, router } = setup()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: /하루 마감 시간이에요/ }))
    expect(await screen.findByRole('heading', { name: '일지 화면' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/logs/daily/2026-10-09')
    expect(router.state.location.search).toBe('?close=1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worklog/notifications/n-close/read',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('모두 읽음: 요청하고 버튼이 사라지며 포커스는 첫 항목으로', async () => {
    const { fetchMock } = setup()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '모두 읽음' }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worklog/notifications/read-all',
      expect.objectContaining({ method: 'POST' }),
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: '모두 읽음' })).not.toBeInTheDocument())
    expect(screen.getAllByRole('link')[0]).toHaveFocus()
    expect(screen.queryByText(/^읽지 않음/)).not.toBeInTheDocument()
  })

  it('비었고 하루 마감 알림이 꺼져 있으면 설정 › 알림으로 보낸다', async () => {
    setup({ items: [], notifyEnabled: false })
    expect(await screen.findByText('하루 마감 알림이 꺼져 있어요')).toBeInTheDocument()
    expect(screen.queryByText('새 알림이 없어요')).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: '하루 마감 알림 켜기' })).toHaveAttribute(
      'href',
      '/settings/notifications',
    )
    expect(screen.queryByRole('button', { name: '모두 읽음' })).not.toBeInTheDocument()
  })

  it('비었고 알림이 켜져 있으면 안내만', async () => {
    setup({ items: [] })
    expect(await screen.findByText('하루 마감과 일지 알림이 여기에 모여요')).toBeInTheDocument()
    expect(screen.getByText('새 알림이 없어요')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '하루 마감 알림 켜기' })).not.toBeInTheDocument()
  })

  it('불러오기 실패 → 다시 시도', async () => {
    setup({ listError: true })
    const user = userEvent.setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('알림을 불러오지 못했어요')
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('list', { name: '알림 목록' })).toBeInTheDocument()
  })
})

describe('SCR-COM-05 ② 종 버튼', () => {
  it('안 읽은 수를 읽어 주고 9가 넘으면 9+', async () => {
    setup({ path: '/bell', unreadCount: 12 })
    const bell = await screen.findByRole('button', { name: '알림, 안 읽음 12개' })
    expect(bell).toHaveTextContent('9+')
  })

  it('데스크톱 팝오버: 열면 대화상자로 포커스, Esc로 닫고 종으로 돌아온다', async () => {
    setup({ path: '/bell' })
    const user = userEvent.setup()
    const bell = await screen.findByRole('button', { name: '알림, 안 읽음 2개' })
    await user.click(bell)
    const dialog = screen.getByRole('dialog', { name: '알림' })
    expect(bell).toHaveAttribute('aria-expanded', 'true')
    expect(dialog).toHaveFocus()
    expect(await within(dialog).findAllByRole('link', { name: /일지|마감/ })).toHaveLength(3)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(bell).toHaveFocus()
  })

  it('항목으로 이동하면 팝오버가 닫힌다', async () => {
    setup({ path: '/bell' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^알림/ }))
    await user.click(await screen.findByRole('link', { name: /하루 마감 시간이에요/ }))
    expect(await screen.findByRole('heading', { name: '일지 화면' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('SCR-SET-05 설정 — 알림', () => {
  it('꺼져 있으면 푸시 칸은 막혀 있고, 켜면 즉시 저장한다', async () => {
    const { fetchMock } = setup({ path: '/settings/notifications', notifyEnabled: false })
    const user = userEvent.setup()
    const toggle = await screen.findByRole('switch', { name: '하루 마감 알림' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(await screen.findByText('하루 마감 알림을 켜면 고를 수 있어요')).toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/worklog/me/settings',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ dailyCloseNotifyEnabled: true, version: 4 }),
        }),
      ),
    )
  })

  it('알림 시각은 일반 탭의 하루 마감 시각으로 보낸다', async () => {
    setup({ path: '/settings/notifications' })
    expect(await screen.findByRole('link', { name: /알림 시각 18:30/ })).toHaveAttribute('href', '/settings/general')
  })

  it('켜면 푸시 안내 문구가 같은 aria-live 칸에서 바뀐다', async () => {
    setup({ path: '/settings/notifications', notifyEnabled: false })
    const user = userEvent.setup()
    const live = await screen.findByText('하루 마감 알림을 켜면 고를 수 있어요')
    expect(live).toHaveAttribute('aria-live', 'polite')
    await user.click(screen.getByRole('switch', { name: '하루 마감 알림' }))
    await waitFor(() => expect(live).toHaveTextContent(/이 브라우저는 푸시 알림을 받을 수 없어요/))
    expect(live).toBeInTheDocument()
  })

  it('권한을 아직 묻지 않았으면 "아직 묻지 않음"과 허용하기', async () => {
    vi.stubGlobal('Notification', { permission: 'default' })
    vi.stubGlobal('PushManager', function PushManager() {})
    // jsdom에는 서비스 워커가 없다. 이 테스트에서만 붙이고 끝나면 뗀다
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: () => Promise.resolve({ pushManager: {} }) },
    })
    onTestFinished(() => {
      delete (navigator as { serviceWorker?: unknown }).serviceWorker
    })
    setup({ path: '/settings/notifications' })
    expect(await screen.findByText('아직 묻지 않음')).toBeInTheDocument()
    expect(screen.queryByText('이 기기 꺼짐')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '허용하기' })).toBeEnabled()
  })

  it('푸시를 받을 수 없는 브라우저(서비스 워커 없음)면 지원 안 함', async () => {
    setup({ path: '/settings/notifications' })
    expect(await screen.findByText(/이 브라우저는 푸시 알림을 받을 수 없어요/)).toBeInTheDocument()
    expect(screen.getByText('지원 안 함')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '허용하기' })).not.toBeInTheDocument()
  })
})
