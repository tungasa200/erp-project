// SCR-AUTH-06 개인정보 처리방침 · SCR-AUTH-07 이용약관의 공통 틀(목업 AUTH-06·07, 캔버스 v41).
// 로그인 없이·점검 중에도 보이는 공개 화면. 본문은 legalText.ts(원문 docs/…초안.md)에서 온다.
import { Fragment } from 'react'
import { Link } from 'react-router'
import styles from './legal.module.css'
import { CONTACT_EMAIL } from './legalText'

export type LegalBlock =
  { p: string } | { ol: string[] } | { ul: string[] } | { table: { head: string[]; rows: string[][] } }

export interface LegalDoc {
  intro: LegalBlock[]
  sections: { title: string; blocks: LegalBlock[] }[]
}

const BLANK = '[확정 전]'

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 문구 속 웹 주소(https://…)와 운영자 문의 메일(빌드 환경변수)을 찾는다
const LINK_RE = new RegExp(`(https://[^\\s]+${CONTACT_EMAIL ? `|${escape(CONTACT_EMAIL)}` : ''})`)

/** 웹 주소는 새 탭으로 여는 링크, 문의 메일은 메일 앱을 여는 링크로 */
function Linked({ children }: { children: string }) {
  return (
    <>
      {children.split(LINK_RE).map((part, i) =>
        i % 2 === 0 ? (
          part
        ) : part === CONTACT_EMAIL ? (
          <a key={i} href={`mailto:${part}`} className={styles.link}>
            {part}
          </a>
        ) : (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={styles.link}>
            {part}
            <span className="visually-hidden"> (새 탭에서 열림)</span>
          </a>
        ),
      )}
    </>
  )
}

/** 확정되지 않은 자리를 노란 표시로 */
function Text({ children }: { children: string }) {
  const parts = children.split(BLANK)
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <mark className={styles.blank}>{BLANK}</mark>}
          <Linked>{part}</Linked>
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

/** 문서 안 이동(목차 ↔ 장): 화면 이동은 브라우저에 맡기고 읽기 위치(포커스)를 도착한 제목으로 옮긴다(UX-AUTH-84) */
function moveFocus(id: string) {
  // 브라우저의 해시 이동이 포커스를 body로 되돌리므로 이동이 끝난 다음 프레임에 옮긴다
  requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true }))
}

export function LegalPage({ title, doc }: { title: string; doc: LegalDoc }) {
  // 머리에는 부칙의 가장 나중 시행일(개정이 있으면 개정 시행일)만 보인다
  const effective = doc.sections
    .at(-1)
    ?.blocks.flatMap((b) => ('ul' in b ? b.ul : []))
    .map((t) => /시행일: ([^/]+)/.exec(t)?.[1].trim())
    .filter(Boolean)
    .at(-1)
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
          <Text>{`시행일: ${effective ?? BLANK}`}</Text>
        </p>
        {doc.intro.map((b, i) => (
          <Block key={i} block={b} label={title} />
        ))}
        <nav id="legal-toc" aria-label="목차" className={styles.toc} tabIndex={-1}>
          <ol>
            {doc.sections.map((s, i) => (
              <li key={s.title}>
                <a href={`#legal-${i + 1}`} onClick={() => moveFocus(`legal-${i + 1}-h`)}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {doc.sections.map((s, i) => (
          <section key={s.title} id={`legal-${i + 1}`} aria-labelledby={`legal-${i + 1}-h`} className={styles.section}>
            <h2 id={`legal-${i + 1}-h`} className={styles.sectionTitle} tabIndex={-1}>
              {s.title}
            </h2>
            {s.blocks.map((b, j) => (
              <Block key={j} block={b} label={s.title} />
            ))}
            <p className={styles.back}>
              <a href="#legal-toc" className={styles.link} onClick={() => moveFocus('legal-toc')}>
                목차로 돌아가기
              </a>
            </p>
          </section>
        ))}
      </main>
    </div>
  )
}
