// 임시 타입: P0-10에서 springdoc 출력으로 생성한 타입으로 교체한다. (contracts/identity.yaml 기준)
export type WeekStart = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

export interface Me {
  id: string
  email: string
  emailVerified: boolean
  name?: string | null
  organization?: string | null
  position?: string | null
  timezone: string
  weekStart: WeekStart
  workDays: number
  themeAccent: string
  themeGround: string
  version: number
}

export interface SignupRequest {
  email: string
  password: string
  agreeTerms: boolean
  agreePrivacy: boolean
}

export interface LoginRequest {
  email: string
  password: string
}
