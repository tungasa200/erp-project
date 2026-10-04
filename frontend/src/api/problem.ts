// RFC 9457 Problem Details + 확장 필드 (contracts/identity.yaml Problem)
export interface FieldError {
  field: string
  code: string
  message?: string
}

export interface Problem {
  type: string
  title: string
  status: number
  detail?: string
  code: string
  errors?: FieldError[]
  traceId: string
  retryAfterSeconds?: number
}

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
