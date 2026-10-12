// SCR-AUTH-01 랜딩(서비스 소개, P4-11, UX-08). 목업 AUTH-01(캔버스 v41).
// 로그인하지 않은 방문자의 첫 화면(/). 로그인 상태면 홈으로 보내는 것은 라우터가 맡는다.
import { Link } from 'react-router'
import styles from './landing.module.css'

const STEPS = [
  {
    title: '한 줄로 계획',
    text: '"14-16 견적서 작성 #영업"처럼 한 줄이면 업무와 일정이 함께 만들어져요.',
    tone: styles.stepPlan,
  },
  {
    title: '끝나면 확인 한 번',
    text: '계획한 시간이 지나면 "했나요?"만 물어요. 버튼 하나로 기록이 됩니다.',
    tone: styles.stepConfirm,
  },
  {
    title: '하루 마감은 1분',
    text: '확인한 기록을 훑고 내일 계획을 넘기면 끝나요. 통계로 한 주·한 달을 돌아봐요.',
    tone: styles.stepLog,
  },
]

const FEATURES = [
  { title: '한눈에 보는 통계', text: '프로젝트·업무별로 쓴 시간과 끝낸 일을 기간별로 봐요.', dark: true },
  { title: '손에 익은 캘린더 보기', text: '일·주·월·연 보기와 끌어 놓기로 하루를 배치해요.' },
  { title: '확인 없이는 기록하지 않아요', text: '자동으로 만든 기록은 당신이 확인해야 기록으로 남아요.' },
]

export function LandingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo} aria-hidden="true">
          w
        </span>
        <span className={styles.brandName}>worklog</span>
        <nav aria-label="계정" className={styles.headerNav}>
          <Link to="/login" className={styles.headerLogin}>
            로그인
          </Link>
          <Link to="/signup" className={styles.headerSignup}>
            무료로 시작하기
          </Link>
        </nav>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>개인 업무기록 · 일정 · 하루 마감</p>
            <h1 id="landing-title" className={styles.title}>
              따로 기록하지 않아도
              <br />
              하루가 기록됩니다
            </h1>
            <p className={styles.lead}>
              계획한 일정이 끝나면 확인 한 번. 그것만으로 오늘 한 일이 쌓여요. 퇴근 전 1분이면 하루 마감과 내일 계획까지
              끝나요.
            </p>
            <div className={styles.actions}>
              <Link to="/signup" className={styles.primary}>
                무료로 시작하기
              </Link>
              <Link to="/login" className={styles.secondary}>
                로그인
              </Link>
            </div>
          </div>

          {/* ③ 실제 화면 그림: 캘린더 블록 상태(확정·확인 대기·계획)와 그날 기록. 장식이라 읽지 않는다 */}
          <div className={styles.preview} aria-hidden="true">
            <div className={styles.previewSchedule}>
              <div className={styles.previewHeading}>오늘 일정</div>
              <div className={`${styles.block} ${styles.blockDone}`}>결제 API 설계 · 완료</div>
              <div className={`${styles.block} ${styles.blockPending}`}>고객사 미팅 · 했나요?</div>
              <div className={`${styles.block} ${styles.blockPlanned}`}>견적서 작성 · 예정</div>
            </div>
            <div className={styles.previewLog}>
              <div className={styles.previewHeading}>오늘 기록</div>
              <div className={styles.previewLines}>
                1. 데일리 스탠드업 참석
                <br />
                2. 결제 API 설계 — 엔드포인트 6개 확정 (70%)
              </div>
              <div className={styles.progress}>
                <div className={styles.progressFill} />
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="landing-steps">
          <h2 id="landing-steps" className={styles.sectionTitle}>
            하루가 기록이 되는 세 단계
          </h2>
          <ol className={styles.grid}>
            {STEPS.map((s, i) => (
              <li key={s.title} className={styles.card}>
                <span className={`${styles.stepNumber} ${s.tone}`} aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className={styles.cardTitle}>{s.title}</h3>
                <p className={styles.cardText}>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section} aria-label="기능 소개">
          <ul className={styles.grid}>
            {FEATURES.map((f) => (
              <li key={f.title} className={`${styles.card} ${f.dark ? styles.cardDark : ''}`}>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureText}>{f.text}</p>
              </li>
            ))}
          </ul>
          <div className={styles.closing}>
            <Link to="/signup" className={styles.closingCta}>
              오늘 기록부터 시작하기
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>© WY Worklog</span>
        <Link to="/terms" className={styles.footerLink}>
          이용약관
        </Link>
        <Link to="/privacy" className={`${styles.footerLink} ${styles.footerStrong}`}>
          개인정보 처리방침
        </Link>
      </footer>
    </div>
  )
}
