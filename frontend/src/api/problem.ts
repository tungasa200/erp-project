import type { components } from './generated/identity'

export type RateLimitedProblem = components['schemas']['RateLimitedProblem']

// RFC 9457 Problem Details + 확장 필드. 모든 서비스가 같은 Problem을 쓴다(명세 스냅샷 생성 타입).
// 확장 필드는 응답마다 달라서(429의 retryAfterSeconds) 선택 필드로 합친다.
export type Problem = components['schemas']['Problem'] & Partial<Pick<RateLimitedProblem, 'retryAfterSeconds'>>

export type FieldError = NonNullable<Problem['errors']>[number]

export class ApiError extends Error {
  readonly status: number
  readonly problem: Problem | null

  constructor(status: number, problem: Problem | null) {
    super(problem?.code ?? `HTTP_${status}`)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
  }

  get code(): string | undefined {
    return this.problem?.code
  }

  get traceId(): string | undefined {
    return this.problem?.traceId
  }
}

// fetch 자체가 실패한 경우(오프라인, DNS 오류 등)
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('NETWORK_ERROR', { cause })
    this.name = 'NetworkError'
  }
}

export async function toApiError(res: Response): Promise<ApiError> {
  let problem: Problem | null = null
  const type = res.headers.get('Content-Type') ?? ''
  if (type.includes('json')) {
    try {
      problem = (await res.json()) as Problem
    } catch {
      problem = null
    }
  }
  return new ApiError(res.status, problem)
}
