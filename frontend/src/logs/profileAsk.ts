// SCR-ONB-01 프로필 입력 요청을 띄울지 정한다. 몇 번 미뤘는지는 이 브라우저에 사용자별로 둔다
// (구현 가정: 서버 칸 없음, 기기마다 최대 두 번 묻는다).
import type { Me } from '../api/types'

const MAX_ASKS = 2

interface Postponed {
  count: number
  /** 마지막으로 미룬 일지(같은 일지에서는 다시 묻지 않는다) */
  last: string | null
}

const storageKey = (userId: string) => `wy.profilePrompt.${userId}`

export function readPostponed(userId: string): Postponed {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    const v = raw ? (JSON.parse(raw) as Partial<Postponed>) : null
    return { count: Number(v?.count) || 0, last: typeof v?.last === 'string' ? v.last : null }
  } catch {
    return { count: 0, last: null }
  }
}

export function writePostponed(userId: string, value: Postponed) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(value))
  } catch {
    // 저장소를 못 쓰면 이번 화면에서만 닫힌다
  }
}

const KEYS = ['name', 'organization', 'position'] as const
export const profileIncomplete = (user: Me) => KEYS.some((k) => !user[k]?.trim())

/** 이 일지(logKey)에서 프로필을 물어야 하는지. 빈 칸이 있고, 두 번 미루지 않았고, 이 일지에서 미룬 적이 없을 때 */
export function shouldAskProfile(user: Me | null | undefined, logKey: string): boolean {
  if (!user || !profileIncomplete(user)) return false
  const p = readPostponed(user.id)
  return p.count < MAX_ASKS && p.last !== logKey
}
