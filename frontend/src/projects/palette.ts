// 프로젝트 전용 팔레트 8색 (SCR-SET-08 ②). 실제 색 값은 tokens.css의 --project-p1… 토큰에 있다.
import type { Project, ProjectColor } from './api'

export const PROJECT_COLORS: { key: ProjectColor; name: string }[] = [
  { key: 'P1', name: '파랑' },
  { key: 'P2', name: '주황' },
  { key: 'P3', name: '청록' },
  { key: 'P4', name: '보라' },
  { key: 'P5', name: '빨강' },
  { key: 'P6', name: '올리브' },
  { key: 'P7', name: '분홍' },
  { key: 'P8', name: '회색' },
]

export const projectColor = (key: ProjectColor) => {
  const n = key.slice(1)
  return { base: `var(--project-p${n})`, tint: `var(--project-p${n}-tint)`, ink: `var(--project-p${n}-ink)` }
}

/** 새 프로젝트의 기본 색: 보관하지 않은 프로젝트가 아직 안 쓴 색 중 첫 번째. 모두 썼으면 쓴 횟수가 가장 적은 색 */
export function nextColor(projects: Project[]): ProjectColor {
  const counts = new Map(PROJECT_COLORS.map((c) => [c.key, 0]))
  for (const p of projects) if (!p.archived) counts.set(p.color, (counts.get(p.color) ?? 0) + 1)
  let best = PROJECT_COLORS[0].key
  for (const { key } of PROJECT_COLORS) if ((counts.get(key) ?? 0) < (counts.get(best) ?? 0)) best = key
  return best
}
