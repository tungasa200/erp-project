// 업무 완료 체크 (TASK-03). 바로 완료하고 되돌리기 토스트를 띄운다. 결과 입력 팝오버(SCR-TASK-03)는 P2.
import { useQueryClient } from '@tanstack/react-query'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useToast } from '../components/useToast'
import { refreshTasks, taskApi, type Task } from './api'

/** 완료했으면 true */
export function useCompleteTask(): (task: Task) => Promise<boolean> {
  const queryClient = useQueryClient()
  const { showToast, showUndo } = useToast()
  const refresh = () => refreshTasks(queryClient)

  return async (task: Task) => {
    try {
      await taskApi.update(task.id, { version: task.version, status: 'DONE' })
      refresh()
      showUndo({
        group: 'complete-task',
        message: (n) => `업무 ${n}개를 완료했어요`,
        undo: async () => {
          const latest = await taskApi.get(task.id)
          await taskApi.update(task.id, { version: latest.version, status: task.status })
          refresh()
        },
      })
      return true
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        refresh()
        showToast('다른 곳에서 먼저 수정돼서 새로 불러왔어요. 다시 해 주세요')
      } else {
        const { message, traceId } = toastForError(error)
        showToast(message, { traceId })
      }
      return false
    }
  }
}
