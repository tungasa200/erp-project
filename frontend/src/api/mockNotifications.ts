// 개발용 가짜 알림 API (contracts/worklog.yaml 0.6.0 /notifications·/push, P4-01). 시간대는 서울로 고정한다.
// 처음 부를 때 하루 마감(오늘, 안 읽음)·주간 제안(지난주, 안 읽음)·월간 제안(지난달, 읽음) 셋을 만들고 읽음 상태는 localStorage에 남는다.
// 푸시 구독은 저장만 한 척한다(실제 발송 없음).
import type { components } from './generated/worklog'

type Notification = components['schemas']['Notification']
type NotificationList = components['schemas']['NotificationList']

type Respond = {
  json: (status: number, body: unknown) => Response
  problem: (status: number, code: string, extra?: Record<string, unknown>) => Response
}

const STORE_KEY = 'worklog.mock.notifications'
const base = '/api/worklog/notifications'
// web-push 문서의 예시 공개키(P-256 형식). 비밀값 아님 — 구독 요청 형태만 맞춘다
const DEMO_VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'

const DAY_MS = 86_400_000
const seoulToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
/** 서울 시각 date hh:mm → ISO */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+09:00`).toISOString()

function seed(): Notification[] {
  const today = seoulToday()
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7 // 월=0
  const lastMonday = addDays(today, -weekday - 7)
  const lastMonth = `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`
  const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1)
  return [
    {
      id: '0190a000-0000-7000-8000-000000000001',
      type: 'DAILY_CLOSE',
      date: today,
      pendingCount: 2,
      logType: null,
      periodStart: null,
      createdAt: at(today, '18:00'),
      readAt: null,
    },
    {
      id: '0190a000-0000-7000-8000-000000000002',
      type: 'LOG_SUGGESTION',
      date: addDays(lastMonday, 4),
      pendingCount: null,
      logType: 'WEEKLY',
      periodStart: lastMonday,
      createdAt: at(addDays(lastMonday, 4), '18:05'),
      readAt: null,
    },
    {
      id: '0190a000-0000-7000-8000-000000000003',
      type: 'LOG_SUGGESTION',
      date: lastMonthEnd,
      pendingCount: null,
      logType: 'MONTHLY',
      periodStart: lastMonth,
      createdAt: at(lastMonthEnd, '18:05'),
      readAt: at(lastMonthEnd, '20:00'),
    },
  ]
}

function load(): Notification[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as Notification[]
  } catch {
    // 저장소를 못 쓰면 새로 만든다
  }
  return seed()
}

function save(items: Notification[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items))
  } catch {
    // 무시
  }
}

export function handleNotificationsMock(method: string, url: string, r: Respond): Response | null {
  const path = url.split('?')[0]

  if (path === '/api/worklog/push/public-key' && method === 'GET')
    return r.json(200, { publicKey: DEMO_VAPID_PUBLIC_KEY })
  if (path === '/api/worklog/push/subscriptions' && (method === 'PUT' || method === 'DELETE'))
    return new Response(null, { status: 204 })

  if (path !== base && !path.startsWith(`${base}/`)) return null
  const items = load()

  if (method === 'GET' && path === base) {
    const q = new URLSearchParams(url.split('?')[1] ?? '')
    const limit = Math.min(Math.max(Number(q.get('limit')) || 30, 1), 100)
    const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    // 커서는 마지막으로 준 항목의 순번(개발용)
    const start = Number(q.get('cursor') ?? 0) || 0
    const page = sorted.slice(start, start + limit)
    const body: NotificationList = {
      items: page,
      unreadCount: items.filter((n) => !n.readAt).length,
      nextCursor: start + limit < sorted.length ? String(start + limit) : null,
    }
    return r.json(200, body)
  }

  if (method === 'POST' && path === `${base}/read-all`) {
    const now = new Date().toISOString()
    save(items.map((n) => ({ ...n, readAt: n.readAt ?? now })))
    return new Response(null, { status: 204 })
  }

  const read = /^\/api\/worklog\/notifications\/([^/]+)\/read$/.exec(path)
  if (method === 'POST' && read) {
    const target = items.find((n) => n.id === read[1])
    if (!target) return r.problem(404, 'NOT_FOUND')
    target.readAt ??= new Date().toISOString()
    save(items)
    return new Response(null, { status: 204 })
  }

  return r.problem(404, 'NOT_FOUND')
}
