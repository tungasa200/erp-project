// 아직 만들지 않은 메뉴의 자리. 각 화면 작업 때 교체한다.
import styles from './placeholder.module.css'

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className={styles.wrap}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.text}>준비 중인 화면이에요.</p>
    </section>
  )
}
