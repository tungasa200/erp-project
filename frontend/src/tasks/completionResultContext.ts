// 완료 결과 입력(SCR-TASK-03, REC-02)을 여는 통로. 팝오버는 앱 셸의 CompletionResultHost가 그린다.
import { createContext, useContext } from 'react'
import type { Task } from './api'

export interface CompletionResultHandle {
  /** 완료를 되돌릴 때: 팝오버가 열려 있으면 저장하지 않고 닫고, 이미 기록을 남겼으면 그 기록을 보관한다 */
  revoke: () => Promise<void>
}

/** 업무를 완료한 직후 부른다. returnFocus는 팝오버를 닫을 때(포커스가 팝오버에 있었으면) 부른다 */
export type OpenCompletionResult = (task: Task, returnFocus: () => void) => CompletionResultHandle

export const CompletionResultContext = createContext<OpenCompletionResult | null>(null)

/** 앱 셸 밖(호스트 없음)이면 null — 결과 입력 없이 완료만 한다 */
export function useCompletionResult(): OpenCompletionResult | null {
  return useContext(CompletionResultContext)
}

/** 포커스가 결과 팝오버 안에 있는지. 완료한 행이 빠질 때 포커스를 옮기는 쪽이 팝오버의 포커스를 뺏지 않게 본다 */
export function isCompletionResultFocused(): boolean {
  return Boolean(document.activeElement?.closest('[data-completion-result]'))
}
