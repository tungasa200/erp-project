// SCR-HOME-01 홈 대시보드. ① 헤더·빠른 입력(머리 전체 폭의 주인공, X-02 A·UX-HOME-01)과 첫 실행 빈 상태(UX-04, P1-10),
// ② 요약 카드·④ 남은 업무·⑥ 다가오는 일정(P1-11, HomeDashboard). ③은 P2, ⑤⑦은 P3.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { useOnline } from '../components/useOnline'
import { useAfterClose } from '../home/closeBandState'
import { HomeDashboard } from '../home/HomeDashboard'
import { useNow } from '../home/useNow'
import { NotificationBell } from '../notifications/NotificationBell'
import { InstallGuide } from '../pwa/InstallGuide'
import { EXAMPLES } from '../quickInput/examples'
import { QuickInput } from '../quickInput/QuickInput'
import { useQuickSave } from '../tasks/useQuickSave'
import styles from './HomePage.module.css'

interface HomeState {
  quickText?: string
  focusQuick?: boolean
}

/** 사용자 시간대의 시각으로 인사. 새벽(0~4시)에 "아침"이라 하지 않는다(HOME-08) */
function greeting(hour: number): string {
  if (hour < 5) return '늦은 시간이에요'
  if (hour < 12) return '좋은 아침이에요'
  if (hour < 18) return '좋은 오후예요'
  if (hour < 22) return '좋은 저녁이에요'
  return '늦은 시간이에요'
}

export function HomePage() {
  const { user } = useAuth()
  const location = useLocation()
  const [text, setText] = useState('')
  const [handledKey, setHandledKey] = useState<string | null>(null)
  // 띄워 둔 채 자정을 넘겨도 머리 날짜·인사말이 아래 카드와 같은 날을 보이게 1분마다 다시 그린다(UX-HOME-09)
  const now = useNow()
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

  const online = useOnline()
  // 입력 안내 시제는 마감 띠와 같은 기준으로 나눈다(UX-HOME-12): 마감 시각 전에는 할 일, 뒤에는 한 일
  const afterClose = useAfterClose(now, timeZone)

  const fillExample = (example: string) => {
    setText(example)
    document.querySelector<HTMLInputElement>('[data-quick-input]')?.focus()
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <div>
            <p className={styles.date}>{dateLabel}</p>
            <h1 className={styles.title}>
              {greeting(hour)}
              {user?.name ? `, ${user.name}님` : ''}
            </h1>
          </div>
          {/* SCR-COM-05 ② 종: 모바일은 홈 머리 오른쪽(데스크톱·태블릿은 사이드바) */}
          <span className={styles.bell}>
            <NotificationBell />
          </span>
        </div>
        {/* 끊긴 동안에는 기록을 막는다(SCR-SYS-02 ③) */}
        <fieldset className={styles.quick} disabled={!online}>
          {/* 끊긴 이유를 입력칸에서도 알린다(시트와 같은 문구, UX-COM-13) */}
          <QuickInput
            value={text}
            onChange={setText}
            onSubmit={quickSave}
            label="빠른 기록"
            placeholder={
              !online
                ? '연결되면 입력할 수 있어요'
                : afterClose
                  ? '무엇을 했는지 한 줄로 적어 보세요'
                  : '무엇을 할지 한 줄로 적어 보세요'
            }
          />
        </fieldset>
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
                <button
                  key={e}
                  type="button"
                  className={styles.example}
                  disabled={!online}
                  onClick={() => fillExample(e)}
                >
                  {e}
                </button>
              ))}
            </div>
          </section>
        }
      />
      {/* SCR-MOB-02 설치 안내: 모바일 홈에서만(넓은 화면은 CSS로 숨김) */}
      <InstallGuide />
    </div>
  )
}
