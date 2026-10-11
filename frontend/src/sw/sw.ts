/// <reference lib="webworker" />
// 서비스 워커 (P4-03, NFR-06). vite-plugin-pwa injectManifest로 빌드한다(개발 서버에서는 등록하지 않음).
// 빌드한 앱 파일을 미리 받아 두어 연결이 끊겨도 앱이 열리고(SCR-MOB-01 ④ 오프라인 상태), 화면 이동은 네트워크를 먼저 쓴다.
// 웹 푸시(P4-01, SCR-COM-05)도 이 워커에 붙인다.
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// 새 배포는 기다리지 않고 바로 쓴다(새로 고치면 새 화면)
self.addEventListener('install', () => void self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const FONT_CACHE = 'fonts-v1'

// 화면 이동(/calendar 등)은 네트워크 먼저, 끊겼으면 미리 받아 둔 index.html로 연다. /api는 건드리지 않는다.
// 글꼴 조각은 이름에 해시가 있어 한 번 받으면 바뀌지 않으므로 담아 둔 것을 먼저 쓴다
self.addEventListener('fetch', (event) => {
  const { request } = event
  const { pathname } = new URL(request.url)
  if (pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await matchPrecache('/index.html')) ?? Response.error()))
  } else if (pathname.startsWith('/assets/') && pathname.endsWith('.woff2')) {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const response = await fetch(request)
        if (response.ok) void cache.put(request, response.clone())
        return response
      }),
    )
  }
})

// 웹 푸시 (P4-01, SCR-COM-05 ④·⑤). 본문은 contracts/worklog.yaml /push/subscriptions 설명의
// {type, notificationId, title, body, url}. 같은 종류(tag=type)는 최신 하나만 남긴다.
interface PushPayload {
  type: string
  notificationId: string
  title: string
  body: string | null
  url: string
}

/** 이 앱 안의 경로만 연다(다른 사이트로 보내는 알림을 막는다). 아니면 홈 */
function safeAppPath(url: unknown): string {
  if (typeof url !== 'string' || !url.startsWith('/')) return '/'
  // '//evil.com'·'/\evil.com'처럼 다른 사이트로 풀리는 주소를 걸러 낸다
  const resolved = new URL(url, self.location.origin)
  return resolved.origin === self.location.origin ? resolved.pathname + resolved.search + resolved.hash : '/'
}

self.addEventListener('push', (event) => {
  let data: PushPayload
  try {
    data = event.data?.json() as PushPayload
  } catch {
    return
  }
  if (!data?.title) return
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body ?? undefined,
      tag: data.type,
      icon: '/icons/notification-icon-192.png',
      badge: '/icons/badge-72.png',
      lang: 'ko',
      data: { notificationId: data.notificationId, url: safeAppPath(data.url) },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { notificationId, url } = (event.notification.data ?? {}) as { notificationId?: string; url?: string }
  const target = new URL(safeAppPath(url), self.location.origin).href
  event.waitUntil(
    (async () => {
      // 읽음 처리는 실패해도 화면은 연다(로그인이 끝났으면 401, 알림 센터에서 다시 읽음이 된다)
      if (notificationId)
        await fetch(`/api/worklog/notifications/${encodeURIComponent(notificationId)}/read`, {
          method: 'POST',
          credentials: 'same-origin',
        }).catch(() => undefined)
      // 열린 앱 창이 있으면 그 창을 그 화면으로 옮기고 앞으로 가져온다
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin)
      if (open) {
        const moved = await open.navigate(target).catch(() => null)
        await (moved ?? open).focus()
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})
