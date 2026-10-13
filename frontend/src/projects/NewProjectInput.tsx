// 프로젝트 만들기 인라인 입력(D-226, 사용자 결정 카드 20261013-1010). 사이드바 [+]·휴대폰 업무 필터 시트의 '+ 새 프로젝트'가 연다.
// Enter로 만들고 Esc로 그만둔다. 비운 채 칸을 떠나도 그만둔다. 색은 아직 안 쓴 색(설정 화면 기본값과 같음).
// 같은 이름·50자 초과는 칸 아래에 알리고 칸을 그대로 둔다(설정 SCR-SET-08과 같은 문구).
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useToast } from '../components/useToast'
import { PROJECTS_QUERY_KEY, projectApi, useProjects, type Project } from './api'
import styles from './NewProjectInput.module.css'
import { nextColor } from './palette'

export function NewProjectInput({ onDone }: { onDone: (created: Project | null) => void }) {
  const id = useId()
  const queryClient = useQueryClient()
  const projects = useProjects()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const submit = async () => {
    if (saving) return
    const trimmed = name.trim()
    if (!trimmed) return setError('프로젝트 이름을 적어 주세요')
    setSaving(true)
    try {
      const created = await projectApi.create({ name: trimmed, color: nextColor(projects.data ?? []) })
      queryClient.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (list) => [...(list ?? []), created])
      showToast(`‘${created.name}’ 프로젝트를 만들었어요`)
      onDone(created)
    } catch (err) {
      setSaving(false)
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') {
        setError('같은 이름의 프로젝트가 있어요')
        void projects.refetch()
      } else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') setError('이름은 50자까지 쓸 수 있어요')
      else {
        const { message, traceId } = toastForError(err)
        showToast(message, { traceId })
      }
    }
  }

  return (
    <div className={styles.wrap}>
      <input
        ref={input}
        type="text"
        className={styles.input}
        aria-label="새 프로젝트 이름"
        placeholder="프로젝트 이름, Enter로 만들기"
        maxLength={50}
        enterKeyHint="done"
        value={name}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-busy={saving}
        onChange={(e) => {
          setName(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          } else if (e.key === 'Escape') {
            // 시트·메뉴의 Esc까지 가지 않게 여기서 멈춘다
            e.stopPropagation()
            onDone(null)
          }
        }}
        onBlur={() => {
          if (!name.trim() && !saving) onDone(null)
        }}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
