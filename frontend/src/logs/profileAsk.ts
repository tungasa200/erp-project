// 프로필(이름·소속·직책)에 빈 칸이 있는지. 일지 문서 위·하루 마감 완료 창의 "이름·소속을 넣으면 문서에 들어가요" 한 줄이 쓴다
// (SCR-ONB-01, 재평가 §4 #26: 저절로 뜨는 창과 미룬 횟수는 없앴다)
import type { Me } from '../api/types'

const KEYS = ['name', 'organization', 'position'] as const
export const profileIncomplete = (user: Me) => KEYS.some((k) => !user[k]?.trim())
