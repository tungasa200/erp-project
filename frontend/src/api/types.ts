// API 타입은 명세 스냅샷(contracts/generated/*.json)으로 생성한 타입을 쓴다. 다시 만들 때는 npm run gen:api.
// Problem은 아직 스냅샷에 없어 problem.ts에 손으로 둔다(common 오류 형식이 스냅샷에 들어오면 교체).
import type { components } from './generated/identity'

type IdentitySchemas = components['schemas']

export type Me = IdentitySchemas['Me']
export type SignupRequest = IdentitySchemas['SignupRequest']
export type LoginRequest = IdentitySchemas['LoginRequest']
