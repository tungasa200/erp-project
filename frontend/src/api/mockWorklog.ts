// 개발용 가짜 worklog 서버 (contracts/worklog.yaml의 프로젝트·태그). mockServer가 로그인 확인 뒤 여기로 넘긴다.
// 목업 SET-08과 같은 예시 데이터로 시작하고, 고친 내용은 localStorage에 남는다.
import type { Project, Tag } from '../projects/api'

const STORE_KEY = 'worklog.mock.worklog'

interface WorklogState {
  projects: Project[]
  tags: Tag[]
}

const now = () => new Date().toISOString()
const id = () => `mock-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`

function seed(): WorklogState {
  const project = (name: string, color: Project['color'], taskCount: number): Project => ({
    id: id(),
    name,
    color,
    archived: false,
    archivedAt: null,
    taskCount,
    createdAt: now(),
    version: 0,
  })
  const tag = (name: string, usageCount: number): Tag => ({ id: id(), name, usageCount, createdAt: now(), version: 0 })
  return {
    projects: [project('개발', 'P1', 5), project('영업', 'P2', 4), project('공통', 'P3', 2)],
    tags: [tag('결제', 4), tag('견적', 3), tag('스프린트', 2), tag('보고', 2), tag('리뷰', 1), tag('온보딩', 1)],
  }
}

function load(): WorklogState {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as WorklogState
  } catch {
    // 저장소를 못 쓰면 예시 데이터로 시작
  }
  return seed()
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
export function handleWorklog(method: string, url: string, body: Record<string, unknown>, r: Respond): Response | null {
  const path = url.split('?')[0]
  const state = load()

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
