// SCR-AUTH-06 개인정보 처리방침 · SCR-AUTH-07 이용약관의 공통 틀(목업 AUTH-06·07, 캔버스 v41).
// 로그인 없이·점검 중에도 보이는 공개 화면. 본문은 legalText.ts(원문 docs/…초안.md)에서 온다.
import { Fragment } from 'react'
import { Link } from 'react-router'
import styles from './legal.module.css'

export type LegalBlock =
  { p: string } | { ol: string[] } | { ul: string[] } | { table: { head: string[]; rows: string[][] } }

export interface LegalDoc {
  intro: LegalBlock[]
  sections: { title: string; blocks: LegalBlock[] }[]
}

const BLANK = '[확정 전]'

/** 확정되지 않은 자리를 노란 표시로 */
function Text({ children }: { children: string }) {
  const parts = children.split(BLANK)
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <mark className={styles.blank}>{BLANK}</mark>}
          {part}
        </Fragment>
      ))}
    </>
  )
}

function Block({ block, label }: { block: LegalBlock; label: string }) {
  if ('p' in block)
    return (
      <p className={styles.text}>
        <Text>{block.p}</Text>
      </p>
    )
  if ('ol' in block || 'ul' in block) {
    const items = 'ol' in block ? block.ol : block.ul
    const List = 'ol' in block ? 'ol' : 'ul'
    return (
      <List className={styles.list}>
        {items.map((item, i) => (
          <li key={i}>
            <Text>{item}</Text>
          </li>
        ))}
      </List>
    )
  }
  return (
    // 좁은 화면에서는 표만 상자 안에서 가로로 민다. 키보드로도 밀 수 있게 포커스를 받는다
    <div className={styles.tableBox} role="region" aria-label={`${label} 표`} tabIndex={0}>
      <table className={styles.table}>
        <thead>
          <tr>
            {block.table.head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i}>
                  <Text>{cell}</Text>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LegalPage({ title, doc }: { title: string; doc: LegalDoc }) {
  const effective = doc.sections
    .at(-1)
    ?.blocks.flatMap((b) => ('ul' in b ? b.ul : []))
    .find((t) => t.startsWith('시행일'))
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            w
          </span>
          worklog<span className="visually-hidden"> 처음 화면으로</span>
        </Link>
      </header>
      <main className={styles.article}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.meta}>
          초안 · <Text>{effective ?? `시행일: ${BLANK}`}</Text>
        </p>
        {doc.intro.map((b, i) => (
          <Block key={i} block={b} label={title} />
        ))}
        <nav aria-label="목차" className={styles.toc}>
          <ol>
            {doc.sections.map((s, i) => (
              <li key={s.title}>
                <a href={`#legal-${i + 1}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        {doc.sections.map((s, i) => (
          <section key={s.title} id={`legal-${i + 1}`} aria-labelledby={`legal-${i + 1}-h`} className={styles.section}>
            <h2 id={`legal-${i + 1}-h`} className={styles.sectionTitle}>
              {s.title}
            </h2>
            {s.blocks.map((b, j) => (
              <Block key={j} block={b} label={s.title} />
            ))}
          </section>
        ))}
      </main>
    </div>
  )
}
