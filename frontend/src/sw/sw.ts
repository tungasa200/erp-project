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
