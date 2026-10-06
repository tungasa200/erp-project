// SCR-HOME-01 홈 대시보드. ① 헤더·빠른 입력과 첫 실행 빈 상태(UX-04, P1-10),
// ② 요약 카드·④ 남은 업무·⑥ 다가오는 일정(P1-11, HomeDashboard). ③은 P2, ⑤⑦은 P3.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { HomeDashboard } from '../home/HomeDashboard'
import { EXAMPLES } from '../quickInput/examples'
import { QuickInput } from '../quickInput/QuickInput'
import { useQuickSave } from '../tasks/useQuickSave'
import styles from './HomePage.module.css'

interface HomeState {
  quickText?: string
  focusQuick?: boolean
}

function greeting(hour: number): string {
  if (hour < 12) return '좋은 아침이에요'
  if (hour < 18) return '좋은 오후예요'
  return '좋은 저녁이에요'
}

export function HomePage() {
  const { user } = useAuth()
  const location = useLocation()
  const [text, setText] = useState('')
  const [handledKey, setHandledKey] = useState<string | null>(null)
  const [now] = useState(() => new Date())
  const quickSave = useQuickSave()

  // 명령 팔레트·단축키 N으로 들어오면 입력창을 채우고(이동마다 한 번) 포커스한다.
  const state = location.state as HomeState | null
  if (state?.focusQuick && handledKey !== location.key) {
    setHandledKey(location.key)
    if (state.quickText !== undefined) setText(state.quickText)
  }
  useEffect(() => {
    if (state?.focusQuick) document.querySelector<HTMLInputElement>('[data-quick-input]')?.focus()
  }, [location.key, state?.focusQuick])

  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const dateLabel = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now)
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now))

  const fillExample = (example: string) => {
    setText(example)
    document.querySelector<HTMLInputElement>('[data-quick-input]')?.focus()
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.date}>{dateLabel}</p>
          <h1 className={styles.title}>
            {greeting(hour)}
            {user?.name ? `, ${user.name}님` : ''}
          </h1>
        </div>
        <div className={styles.quick}>
          <QuickInput value={text} onChange={setText} onSubmit={quickSave} label="빠른 기록" />
        </div>
      </header>

      <HomeDashboard
        empty={
          // 첫 실행(남은 업무 없음): ④ 대신 문법 예시
          <section className={styles.empty} aria-labelledby="home-empty-title">
            <h2 id="home-empty-title" className={styles.emptyTitle}>
              오늘 할 일을 한 줄로 적어 보세요
            </h2>
            <p className={styles.emptyText}>시간·@프로젝트·#태그·!우선순위·~마감을 같이 적으면 알아서 나눠 저장해요.</p>
            <div className={styles.examples}>
              {EXAMPLES.map((e) => (
                <button key={e} type="button" className={styles.example} onClick={() => fillExample(e)}>
                  {e}
                </button>
              ))}
            </div>
          </section>
        }
      />
    </div>
  )
}
