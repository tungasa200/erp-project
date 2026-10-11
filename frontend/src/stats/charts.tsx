// 통계 차트 (SCR-STAT-01 ③④⑤). 라이브러리 없이 SVG로 그린다(P4 결정).
// 그림은 aria-hidden으로 두고, 같은 수치를 화면 읽기 프로그램용 표(③)·글자(④⑤)로 함께 준다.
import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { projectColor } from '../projects/palette'
import type { Project } from '../projects/api'
import type { StatsProject } from './api'
import { projectName, type Bucket } from './buckets'
import { hoursText, percent } from './format'
import styles from './stats.module.css'

/** 그릴 폭(px). 폭이 바뀌면 다시 그려 글자가 늘어나거나 줄지 않게 한다. ResizeObserver가 없으면(jsdom) 기본 폭 */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      if (w > 0) setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

const CHART_HEIGHT = 220
const LABEL_SPACE = 26
const VALUE_SPACE = 22
const BAR_MAX_WIDTH = 56
const MIN_LABEL_SLOT = 36

export function WeeklyChart({ buckets, title }: { buckets: Bucket[]; title: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(600)
  const max = Math.max(1, ...buckets.map((b) => b.value))
  const slot = width / Math.max(1, buckets.length)
  const barWidth = Math.max(4, Math.min(BAR_MAX_WIDTH, slot * 0.62))
  // 칸이 좁으면(모바일에 주가 많을 때) 막대 이름을 하나 걸러 보인다. 수치는 아래 표에 모두 있다
  const labelEvery = slot < MIN_LABEL_SLOT ? 2 : 1
  const base = CHART_HEIGHT - LABEL_SPACE
  const usable = base - VALUE_SPACE
  return (
    <div ref={ref} className={styles.chart}>
      <svg
        width={width}
        height={CHART_HEIGHT}
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        aria-hidden="true"
        focusable="false"
      >
        <line x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} className={styles.axis} />
        {buckets.map((b, i) => {
          const h = b.value ? Math.max(3, Math.round((b.value / max) * usable)) : 0
          const cx = slot * i + slot / 2
          return (
            <g key={b.key}>
              {h > 0 && (
                <rect
                  x={cx - barWidth / 2}
                  y={base - h}
                  width={barWidth}
                  height={h}
                  rx={Math.min(8, barWidth / 3)}
                  className={styles.bar}
                />
              )}
              <text x={cx} y={base - h - 6} textAnchor="middle" className={styles.barValue}>
                {b.value}
              </text>
              {i % labelEvery === 0 && (
                <text x={cx} y={CHART_HEIGHT - 6} textAnchor="middle" className={styles.barLabel}>
                  {b.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">기간</th>
            <th scope="col">완료 업무</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.long}</th>
              <td>{b.value}건</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fillOf(projects: Project[], id: string | null): string {
  const project = id ? projects.find((p) => p.id === id) : undefined
  return project ? projectColor(project.color).base : 'var(--project-p8)'
}

/** 프로젝트별 완료(④). 줄을 누르면 그 프로젝트의 완료 업무 목록으로 간다(주요 동작) */
export function ProjectBars({ rows, projects }: { rows: StatsProject[]; projects: Project[] }) {
  const max = Math.max(1, ...rows.map((r) => r.completedTaskCount))
  return (
    <ul className={styles.projectList}>
      {rows.map((r) => {
        const name = projectName(projects, r.projectId)
        const body = (
          <>
            <span className={styles.projectHead}>
              <span className={styles.projectName}>{name}</span>
              <span className={styles.projectCount}>{r.completedTaskCount.toLocaleString('ko-KR')}건</span>
            </span>
            <svg className={styles.track} width="100%" height="14" aria-hidden="true" focusable="false">
              <rect width="100%" height="14" rx="7" className={styles.trackBg} />
              <rect
                width={`${(r.completedTaskCount / max) * 100}%`}
                height="14"
                rx="7"
                style={{ fill: fillOf(projects, r.projectId) }}
              />
            </svg>
          </>
        )
        return (
          <li key={r.projectId ?? 'none'}>
            {/* 프로젝트 없는 업무는 목록에서 거를 조건이 없어 링크로 만들지 않는다 */}
            {r.projectId ? (
              <Link to={`/tasks?status=DONE&project=${r.projectId}`} className={styles.projectRow}>
                {body}
              </Link>
            ) : (
              <div className={styles.projectRow}>{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export interface ShareRow {
  projectId: string | null
  minutes: number
}

/** 소요시간 비중(⑤). 한 줄 띠 + 범례(글자로 같은 수치) */
export function TimeShare({ rows, projects }: { rows: ShareRow[]; projects: Project[] }) {
  const total = rows.reduce((sum, r) => sum + r.minutes, 0)
  const widths = rows.map((r) => (total ? (r.minutes / total) * 100 : 0))
  const starts = widths.map((_, i) => widths.slice(0, i).reduce((sum, w) => sum + w, 0))
  return (
    <>
      <svg className={styles.shareBar} width="100%" height="28" aria-hidden="true" focusable="false">
        {rows.map((r, i) => (
          <rect
            key={r.projectId ?? 'none'}
            x={`${starts[i]}%`}
            width={`${widths[i]}%`}
            height="28"
            style={{ fill: fillOf(projects, r.projectId) }}
          />
        ))}
      </svg>
      <ul className={styles.legend}>
        {rows.map((r) => (
          <li key={r.projectId ?? 'none'}>
            <span className={styles.swatch} style={{ background: fillOf(projects, r.projectId) }} aria-hidden="true" />
            {projectName(projects, r.projectId)} {hoursText(r.minutes)} ({percent(r.minutes, total)}%)
          </li>
        ))}
      </ul>
    </>
  )
}
