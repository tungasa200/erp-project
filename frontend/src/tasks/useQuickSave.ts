// 빠른 입력 Enter 저장 핸들러 (SCR-COM-02). QuickInput의 onSubmit에 그대로 넘긴다.
// 성공하면 되돌리기 토스트, 실패하면 오류 토스트를 띄우고 거부해서 입력이 남게 한다.
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toastForError } from '../api/errorToast'
import { useAuth } from '../auth/useAuth'
import { OCCURRENCES_QUERY_KEY } from '../calendar/api'
import { useToast } from '../components/useToast'
import { PROJECTS_QUERY_KEY, projectApi, TAGS_QUERY_KEY, type Project } from '../projects/api'
import type { QuickDraft } from '../quickInput/parse'
import { refreshTasks } from './api'
import { NeedsProjectError, saveQuickDraft, undoQuickSave } from './quickSave'

export function useQuickSave(): (draft: QuickDraft) => Promise<void> {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const { showToast, showUndo } = useToast()

  return useCallback(
    async (draft: QuickDraft) => {
      const refresh = () => {
        refreshTasks(queryClient)
        void queryClient.invalidateQueries({ queryKey: OCCURRENCES_QUERY_KEY })
        if (draft.tags?.length) void queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY })
      }
      try {
        // 프로젝트 이름을 확인하려면 목록이 필요하다. 빠른 입력 칩이 이미 받아 두었으면 그대로 쓴다.
        const projects = draft.project
          ? await queryClient.fetchQuery({
              queryKey: PROJECTS_QUERY_KEY,
              queryFn: async () => (await projectApi.list()).items,
              staleTime: 30_000,
            })
          : ([] as Project[])
        const result = await saveQuickDraft(draft, { projects, timeZone })
        refresh()
        showUndo({
          group: 'quick-add',
          message: (n) => (result.schedule ? `업무와 일정 ${n}개를 추가했어요` : `업무 ${n}개를 추가했어요`),
          undo: async () => {
            await undoQuickSave(result)
            refresh()
          },
        })
      } catch (error) {
        if (error instanceof NeedsProjectError) {
          showToast(`"${error.projectName}" 프로젝트가 없어요. 아래 칩을 눌러 먼저 만들어 주세요`)
        } else {
          const { message, traceId } = toastForError(error)
          showToast(message, { traceId })
        }
        throw error
      }
    },
    [queryClient, timeZone, showToast, showUndo],
  )
}
