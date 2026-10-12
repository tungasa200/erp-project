import styles from './logs.module.css'

const LEGEND = [
  ['CONFIRMED', '확정'],
  ['DRAFT', '초안'],
  ['NOT_WRITTEN', '미작성'],
  ['NO_RECORDS', '기록 없음'],
] as const

/** 좁은 화면에서 일지 칸이 점·고리·마름모·막대만 보일 때 아래에 두는 범례. 넓은 화면은 칸에 글자가 있어 CSS로 숨긴다 */
export function LogStatusLegend() {
  return (
    <ul className={styles.legend}>
      {LEGEND.map(([status, text]) => (
        <li key={status} className={styles[`cell${status}`]}>
          <span className={styles.cellStatus} aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  )
}
