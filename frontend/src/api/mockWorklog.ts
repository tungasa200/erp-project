// 개발용 가짜 worklog 서버 (contracts/worklog.yaml의 프로젝트·태그·업무). mockServer가 로그인 확인 뒤 여기로 넘긴다.
// 목업 SET-08·TASK-01과 같은 예시 데이터로 시작하고, 고친 내용은 localStorage에 남는다.
// 예전 저장본에 tasks가 없으면 예시 업무를 채워 넣는다.
import type { Occurrence } from '../calendar/api'
import { handleScheduleMock, scheduledTaskIds } from '../calendar/mockSchedules'
import type { Project, Tag } from '../projects/api'
import type { WorkRecord } from '../records/api'
import type { PendingRecord } from '../records/pending'
import type { Task } from '../tasks/api'

const STORE_KEY = 'worklog.mock.worklog'

/** mockServer가 넘기는 내 설정. 업무 시간대가 없으면 09:00–18:00 */
interface MockSettings {
  timeTrackingEnabled: boolean
  workHoursStart?: string
  workHoursEnd?: string
}

interface WorklogState {
  projects: Project[]
  tags: Tag[]
  tasks: Task[]
  /** 업무 기록(P2-02). 예전 저장본에는 없다 */
  records?: WorkRecord[]
  /** 확인 대기 예시를 한 번 만들었는지(P2-03). 처리한 뒤 다시 생기지 않게 */
  pendingSeeded?: boolean
}

/** 확인 대기 기록은 계획(회차) 값을 붙여 둔다. 진짜 서버는 일정에서 읽지만 mock은 일정과 따로 논다 */
type MockRecord = WorkRecord & { plan?: PendingRecord['plan'] }

const seoulToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 처음 확인 대기를 볼 때 어제·그제의 끝난 계획 3건을 만든다(서울 시각, 열린 업무에 연결) */
function seedPending(state: WorklogState, records: MockRecord[]) {
  if (state.pendingSeeded) return
  state.pendingSeeded = true
  const today = seoulToday()
  const open = state.tasks.filter((t) => !t.deletedAt && t.status !== 'DONE')
  const plans: [string, number, string, string][] = [
    ['데일리 스탠드업', -1, '09:00', '09:30'],
    ['고객사 요구사항 미팅', -1, '14:00', '15:00'],
    ['주간 회고', -2, '17:00', '18:00'],
  ]
  plans.forEach(([title, offset, start, end], i) => {
    const date = shiftDate(today, offset)
    const startAt = new Date(`${date}T${start}:00+09:00`).toISOString()
    const task = open[i]
    records.push({
      id: id(),
      status: 'PENDING',
      workDate: date,
      content: title,
      taskId: task?.id ?? null,
      projectId: task?.projectId ?? null,
      tagIds: task?.tagIds ?? [],
      scheduleId: `mock-schedule-pending-${i}`,
      occurrenceStart: startAt,
      result: null,
      outcome: null,
      progress: null,
      startAt: null,
      endAt: null,
      durationMin: null,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
      version: 0,
      plan: {
        title,
        allDay: false,
        startAt,
        endAt: new Date(`${date}T${end}:00+09:00`).toISOString(),
        startDate: null,
        endDate: null,
      },
    })
  })
}

/** 끝난 회차(최근 7일)마다 확인 대기 기록을 만든다 — 서버가 조회 때 하는 일(D-100). 회차는 mock 캘린더에서 읽고, plan은 회차의 지금 값 */
/** 캘린더 mock의 회차 목록(from~to)을 읽는다 */
function occurrencesBetween(from: string, to: string): Occurrence[] {
  let occurrences: Occurrence[] = []
  handleScheduleMock(
    'GET',
    `/api/worklog/schedules?from=${from}&to=${to}`,
    {},
    {
      json: (_status, body) => {
        occurrences = (body as { items: Occurrence[] }).items
        return new Response(null)
      },
      problem: () => new Response(null),
    },
  )
  return occurrences
}

function syncPlanRecords(state: WorklogState, records: MockRecord[]) {
  const nowMs = Date.now()
  const from = new Date(`${shiftDate(seoulToday(), -6)}T00:00:00+09:00`).toISOString()
  for (const o of occurrencesBetween(from, new Date(nowMs).toISOString())) {
    const end = o.allDay ? Date.parse(`${shiftDate(o.endDate!, 1)}T00:00:00+09:00`) : Date.parse(o.endAt!)
    if (end > nowMs) continue
    const plan = {
      title: o.title,
      allDay: o.allDay,
      startAt: o.startAt ?? undefined,
      endAt: o.endAt ?? undefined,
      startDate: o.startDate ?? undefined,
      endDate: o.endDate ?? undefined,
    }
    const key = Date.parse(o.occurrenceStart)
    const existing = records.find((r) => r.scheduleId === o.scheduleId && Date.parse(r.occurrenceStart ?? '') === key)
    if (existing) {
      existing.plan = plan
      continue
    }
    const task = state.tasks.find((t) => t.id === o.taskId)
    records.push({
      id: id(),
      status: 'PENDING',
      workDate: o.allDay ? o.startDate! : seoulDate(o.startAt!),
      content: o.title,
      taskId: o.taskId ?? null,
      projectId: task?.projectId ?? null,
      tagIds: task?.tagIds ?? [],
      scheduleId: o.scheduleId,
      occurrenceStart: o.occurrenceStart,
      result: null,
      outcome: null,
      progress: null,
      startAt: null,
      endAt: null,
      durationMin: null,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
      version: 0,
      plan,
    })
  }
}

const now = () => new Date().toISOString()
const id = () => `mock-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`

// 예시 데이터는 ID를 고정한다. 저장 전에 다시 불러와도 같은 ID라 첫 수정이 404가 되지 않는다(qa 관찰).
function seed(): WorklogState {
  const project = (key: string, name: string, color: Project['color'], taskCount: number): Project => ({
    id: `mock-project-${key}`,
    name,
    color,
    archived: false,
    archivedAt: null,
    taskCount,
    openTaskCount: 0,
    createdAt: now(),
    version: 0,
  })
  const tag = (key: string, name: string, usageCount: number): Tag => ({
    id: `mock-tag-${key}`,
    name,
    usageCount,
    createdAt: now(),
    version: 0,
  })
  return {
    tasks: seedTasks(),
    projects: [project('dev', '개발', 'P1', 5), project('sales', '영업', 'P2', 4), project('common', '공통', 'P3', 2)],
    tags: [
      tag('payment', '결제', 4),
      tag('quote', '견적', 3),
      tag('sprint', '스프린트', 2),
      tag('report', '보고', 2),
      tag('review', '리뷰', 1),
      tag('onboarding', '온보딩', 1),
    ],
  }
}

function seedTasks(): Task[] {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  const task = (key: string, title: string, extra: Partial<Task>): Task => ({
    id: `mock-task-${key}`,
    title,
    status: 'TODO',
    priority: 'NORMAL',
    dueDate: null,
    progress: 0,
    completedAt: null,
    projectId: null,
    tagIds: [],
    hasSchedule: false,
    memo: null,
    carriedOverFromId: null,
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
    version: 0,
    ...extra,
  })
  return [
    task('report', '9월 매출 보고서', {
      dueDate: day(-1),
      priority: 'HIGH',
      projectId: 'mock-project-sales',
      tagIds: ['mock-tag-report'],
    }),
    task('quote', '견적서 작성 — 한빛상사', {
      dueDate: day(0),
      projectId: 'mock-project-sales',
      tagIds: ['mock-tag-quote'],
      status: 'IN_PROGRESS',
      progress: 40,
    }),
    task('review', '코드 리뷰 — PR #42', {
      dueDate: day(0),
      projectId: 'mock-project-dev',
      tagIds: ['mock-tag-review'],
    }),
    task('api-doc', '결제 API 문서화', {
      dueDate: day(1),
      projectId: 'mock-project-dev',
      tagIds: ['mock-tag-payment'],
    }),
    task('onboarding', '온보딩 자료 업데이트', {
      dueDate: day(1),
      projectId: 'mock-project-common',
      tagIds: ['mock-tag-onboarding'],
      priority: 'LOW',
    }),
    task('idea', '팀 회고 아이디어 정리', {}),
    task('done', '스프린트 계획 공유', {
      status: 'DONE',
      progress: 100,
      completedAt: now(),
      projectId: 'mock-project-dev',
      tagIds: ['mock-tag-sprint'],
    }),
  ]
}

function load(): WorklogState {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const stored = JSON.parse(raw) as WorklogState
      return stored.tasks ? stored : { ...stored, tasks: seedTasks() }
    }
  } catch {
    // 저장소를 못 쓰면 예시 데이터로 시작
  }
  // 처음 불러올 때 바로 저장해 이후 요청이 같은 데이터를 본다
  const initial = seed()
  save(initial)
  return initial
}

function save(state: WorklogState) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state))
  } catch {
    // 무시
  }
}

type Respond = {
  json: (status: number, body: unknown) => Response
  problem: (status: number, code: string, extra?: Record<string, unknown>) => Response
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name)

/** 처리한 요청이면 응답, 아니면 null */
export function handleWorklog(
  method: string,
  url: string,
  body: Record<string, unknown>,
  r: Respond,
  settings: MockSettings = { timeTrackingEnabled: false },
): Response | null {
  const path = url.split('?')[0]
  const state = load()
  // 남은 업무 수는 업무 목록으로 매번 계산한다(보관·완료 제외)
  for (const p of state.projects) {
    p.openTaskCount = state.tasks.filter((t) => t.projectId === p.id && !t.deletedAt && t.status !== 'DONE').length
  }

  if (method === 'GET' && path === '/api/worklog/projects') {
    const includeArchived = url.includes('includeArchived=true')
    return r.json(200, { items: state.projects.filter((p) => includeArchived || !p.archived) })
  }

  if (method === 'POST' && path === '/api/worklog/projects') {
    const name = String(body.name ?? '').trim()
    if (!name || name.length > 50)
      return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'name', code: 'INVALID' }] })
    if (state.projects.some((p) => sameName(p.name, name))) return r.problem(409, 'DUPLICATE_NAME')
    const project: Project = {
      id: id(),
      name,
      color: body.color as Project['color'],
      archived: false,
      archivedAt: null,
      taskCount: 0,
      openTaskCount: 0,
      createdAt: now(),
      version: 0,
    }
    state.projects.push(project)
    save(state)
    return r.json(201, project)
  }

  const projectMatch = /^\/api\/worklog\/projects\/([^/]+)$/.exec(path)
  if (method === 'PATCH' && projectMatch) {
    const project = state.projects.find((p) => p.id === projectMatch[1])
    if (!project) return r.problem(404, 'NOT_FOUND')
    if (body.version !== project.version) return r.problem(409, 'VERSION_CONFLICT')
    if (typeof body.archived === 'boolean' && body.archived !== project.archived) {
      project.archived = body.archived
      project.archivedAt = body.archived ? now() : null
      project.version += 1
    }
    save(state)
    return r.json(200, project)
  }

  if (method === 'GET' && path === '/api/worklog/tags') return r.json(200, { items: [...state.tags].sort(byName) })

  // 태그 get-or-create: 같은 이름이면 200으로 기존 태그
  if (method === 'POST' && path === '/api/worklog/tags') {
    const name = String(body.name ?? '').trim()
    if (!/^[^\s#]{1,30}$/.test(name)) {
      return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'name', code: 'INVALID' }] })
    }
    const existing = state.tags.find((t) => sameName(t.name, name))
    if (existing) return r.json(200, existing)
    const tag: Tag = { id: id(), name, usageCount: 0, createdAt: now(), version: 0 }
    state.tags.push(tag)
    save(state)
    return r.json(201, tag)
  }

  const tasks = handleTasks(method, url, body, state, r)
  if (tasks) return tasks

  const gaps = handleGapsAndSummary(method, url, state, r, settings)
  if (gaps) return gaps

  const records = handleRecords(method, url, body, state, r)
  if (records) return records

  const timer = handleTimer(method, path, body, state, r, settings.timeTrackingEnabled)
  if (timer) return timer

  const tagMatch = /^\/api\/worklog\/tags\/([^/]+)$/.exec(path)
  if (tagMatch) {
    const tag = state.tags.find((t) => t.id === tagMatch[1])
    if (!tag) return r.problem(404, 'NOT_FOUND')
    if (method === 'DELETE') {
      state.tags = state.tags.filter((t) => t !== tag)
      save(state)
      return new Response(null, { status: 204 })
    }
    if (method === 'PATCH') {
      if (body.version !== tag.version) return r.problem(409, 'VERSION_CONFLICT')
      const name = String(body.name ?? '')
      if (!/^[^\s#]{1,30}$/.test(name))
        return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'name', code: 'INVALID' }] })
      if (state.tags.some((t) => t !== tag && sameName(t.name, name))) return r.problem(409, 'DUPLICATE_NAME')
      if (name !== tag.name) {
        tag.name = name
        tag.version += 1
      }
      save(state)
      return r.json(200, tag)
    }
  }

  return null
}

const TASK_FIELDS = ['title', 'status', 'priority', 'dueDate', 'progress', 'projectId', 'tagIds', 'memo'] as const

function handleTasks(
  method: string,
  url: string,
  body: Record<string, unknown>,
  state: WorklogState,
  r: Respond,
): Response | null {
  const path = url.split('?')[0]
  if (!path.startsWith('/api/worklog/tasks')) return null
  // 일정 배치 여부는 가짜 일정 서버(frontend2 mockSchedules)의 연결 업무로 매번 계산한다
  const linked = scheduledTaskIds()
  for (const t of state.tasks) t.hasSchedule = linked.has(t.id)
  // 자주 하는 업무 제안(P2-04). 체험용이라 요일·시간대·2번 이상 조건 없이 같은 제목 묶음 상위 3개를 준다
  if (method === 'GET' && path === '/api/worklog/tasks/frequent') {
    return r.json(200, { items: frequentTasks(state) })
  }
  if (method === 'GET' && path === '/api/worklog/tasks') {
    const q = new URLSearchParams(url.split('?')[1] ?? '')
    const statuses = q.getAll('status')
    const projectIds = q.getAll('projectId')
    const tagIds = q.getAll('tagId')
    const deleted = q.get('deleted') === 'true'
    const scheduled = q.get('scheduled')
    const keyword = q.get('q')?.toLowerCase()
    const archivedProjects = new Set(state.projects.filter((p) => p.archived).map((p) => p.id))
    let items = state.tasks.filter((t) => {
      if (Boolean(t.deletedAt) !== deleted) return false
      if (statuses.length && !statuses.includes(t.status)) return false
      if (projectIds.length) {
        if (!t.projectId || !projectIds.includes(t.projectId)) return false
      } else if (t.projectId && archivedProjects.has(t.projectId)) return false
      if (tagIds.length && !t.tagIds.some((tag) => tagIds.includes(tag))) return false
      if (scheduled !== null && String(t.hasSchedule) !== scheduled) return false
      if (keyword && !t.title.toLowerCase().includes(keyword)) return false
      const dueFrom = q.get('dueFrom')
      const dueTo = q.get('dueTo')
      if (dueFrom && (!t.dueDate || t.dueDate < dueFrom)) return false
      if (dueTo && (!t.dueDate || t.dueDate > dueTo)) return false
      const since = q.get('completedSince')
      if (since && t.status === 'DONE' && (t.completedAt ?? '') < since) return false
      return true
    })
    items =
      q.get('sort') === 'created'
        ? items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : items.sort(
            (a, b) =>
              (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.createdAt.localeCompare(b.createdAt),
          )
    // cursor는 다음 시작 위치(숫자)를 그대로 쓴다
    const start = Number(q.get('cursor') ?? 0)
    const limit = Number(q.get('limit') ?? 50)
    const page = items.slice(start, start + limit)
    return r.json(200, { items: page, nextCursor: start + limit < items.length ? String(start + limit) : null })
  }

  if (method === 'POST' && path === '/api/worklog/tasks') {
    const title = String(body.title ?? '').trim()
    if (!title || title.length > 200) {
      return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'title', code: 'INVALID' }] })
    }
    const status = (body.status as Task['status']) ?? 'TODO'
    const task: Task = {
      id: id(),
      title,
      status,
      priority: (body.priority as Task['priority']) ?? 'NORMAL',
      dueDate: (body.dueDate as string | null) ?? null,
      progress: (body.progress as number) ?? 0,
      completedAt: status === 'DONE' ? now() : null,
      projectId: (body.projectId as string | null) ?? null,
      tagIds: (body.tagIds as string[]) ?? [],
      hasSchedule: false,
      memo: (body.memo as string | null) ?? null,
      carriedOverFromId: null,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
      version: 0,
    }
    state.tasks.push(task)
    save(state)
    return r.json(201, task)
  }

  const m = /^\/api\/worklog\/tasks\/([^/]+)(\/restore)?$/.exec(path)
  if (!m) return null
  const task = state.tasks.find((t) => t.id === m[1])
  if (!task) return r.problem(404, 'NOT_FOUND')

  if (m[2] && method === 'POST') {
    if (task.deletedAt) {
      task.deletedAt = null
      task.version += 1
      save(state)
    }
    return r.json(200, task)
  }
  if (method === 'GET') return r.json(200, task)
  if (method === 'DELETE') {
    if (!task.deletedAt) {
      task.deletedAt = now()
      task.version += 1
      save(state)
    }
    return new Response(null, { status: 204 })
  }
  if (method === 'PATCH') {
    if (task.deletedAt) return r.problem(409, 'TASK_DELETED')
    if (body.version !== task.version) return r.problem(409, 'VERSION_CONFLICT')
    const before = JSON.stringify(task)
    for (const field of TASK_FIELDS) {
      if (field in body) Object.assign(task, { [field]: body[field] })
    }
    if ('status' in body) task.completedAt = task.status === 'DONE' ? (task.completedAt ?? now()) : null
    if (JSON.stringify(task) !== before) {
      task.version += 1
      task.updatedAt = now()
    }
    save(state)
    return r.json(200, task)
  }
  return null
}

// 업무 기록(P2-02). 결과 입력 팝오버(SCR-TASK-03)가 만들고 되돌리기가 보관한다. 시간 칸·확인 대기는 다루지 않는다
const RECORD_FIELDS = [
  'content',
  'workDate',
  'taskId',
  'result',
  'outcome',
  'progress',
  'startAt',
  'endAt',
  'durationMin',
]

/** 기록 칸 검사(계약 WorkRecordCreate, D-101). PATCH는 보낸 칸을 지금 값에 덮은 전체로 검사한다 */
function recordFields(body: Record<string, unknown>, current: WorkRecord | null, state: WorklogState, r: Respond) {
  const pick = <K extends keyof WorkRecord>(k: K) =>
    (k in body ? body[k] : current ? current[k] : null) as WorkRecord[K] | null | undefined
  const invalid = (field: string, code: string) => r.problem(400, 'VALIDATION_FAILED', { errors: [{ field, code }] })
  const content = String(pick('content') ?? '').trim()
  const outcome = pick('outcome') ?? null
  const progress = pick('progress') ?? null
  const startAt = pick('startAt') ?? null
  const endAt = pick('endAt') ?? null
  // 서버와 같이 null은 보내지 않은 것으로 본다(PATCH에서 키만 있고 null이면 지금 값을 비우는 뜻이 아님)
  const durationSent = body.durationMin != null
  const sentOrKept = pick('durationMin') ?? null
  if (!content || content.length > 500) return invalid('content', 'INVALID')
  if (progress !== null && outcome !== 'IN_PROGRESS') return invalid('progress', 'INVALID_FORMAT')
  if (endAt && !startAt) return invalid('endAt', 'INVALID_ORDER')
  if (startAt && !endAt) return invalid('endAt', 'REQUIRED')
  if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) return invalid('endAt', 'INVALID_ORDER')
  if (startAt && durationSent) return invalid('durationMin', 'INVALID_FORMAT')
  // startAt이 있으면 소요시간은 endAt-startAt(분, 버림)으로 계산하고 진행 중이면 null(서버 WorkRecordService.check)
  const durationMin = startAt
    ? endAt
      ? Math.floor((Date.parse(endAt) - Date.parse(startAt)) / 60_000)
      : null
    : sentOrKept
  // startAt이 있으면 workDate는 사용자 시간대(mock은 서울) 날짜로 계산한다
  const workDate = startAt ? seoulDate(startAt) : pick('workDate')
  if (!workDate) return invalid('workDate', 'REQUIRED')
  const taskId = pick('taskId') ?? null
  const task = taskId ? state.tasks.find((t) => t.id === taskId && !t.deletedAt) : undefined
  // 이미 연결된 업무가 나중에 보관됐어도 그대로 두는 수정은 막지 않는다
  if (taskId && !task && taskId !== current?.taskId) return r.problem(404, 'NOT_FOUND')
  const kept = taskId && !task ? current : null
  const result = String(pick('result') ?? '').trim()
  return {
    content,
    workDate: String(workDate),
    taskId,
    projectId: task?.projectId ?? kept?.projectId ?? null,
    tagIds: task?.tagIds ?? kept?.tagIds ?? [],
    result: result || null,
    outcome,
    progress,
    startAt,
    endAt,
    durationMin,
  }
}

function seoulDate(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
}

function handleRecords(
  method: string,
  url: string,
  body: Record<string, unknown>,
  state: WorklogState,
  r: Respond,
): Response | null {
  const path = url.split('?')[0]
  if (!path.startsWith('/api/worklog/records')) return null
  const records: MockRecord[] = (state.records ??= [])
  // 확인 대기(P2-03): 최근 7일(서울 기준 오늘 포함)의 PENDING만, 계획 값을 붙여서
  const recent = (x: MockRecord) =>
    x.status === 'PENDING' && !x.deletedAt && x.plan && x.workDate >= shiftDate(seoulToday(), -6)
  if (method === 'GET' && path === '/api/worklog/records/pending') {
    seedPending(state, records)
    syncPlanRecords(state, records)
    save(state)
    const items = records
      .filter(recent)
      .sort(
        (a, b) =>
          a.workDate.localeCompare(b.workDate) || (a.occurrenceStart ?? '').localeCompare(b.occurrenceStart ?? ''),
      )
    return r.json(200, { items })
  }
  if (method === 'POST' && path === '/api/worklog/records/pending/confirm') {
    const ids = Array.isArray(body.ids) ? (body.ids as string[]) : []
    if (ids.length === 0) return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'ids', code: 'REQUIRED' }] })
    const done = records.filter((x) => ids.includes(x.id) && recent(x))
    for (const x of done) Object.assign(x, { status: 'CONFIRMED', version: x.version + 1, updatedAt: now() })
    save(state)
    return r.json(200, { items: done })
  }
  if (method === 'GET' && path === '/api/worklog/records') {
    syncPlanRecords(state, records)
    save(state)
    const q = new URLSearchParams(url.split('?')[1] ?? '')
    const from = q.get('from') ?? ''
    const to = q.get('to') ?? ''
    const taskId = q.get('taskId')
    const statuses = q.getAll('status').flatMap((v) => v.split(','))
    const items = records
      .filter((x) => !x.deletedAt && x.workDate >= from && x.workDate <= to && (!taskId || x.taskId === taskId))
      .filter((x) => statuses.length === 0 || statuses.includes(x.status))
      .sort((a, b) => a.workDate.localeCompare(b.workDate) || a.id.localeCompare(b.id))
    return r.json(200, { items })
  }
  if (method === 'POST' && path === '/api/worklog/records') {
    const fields = recordFields(body, null, state, r)
    if (fields instanceof Response) return fields
    const record: WorkRecord = {
      id: id(),
      status: 'CONFIRMED',
      scheduleId: null,
      occurrenceStart: null,
      ...fields,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
      version: 0,
    }
    records.push(record)
    save(state)
    return r.json(201, record)
  }
  const restore = /^\/api\/worklog\/records\/([^/]+)\/restore$/.exec(path)
  if (restore && method === 'POST') {
    const record = records.find((x) => x.id === restore[1])
    if (!record) return r.problem(404, 'NOT_FOUND')
    if (record.deletedAt) {
      Object.assign(record, { deletedAt: null, version: record.version + 1, updatedAt: now() })
      save(state)
    }
    return r.json(200, record)
  }
  const m = /^\/api\/worklog\/records\/([^/]+)$/.exec(path)
  // 하나 읽기(SCR-REC-01). 보관한 기록도 준다
  if (m && method === 'GET') {
    const record = records.find((x) => x.id === m[1])
    return record ? r.json(200, record) : r.problem(404, 'NOT_FOUND')
  }
  // 했어요·안 했어요·되돌리기(상태)와 내용 수정(SCR-REC-01). 보낸 칸만 바꾸고 바꾼 뒤 전체 값으로 검사한다
  if (m && method === 'PATCH') {
    const record = records.find((x) => x.id === m[1])
    if (!record) return r.problem(404, 'NOT_FOUND')
    if (record.deletedAt) return r.problem(409, 'RECORD_DELETED')
    if (body.version !== record.version) return r.problem(409, 'VERSION_CONFLICT')
    const status = body.status as WorkRecord['status'] | undefined
    const statusChange = Boolean(status && status !== record.status)
    if (statusChange && !record.occurrenceStart && status !== 'CONFIRMED') return r.problem(409, 'INVALID_STATUS')
    const fields = Object.keys(body).some((k) => RECORD_FIELDS.includes(k))
      ? recordFields(body, record, state, r)
      : null
    if (fields instanceof Response) return fields
    if (fields || statusChange) {
      Object.assign(record, fields, statusChange ? { status } : {}, { version: record.version + 1, updatedAt: now() })
      save(state)
    }
    return r.json(200, record)
  }
  if (m && method === 'DELETE') {
    const record = records.find((x) => x.id === m[1])
    if (!record) return r.problem(404, 'NOT_FOUND')
    if (!record.deletedAt) {
      record.deletedAt = now()
      record.version += 1
      save(state)
    }
    return new Response(null, { status: 204 })
  }
  return null
}

function frequentTasks(state: WorklogState) {
  const groups = new Map<string, Task[]>()
  for (const t of state.tasks) {
    if (t.deletedAt) continue
    const key = t.title.trim().replace(/\s+/g, ' ').toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  return [...groups.values()]
    .map((group) => {
      const latest = group.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b))
      return {
        title: latest.title,
        projectId: latest.projectId,
        tagIds: latest.tagIds,
        latestTaskId: latest.id,
        count: group.length,
      }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
}

const GAP_MIN = 15
const minutesBetween = (from: number, to: number) => Math.floor((to - from) / 60_000)

/**
 * 빈 시간(P2-07, GET /records/gaps)과 시간 집계(GET /records/time-summary). 시간대는 서울로 고정한다.
 * 빈 시간: 업무 시간대 중 확정 기록(실행 중 타이머는 지금까지)이 덮지 않은 15분 이상 구간. 오늘이면 지금 이후는 빼고, 미래 날짜는 빈 배열.
 */
function handleGapsAndSummary(
  method: string,
  url: string,
  state: WorklogState,
  r: Respond,
  settings: MockSettings,
): Response | null {
  const path = url.split('?')[0]
  if (method !== 'GET') return null
  const q = new URLSearchParams(url.split('?')[1] ?? '')
  const records: MockRecord[] = (state.records ??= [])
  const confirmed = records.filter((x) => !x.deletedAt && x.status === 'CONFIRMED')

  if (path === '/api/worklog/records/time-summary') {
    const from = q.get('from') ?? ''
    const to = q.get('to') ?? ''
    const minutesOf = (x: MockRecord) =>
      x.startAt && x.endAt ? minutesBetween(Date.parse(x.startAt), Date.parse(x.endAt)) : (x.durationMin ?? 0)
    // 실행 중 타이머는 끝나야 센다
    const counted = confirmed.filter((x) => x.workDate >= from && x.workDate <= to && (!x.startAt || x.endAt))
    const projectOf = (taskId: string | null | undefined) => state.tasks.find((t) => t.id === taskId)?.projectId ?? null
    const sum = (key: (x: MockRecord) => string | null) => {
      const m = new Map<string | null, number>()
      for (const x of counted) m.set(key(x), (m.get(key(x)) ?? 0) + minutesOf(x))
      return [...m.entries()].sort((a, b) => b[1] - a[1])
    }
    return r.json(200, {
      from,
      to,
      totalMin: counted.reduce((n, x) => n + minutesOf(x), 0),
      recordCount: counted.length,
      projects: sum((x) => projectOf(x.taskId) ?? x.projectId ?? null).map(([projectId, minutes]) => ({
        projectId,
        minutes,
      })),
      tasks: sum((x) => x.taskId ?? null).map(([taskId, minutes]) => ({
        taskId,
        projectId: projectOf(taskId),
        minutes,
      })),
    })
  }

  if (path !== '/api/worklog/records/gaps') return null
  const date = q.get('date') ?? seoulToday()
  if (date > seoulToday()) return r.json(200, { items: [] })
  // 먼저 끝난 회차의 확인 대기를 만든다(D-31) — 계획 후보가 그 기록을 가리키게
  syncPlanRecords(state, records)
  save(state)
  const nowMs = Date.now()
  const at = (hhmm: string) => Date.parse(`${date}T${hhmm}:00+09:00`)
  const dayStart = at(settings.workHoursStart ?? '09:00')
  const dayEnd = Math.min(at(settings.workHoursEnd ?? '18:00'), nowMs)
  const covered = confirmed
    .filter((x) => x.startAt)
    .map((x) => [Date.parse(x.startAt!), x.endAt ? Date.parse(x.endAt) : nowMs] as const)
    .sort((a, b) => a[0] - b[0])
  const spans: [number, number][] = []
  let cursor = dayStart
  for (const [s, e] of covered) {
    if (cursor >= dayEnd) break
    if (s > cursor) spans.push([cursor, Math.min(s, dayEnd)])
    cursor = Math.max(cursor, e)
  }
  if (cursor < dayEnd) spans.push([cursor, dayEnd])

  const occurrences = occurrencesBetween(new Date(dayStart).toISOString(), new Date(dayEnd).toISOString()).filter(
    (o) => !o.allDay,
  )
  const linkOf = (o: Occurrence) =>
    records.find(
      (x) =>
        !x.deletedAt &&
        x.scheduleId === o.scheduleId &&
        Date.parse(x.occurrenceStart ?? '') === Date.parse(o.occurrenceStart),
    )
  const frequent = frequentTasks(state)[0] ?? null
  const items = spans
    .filter(([s, e]) => minutesBetween(s, e) >= GAP_MIN)
    .map(([s, e]) => {
      const previous = confirmed
        .filter((x) => x.startAt && x.endAt && Date.parse(x.endAt) <= s && seoulDate(x.startAt) === date)
        .sort((a, b) => Date.parse(b.endAt!) - Date.parse(a.endAt!))[0]
      // 구간과 가장 많이 겹치는 회차(이미 처리한 회차 제외)
      const overlap = (o: Occurrence) => Math.min(e, Date.parse(o.endAt!)) - Math.max(s, Date.parse(o.startAt!))
      const plan = occurrences
        .filter((o) => overlap(o) > 0 && (linkOf(o)?.status ?? 'PENDING') === 'PENDING')
        .sort((a, b) => overlap(b) - overlap(a))[0]
      return {
        startAt: new Date(s).toISOString(),
        endAt: new Date(e).toISOString(),
        minutes: minutesBetween(s, e),
        previous: previous ? { content: previous.content, taskId: previous.taskId ?? null } : null,
        plan: plan
          ? {
              title: plan.title,
              scheduleId: plan.scheduleId,
              occurrenceStart: plan.occurrenceStart,
              startAt: plan.startAt!,
              endAt: plan.endAt!,
              taskId: plan.taskId ?? null,
              pendingRecordId: linkOf(plan)?.id ?? null,
            }
          : null,
        frequent,
      }
    })
  return r.json(200, { items })
}

// 타이머(P2-06, D-101): 실행 중 타이머 = endAt 없는 확정 기록(하나). 정지 규칙: 1분 미만 버림, 24시간 상한
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const runningOf = (records: MockRecord[]) => records.find((x) => !x.deletedAt && x.startAt && !x.endAt)

function stopRunning(records: MockRecord[]) {
  const running = runningOf(records)
  if (!running) return null
  const startMs = Date.parse(running.startAt!)
  const elapsed = Date.now() - startMs
  if (elapsed < MINUTE) {
    // 회차를 가져간 기록은 시간만 비워 확인 대기로, 직접 시작한 기록은 지운다
    if (running.occurrenceStart) {
      Object.assign(running, { status: 'PENDING', startAt: null, endAt: null, durationMin: null })
      Object.assign(running, { version: running.version + 1, updatedAt: now() })
    } else records.splice(records.indexOf(running), 1)
    return { record: { ...running }, discarded: true, capped: false }
  }
  const capped = elapsed > DAY
  const end = capped ? startMs + DAY : startMs + elapsed
  Object.assign(running, {
    endAt: new Date(end).toISOString(),
    durationMin: Math.floor((end - startMs) / MINUTE),
    version: running.version + 1,
    updatedAt: now(),
  })
  return { record: running, discarded: false, capped }
}

const sameOccurrence = (x: MockRecord, scheduleId: string, occurrenceStart: string) =>
  x.scheduleId === scheduleId && Date.parse(x.occurrenceStart ?? '') === Date.parse(occurrenceStart)

/** 이어달리기 제안: 오늘 끝나지 않은 시간 회차 중 확정·하지 않음 기록이 없는 것 — 진행 중 우선, 그다음 가장 이른 것 */
function nextPlan(records: MockRecord[]) {
  const nowMs = Date.now()
  const today = seoulToday()
  const open = occurrencesBetween(
    new Date(`${today}T00:00:00+09:00`).toISOString(),
    new Date(`${shiftDate(today, 1)}T00:00:00+09:00`).toISOString(),
  )
    .filter((o) => !o.allDay && Date.parse(o.endAt!) > nowMs)
    .filter(
      (o) =>
        !records.some(
          (x) => !x.deletedAt && x.status !== 'PENDING' && sameOccurrence(x, o.scheduleId, o.occurrenceStart),
        ),
    )
    .sort((a, b) => Date.parse(a.startAt!) - Date.parse(b.startAt!))
  const o = open.find((x) => Date.parse(x.startAt!) <= nowMs) ?? open[0]
  if (!o) return null
  return {
    scheduleId: o.scheduleId,
    occurrenceStart: o.occurrenceStart,
    title: o.title,
    startAt: o.startAt!,
    endAt: o.endAt!,
    taskId: o.taskId ?? null,
  }
}

function handleTimer(
  method: string,
  path: string,
  body: Record<string, unknown>,
  state: WorklogState,
  r: Respond,
  timeTracking: boolean,
): Response | null {
  if (!path.startsWith('/api/worklog/timer')) return null
  const records: MockRecord[] = (state.records ??= [])
  if (method === 'GET' && path === '/api/worklog/timer') return r.json(200, { running: runningOf(records) ?? null })
  // 옵션이 꺼져 있어도 남은 타이머는 멈출 수 있다
  if (method === 'POST' && path === '/api/worklog/timer/stop') {
    const stopped = stopRunning(records)
    save(state)
    return r.json(200, { stopped, next: stopped ? nextPlan(records) : null })
  }
  if (method !== 'POST' || path !== '/api/worklog/timer/start') return null
  if (!timeTracking) return r.problem(409, 'TIME_TRACKING_DISABLED')
  const taskId = (body.taskId as string | null | undefined) ?? null
  const content = String(body.content ?? '').trim()
  const scheduleId = (body.scheduleId as string | null | undefined) ?? null
  const occurrenceStart = (body.occurrenceStart as string | null | undefined) ?? null
  const task = taskId ? state.tasks.find((t) => t.id === taskId && !t.deletedAt) : undefined
  if (taskId && !task) return r.problem(404, 'NOT_FOUND')
  let occurrence: Occurrence | undefined
  let taken: MockRecord | undefined
  if (scheduleId || occurrenceStart) {
    if (!scheduleId || !occurrenceStart)
      return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'scheduleId', code: 'REQUIRED' }] })
    const key = Date.parse(occurrenceStart)
    occurrence = occurrencesBetween(new Date(key - DAY).toISOString(), new Date(key + DAY).toISOString()).find(
      (o) => o.scheduleId === scheduleId && Date.parse(o.occurrenceStart) === key,
    )
    if (!occurrence) return r.problem(404, 'NOT_FOUND')
    taken = records.find((x) => sameOccurrence(x, scheduleId, occurrenceStart))
    if (taken && (taken.status !== 'PENDING' || taken.deletedAt)) return r.problem(409, 'ALREADY_RECORDED')
  } else if (!task && !content) {
    return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'content', code: 'REQUIRED' }] })
  }
  const stopped = stopRunning(records)
  const linked = task ?? state.tasks.find((t) => t.id === occurrence?.taskId && !t.deletedAt)
  const fields = {
    status: 'CONFIRMED' as const,
    content: content || task?.title || occurrence?.title || '',
    taskId: linked?.id ?? null,
    projectId: linked?.projectId ?? null,
    tagIds: linked?.tagIds ?? [],
    startAt: now(),
    endAt: null,
    durationMin: null,
    workDate: seoulToday(),
  }
  let running: MockRecord
  if (taken) running = Object.assign(taken, fields, { version: taken.version + 1, updatedAt: now() })
  else {
    running = {
      id: id(),
      ...fields,
      scheduleId: occurrence?.scheduleId ?? null,
      occurrenceStart: occurrence?.occurrenceStart ?? null,
      result: null,
      outcome: null,
      progress: null,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
      version: 0,
    }
    records.push(running)
  }
  save(state)
  return r.json(200, { running, stopped })
}
