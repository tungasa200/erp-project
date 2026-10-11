// 웹 푸시 구독(P4-01, SCR-SET-05 ③, D-174 ②·D-177 ③). contracts/worklog.yaml 0.6.0의 /push/public-key·/push/subscriptions.
// 서비스 워커 등록·푸시 수신·알림 클릭 처리는 공용(WY-frontend PWA). 여기는 권한·구독만 다룬다.
// 등록된 서비스 워커가 없으면(dev·테스트) '지원 안 함'으로 본다.
import { api } from '../api'

export type PushState =
  /** Notification·PushManager·서비스 워커 중 하나라도 없음(시크릿 창, iOS 16.4 미만 등) */
  | 'unsupported'
  /** iPhone·iPad Safari에서 홈 화면 앱으로 열지 않음(iOS는 홈 화면 앱에서만 웹 푸시) */
  | 'ios-browser'
  /** 권한을 아직 묻지 않음 */
  | 'default'
  | 'denied'
  /** 권한은 있지만 이 기기 구독이 없음(끄기를 눌렀거나 구독이 사라짐) */
  | 'granted-off'
  | 'on'

const base = '/api/worklog/push'

export const pushApi = {
  publicKey: () => api.request<{ publicKey: string }>(`${base}/public-key`),
  save: (body: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    api.request<void>(`${base}/subscriptions`, { method: 'PUT', body }),
  remove: (endpoint: string) =>
    api.request<void>(`${base}/subscriptions?endpoint=${encodeURIComponent(endpoint)}`, { method: 'DELETE' }),
}

function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+는 Mac처럼 보이지만 터치가 있다
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** 등록된 서비스 워커. 없으면 null(ready를 기다리면 영원히 안 끝난다) */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

/** 화면을 열 때마다 다시 읽는다(브라우저 설정에서 바꿀 수 있어서) */
export async function readPushState(): Promise<PushState> {
  const supported = typeof Notification !== 'undefined' && 'PushManager' in window
  if (!supported) return isIos() && !isStandalone() ? 'ios-browser' : 'unsupported'
  const reg = await registration()
  if (!reg) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'default') return 'default'
  return (await reg.pushManager.getSubscription()) ? 'on' : 'granted-off'
}

function toServerBody(sub: PushSubscription) {
  const json = sub.toJSON()
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export type EnableResult = 'on' | 'denied' | 'dismissed' | 'failed'

/**
 * [허용하기]: 권한을 묻고(사용자 동작 안에서만 불러야 창이 뜬다) 구독해 서버에 저장한다.
 * dismissed = 창을 그냥 닫음(다시 물을 수 있음), failed = 권한은 받았지만 구독·저장 실패(다시 시도)
 */
export async function enablePush(): Promise<EnableResult> {
  const permission = await Notification.requestPermission()
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'dismissed'
  try {
    const reg = await registration()
    if (!reg) return 'failed'
    const existing = await reg.pushManager.getSubscription()
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes((await pushApi.publicKey()).publicKey),
      }))
    await pushApi.save(toServerBody(sub))
    return 'on'
  } catch {
    return 'failed'
  }
}

/** 이 기기에서 끄기: 이 기기 구독만 지운다(권한은 브라우저에 남음). 로그아웃 때도 부른다 */
export async function disablePush(): Promise<void> {
  const sub = await (await registration())?.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await pushApi.remove(endpoint)
}

/** 앱을 열 때·로그인 직후: 이 기기 구독이 있으면 서버에 다시 보낸다(계정을 바꿨거나 서버가 지운 경우). 실패는 조용히 넘긴다 */
export async function resyncPushSubscription(): Promise<void> {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const sub = await (await registration())?.pushManager.getSubscription()
    if (sub) await pushApi.save(toServerBody(sub))
  } catch {
    // 다음에 앱을 열 때 다시 보낸다
  }
}
