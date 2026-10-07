// 확인 대기 했어요/안 했어요 처리(REC-03). SCR-HOME-02 패널과 홈 ③ 오늘 일정이 함께 쓴다:
// PATCH 후 되돌리기 토스트(같은 상태끼리 합침), 기록 쿼리 새로 받기, 충돌·없음이면 새로 불러오고 알린다.
import { useQueryClient } from '@tanstack/react-query'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useToast } from '../components/useToast'
import { pendingApi } from './pending'

export type Decision = 'CONFIRMED' | 'DISMISSED'
type Done = { id: string; version: number }

export function usePendingDecision() {
  const queryClient = useQueryClient()
  const { showToast, showUndo } = useToast()
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['records'] })

  const fail = (error: unknown) => {
    if (error instanceof ApiError && (error.code === 'VERSION_CONFLICT' || error.status === 404)) {
      refresh()
      showToast('다른 곳에서 먼저 바뀌어서 새로 불러왔어요')
      return
    }
    const { message, traceId } = toastForError(error)
    showToast(message, { traceId })
  }

  const undoAll = (done: Done[]) => async () => {
    try {
      await Promise.all(done.map((d) => pendingApi.setStatus(d.id, 'PENDING', d.version)))
    } catch (error) {
      fail(error)
    }
    refresh()
  }

  /** 성공하면 true. onSaved는 새로 받기 전에 부른다(목록에서 미리 빼기·포커스 예약) */
  const decide = async (record: Done, status: Decision, onSaved?: () => void) => {
    try {
      const saved = await pendingApi.setStatus(record.id, status, record.version)
      onSaved?.()
      showUndo({
        group: `pending-${status}`,
        message: (n) => (status === 'CONFIRMED' ? `${n}건을 했어요로 기록했어요` : `${n}건을 안 했어요로 표시했어요`),
        undo: undoAll([{ id: saved.id, version: saved.version }]),
      })
      refresh()
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }

  return { decide, undoAll, fail, refresh }
}
