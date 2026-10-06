// 빠른 입력 저장 (REC-04, SCR-COM-02 "Enter 저장"). 홈·업무 목록·캘린더 업무 패널이 함께 쓴다.
// 시간이 있으면 업무 + 그 업무에 연결된 일정, 없으면 업무만 만든다. 되돌리기는 각 화면이 showUndo에 undoQuickSave를 넘긴다.
import { fromZoned } from '../calendar/time'
import { scheduleApi, type Schedule } from '../calendar/api'
import { tagApi, type Project } from '../projects/api'
import type { QuickDraft } from '../quickInput/parse'
import { taskApi, type Task } from './api'

/** 아직 없는 @프로젝트로 저장하려 함. 화면은 "새 프로젝트 만들기" 칩을 먼저 누르게 안내한다 */
export class NeedsProjectError extends Error {
  readonly projectName: string
  constructor(projectName: string) {
    super('NEEDS_PROJECT')
    this.name = 'NeedsProjectError'
    this.projectName = projectName
  }
}

export interface QuickSaveResult {
  task: Task
  schedule?: Schedule
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export async function saveQuickDraft(
  draft: QuickDraft,
  context: { projects: Project[]; timeZone: string },
): Promise<QuickSaveResult> {
  let projectId: string | undefined
  if (draft.project) {
    const name = draft.project.toLowerCase()
    const project = context.projects.find((p) => p.name.toLowerCase() === name)
    if (!project) throw new NeedsProjectError(draft.project)
    projectId = project.id
  }

  // 없는 태그는 이때 만든다(같은 이름이면 기존 태그를 돌려받음)
  const tagIds = draft.tags?.length
    ? (await Promise.all(draft.tags.map((t) => tagApi.create(t)))).map((t) => t.id)
    : undefined

  const task = await taskApi.create({
    title: draft.title,
    priority: draft.priority,
    dueDate: draft.due,
    projectId,
    tagIds,
  })
  if (!draft.schedule) return { task }

  const { date, start, end } = draft.schedule
  try {
    const schedule = await scheduleApi.create({
      title: draft.title,
      allDay: false,
      startAt: fromZoned(date, toMinutes(start), context.timeZone),
      endAt: fromZoned(date, toMinutes(end), context.timeZone),
      taskId: task.id,
    })
    return { task, schedule }
  } catch (error) {
    // 일정을 못 만들면 업무만 남지 않게 되돌린 뒤 실패를 알린다
    await taskApi.remove(task.id).catch(() => {})
    throw error
  }
}

/** 빠른 입력으로 만든 것을 되돌린다. 새로 만든 태그는 다른 업무에도 쓰일 수 있어 남겨 둔다 */
export async function undoQuickSave(result: QuickSaveResult): Promise<void> {
  if (result.schedule) await scheduleApi.remove(result.schedule.id)
  await taskApi.remove(result.task.id)
}
