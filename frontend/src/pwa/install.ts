// SCR-MOB-02 PWA 설치 안내(P4-03, 보드 MOB-02·MOB-02a). 브라우저 설치 창(beforeinstallprompt)과 안내를 띄울지 정한다.
// 띄우는 조건(WY-design 2026-10-11): 로그인 뒤 두 번째 방문부터, 홈 화면에서만, 홈 화면 앱으로 열었으면 안 띄움.
// ×와 브라우저 창의 취소는 30일 숨김, 설치하면 다시 띄우지 않는다.
import { useSyncExternalStore } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const HIDDEN_UNTIL_KEY = 'wy.install.hiddenUntil'
const INSTALLED_KEY = 'wy.install.done'
const VISITS_KEY = 'wy.install.visits'
const COUNTED_KEY = 'wy.install.counted'
const HIDE_MS = 30 * 24 * 60 * 60 * 1000

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function write(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value)
  } catch {
    // 시크릿 창 등 저장소를 못 쓰면 이번 방문만 기억한다
  }
}

/** 앱 시작 때 한 번. 창이 화면을 그리기 전에 올 수 있어 일찍 듣는다 */
export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // 브라우저 기본 미니 안내 대신 우리 카드·설정 버튼으로 띄운다
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    write(localStorage, INSTALLED_KEY, '1')
    emit()
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 브라우저가 설치 창을 띄울 수 있는지(Android·데스크톱 Chrome·Edge·삼성 인터넷) */
export function useCanInstall(): boolean {
  return useSyncExternalStore(subscribe, () => deferred !== null)
}

/** 설치 창을 띄운다. 사용자 동작 안에서만 불러야 한다. 이벤트는 한 번만 쓸 수 있다 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  deferred = null
  emit()
  let outcome: 'accepted' | 'dismissed'
  try {
    await event.prompt()
    outcome = (await event.userChoice).outcome
  } catch {
    // 이미 쓴 이벤트이거나 브라우저가 창을 거절함. 다음 beforeinstallprompt를 기다린다
    return 'unavailable'
  }
  if (outcome === 'accepted') write(localStorage, INSTALLED_KEY, '1')
  return outcome
}

export function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+는 Mac처럼 보이지만 터치가 있다
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** 홈 화면을 연 방문을 센다(탭 세션마다 한 번). 지금까지 센 방문 수를 돌려준다 */
export function countVisit(): number {
  const visits = Number(read(localStorage, VISITS_KEY)) || 0
  if (read(sessionStorage, COUNTED_KEY)) return visits
  write(sessionStorage, COUNTED_KEY, '1')
  write(localStorage, VISITS_KEY, String(visits + 1))
  return visits + 1
}

export function hideFor30Days(now = Date.now()) {
  write(localStorage, HIDDEN_UNTIL_KEY, String(now + HIDE_MS))
}

/** 숨김 기간이 지났고 아직 설치하지 않았으면 true */
export function mayShowInstallGuide(now = Date.now()): boolean {
  if (read(localStorage, INSTALLED_KEY)) return false
  return now >= (Number(read(localStorage, HIDDEN_UNTIL_KEY)) || 0)
}
