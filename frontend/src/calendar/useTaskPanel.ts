// 업무 패널 데이터와 배치(P1-08, SCH-04·07). 끌어 놓으면 업무 제목으로 1시간 일정을 만들고 업무에 연결한다.
// 배치는 되돌리기 토스트로 취소할 수 있다(일정 삭제, UX-03).
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toastForError } from '../api/errorToast'
import { useToast } from '../components/useToast'
import type { Project } from '../projects/api'
import type { QuickDraft } from '../quickInput/parse'
import { TASKS_QUERY_KEY, useTasks, type Task, type TaskFilter } from '../tasks/api'
import { NeedsProjectError, saveQuickDraft, undoQuickSave } from '../tasks/quickSave'
import { OCCURRENCES_QUERY_KEY, scheduleApi } from './api'
import type { TimeRange } from './TimeGrid'
import { fromZoned } from './time'

const PANEL_FILTER: TaskFilter = {
  scheduled: false,
  status: ['TODO', 'IN_PROGRESS', 'ON_HOLD'],
  sort: 'due',
  limit: 30,
}

export function useTaskPanel(timeZone: string, projects: Project[]) {
  const queryClient = useQueryClient()
  const { showToast, showUndo } = useToast()
  const tasks = useTasks(PANEL_FILTER)

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: OCCURRENCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
  }, [queryClient])

  const place = useCallback(
    async (task: Task, range: TimeRange) => {
      try {
        const schedule = await scheduleApi.create({
          title: task.title,
          allDay: false,
          startAt: fromZoned(range.date, range.start, timeZone),
          endAt: fromZoned(range.date, range.end, timeZone),
          taskId: task.id,
        })
        refresh()
        showUndo({
          group: 'task-place',
          message: () => '업무를 일정에 넣었어요',
          undo: () =>
            scheduleApi.remove(schedule.id).then(refresh, (error) => {
              const { message, traceId } = toastForError(error)
              showToast(message, { traceId })
            }),
        })
      } catch (error) {
        // 패널을 연 뒤 다른 곳에서 보관한 업무면 404 — 목록을 새로 받는다
        refresh()
        const { message, traceId } = toastForError(error)
        showToast(message, { traceId })
      }
    },
    [refresh, showToast, showUndo, timeZone],
  )

  /** 끌어 놓은 업무 id로 배치 */
  const placeById = useCallback(
    (taskId: string, range: TimeRange) => {
      const task = tasks.items.find((t) => t.id === taskId)
      if (task) void place(task, range)
    },
    [place, tasks.items],
  )

  /** 패널 안 빠른 입력(④). 홈과 같은 저장 규칙(D-62·D-67). 실패하면 입력을 남기도록 reject한다 */
  const quickSave = useCallback(
    async (draft: QuickDraft) => {
      try {
        const result = await saveQuickDraft(draft, { projects, timeZone })
        refresh()
        showUndo({
          group: 'task-quick',
          message: () => (result.schedule ? '업무와 일정을 만들었어요' : '업무를 만들었어요'),
          undo: () =>
            undoQuickSave(result).then(refresh, (error) => {
              const { message, traceId } = toastForError(error)
              showToast(message, { traceId })
            }),
        })
      } catch (error) {
        if (error instanceof NeedsProjectError) showToast(`"${error.projectName}" 프로젝트를 먼저 만들어 주세요`)
        else {
          const { message, traceId } = toastForError(error)
          showToast(message, { traceId })
        }
        throw error
      }
    },
    [projects, refresh, showToast, showUndo, timeZone],
  )

  return { tasks, place, placeById, quickSave }
}
