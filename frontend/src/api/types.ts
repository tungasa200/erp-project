// API 타입은 명세 스냅샷(contracts/generated/*.json)으로 생성한 타입을 쓴다. 다시 만들 때는 npm run gen:api.
// Problem은 problem.ts에 있다(ApiError와 함께 쓰므로).
import type { components } from './generated/identity'
import type { components as WorklogComponents } from './generated/worklog'

type IdentitySchemas = components['schemas']

export type Me = IdentitySchemas['Me']
export type ProfileUpdateRequest = IdentitySchemas['ProfileUpdateRequest']
export type SignupRequest = IdentitySchemas['SignupRequest']
export type LoginRequest = IdentitySchemas['LoginRequest']

export type PasswordChangeRequest = IdentitySchemas['PasswordChangeRequest']
export type PasswordChanged = IdentitySchemas['PasswordChanged']
export type AccountDeletionRequest = IdentitySchemas['AccountDeletionRequest']

type WorklogSchemas = WorklogComponents['schemas']

export type WorklogMe = WorklogSchemas['WorklogMe']
export type WorklogSettings = WorklogSchemas['WorklogSettings']
export type WorklogSettingsPatch = WorklogSchemas['WorklogSettingsPatch']
