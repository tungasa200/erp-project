import { beforeEach, describe, expect, it } from 'vitest'
import { handleNotificationsMock } from './mockNotifications'

const r = {
  json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status }),
  problem: (status: number, code: string) => new Response(JSON.stringify({ code }), { status }),
}

const list = async (query = '') =>
  (await handleNotificationsMock('GET', `/api/worklog/notifications${query}`, r))!.json()

describe('dev:mock 알림 API', () => {
  beforeEach(() => localStorage.clear())

  it('처음엔 안 읽은 2개를 포함한 3개를 최신순으로, limit·cursor로 나눈다', async () => {
    const all = await list('?limit=30')
    expect(all.items).toHaveLength(3)
    expect(all.unreadCount).toBe(2)
    expect(all.items[0].type).toBe('DAILY_CLOSE')
    const first = await list('?limit=1')
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toBe('1')
    expect((await list('?limit=30&cursor=1')).items).toHaveLength(2)
  })

  it('하나 읽음·모두 읽음이 남는다', async () => {
    const { items } = await list()
    expect((await handleNotificationsMock('POST', `/api/worklog/notifications/${items[0].id}/read`, r))!.status).toBe(
      204,
    )
    expect((await list()).unreadCount).toBe(1)
    await handleNotificationsMock('POST', '/api/worklog/notifications/read-all', r)
    expect((await list()).unreadCount).toBe(0)
    expect((await handleNotificationsMock('POST', '/api/worklog/notifications/none/read', r))!.status).toBe(404)
  })

  it('푸시 공개키·구독, 알림 밖 경로는 넘긴다', async () => {
    expect((await handleNotificationsMock('GET', '/api/worklog/push/public-key', r))!.status).toBe(200)
    expect(handleNotificationsMock('PUT', '/api/worklog/push/subscriptions', r)!.status).toBe(204)
    expect(handleNotificationsMock('GET', '/api/worklog/tasks', r)).toBeNull()
  })
})
