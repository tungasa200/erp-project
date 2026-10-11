// 알림 센터 API (P4-01, NOTI-01·LOG-16, SCR-COM-05). contracts/worklog.yaml 0.6.0의 /notifications.
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useCallback } from 'react'
import { api } from '../api'
import type { components } from '../api/generated/worklog'

type Schemas = components['schemas']

/** date는 하루 마감 대상일·제안을 만든 날, pendingCount는 DAILY_CLOSE일 때 보낼 때의 확인 대기 수(스냅샷) */
export type AppNotification = Schemas['Notification']
/** unreadCount는 페이지와 무관한 전체 안 읽은 수 */
export type NotificationPage = Schemas['NotificationList']

export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const
const LIST_KEY = [...NOTIFICATIONS_QUERY_KEY, 'list'] as const
const UNREAD_KEY = [...NOTIFICATIONS_QUERY_KEY, 'unread'] as const

const base = '/api/worklog/notifications'

export const notificationApi = {
  list: (cursor?: string | null, limit = 30) =>
    api.request<NotificationPage>(`${base}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  read: (id: string) => api.request<void>(`${base}/${id}/read`, { method: 'POST' }),
  readAll: () => api.request<void>(`${base}/read-all`, { method: 'POST' }),
}

// 하루 마감 알림은 정해진 시각에 한 번 생기므로 자주 묻지 않는다. 창으로 돌아오면 react-query가 다시 받는다
const POLL_MS = 5 * 60_000

/** 종 배지용 안 읽은 수(limit=1) */
export function useUnreadCount() {
  return useQuery({
    queryKey: UNREAD_KEY,
    queryFn: async () => (await notificationApi.list(null, 1)).unreadCount,
    refetchInterval: POLL_MS,
  })
}

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: LIST_KEY,
    queryFn: ({ pageParam }) => notificationApi.list(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? null,
  })
}

type ListData = InfiniteData<NotificationPage, string | null>

/**
 * 읽음 처리. 화면을 먼저 바꾸고(배지·점) 요청한다. 실패하면 서버 값으로 다시 받는다 —
 * 읽음은 이동을 막을 만큼 중요하지 않아 오류를 띄우지 않는다.
 */
export function useMarkRead() {
  const queryClient = useQueryClient()

  const patch = useCallback(
    (match: (n: AppNotification) => boolean) => {
      const now = new Date().toISOString()
      queryClient.setQueryData<ListData>(LIST_KEY, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.map((n) => {
                  if (n.readAt || !match(n)) return n
                  return { ...n, readAt: now }
                }),
              })),
            }
          : old,
      )
    },
    [queryClient],
  )

  /** 안 읽은 수(배지·목록 첫 페이지)를 함께 고친다 */
  const setUnread = useCallback(
    (next: (count: number) => number) => {
      queryClient.setQueryData<number>(UNREAD_KEY, (c) => (c === undefined ? c : next(c)))
      queryClient.setQueryData<ListData>(LIST_KEY, (old) =>
        old ? { ...old, pages: old.pages.map((p) => ({ ...p, unreadCount: next(p.unreadCount) })) } : old,
      )
    },
    [queryClient],
  )

  const settle = useCallback(
    (request: Promise<void>) =>
      request.catch(() => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY })),
    [queryClient],
  )

  const markRead = useCallback(
    (n: AppNotification) => {
      if (n.readAt) return
      // 목록에 없는 항목(웹 푸시로 연 경우)도 배지는 하나 줄인다
      patch((x) => x.id === n.id)
      setUnread((c) => Math.max(0, c - 1))
      void settle(notificationApi.read(n.id))
    },
    [patch, setUnread, settle],
  )

  const markAllRead = useCallback(() => {
    patch(() => true)
    setUnread(() => 0)
    return settle(notificationApi.readAll())
  }, [patch, setUnread, settle])

  return { markRead, markAllRead }
}
