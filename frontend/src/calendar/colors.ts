// 일정 블록 색. 프로젝트 색(2.2 팔레트)을 쓰고, 프로젝트가 없으면 키 컬러 계열(CSS 기본값)이다.
import { useMemo, type CSSProperties } from 'react'
import { useProjects } from '../projects/api'
import type { Occurrence } from './api'

export interface BlockColor {
  base: string
  tint: string
  ink: string
}

export function colorVars(color: BlockColor | null): CSSProperties {
  if (!color) return {}
  return { '--block-base': color.base, '--block-tint': color.tint, '--block-ink': color.ink } as CSSProperties
}

/** 회차의 프로젝트(연결 업무의 프로젝트, 읽기 전용) */
export function projectIdOf(o: Occurrence): string | null {
  return o.projectId ?? null
}

export function useProjectColors() {
  const projects = useProjects()
  return useMemo(() => {
    const byId = new Map<string, BlockColor>()
    for (const p of projects.data ?? []) {
      const key = p.color.toLowerCase()
      byId.set(p.id, {
        base: `var(--project-${key})`,
        tint: `var(--project-${key}-tint)`,
        ink: `var(--project-${key}-ink)`,
      })
    }
    return (o: Occurrence): BlockColor | null => {
      const id = projectIdOf(o)
      return (id && byId.get(id)) || null
    }
  }, [projects.data])
}
