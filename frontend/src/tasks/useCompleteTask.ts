// 업무 완료 체크 (TASK-03). 바로 완료하고 되돌리기 토스트와 결과 입력 팝오버(SCR-TASK-03, P2-02)를 띄운다.
// 되돌리면 팝오버를 닫고(남긴 기록은 보관) 업무를 원래 상태로 돌린다.
import { useQueryClient } from '@tanstack/react-query'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useToast } from '../components/useToast'
import { refreshTasks, taskApi, type Task } from './api'
import { useCompletionResult, type CompletionResultHandle } from './completionResultContext'

/** 완료했으면 true. returnFocus는 결과 팝오버를 닫을 때 포커스를 돌려줄 곳 */
export function useCompleteTask(): (task: Task, options?: { returnFocus?: () => void }) => Promise<boolean> {
  const queryClient = useQueryClient()
  const { showToast, showUndo } = useToast()
  const openResult = useCompletionResult()
  const refresh = () => refreshTasks(queryClient)

  return async (task, options = {}) => {
    try {
      await taskApi.update(task.id, { version: task.version, status: 'DONE' })
      refresh()
      let result: CompletionResultHandle | undefined
      showUndo({
        group: 'complete-task',
        message: (n) => `업무 ${n}개를 완료했어요`,
        undo: async () => {
          await result?.revoke()
          const latest = await taskApi.get(task.id)
          await taskApi.update(task.id, { version: latest.version, status: task.status })
          refresh()
        },
      })
      result = openResult?.(task, options.returnFocus ?? (() => {}))
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
