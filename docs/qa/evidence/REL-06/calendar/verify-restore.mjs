// REL-06 캘린더 끌기 뒤 일정이 시드 값과 같은지 확인(읽기만). WY-frontend2
import { Client } from '../client.mjs'
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const OBJS = ['주간 보고서', '고객 요청', 'API 명세', '로그인 화면', '결제 모듈', '대시보드', '데이터 이관', '배치 작업', '운영 매뉴얼', '견적서', '채용 공고', '신규 기능 기획', '성능 지표', '접근성 점검', '디자인 시안', '릴리스 노트']
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay()
const workdays = (from, to) => { const r = []; for (let d = from; d <= to; d = addDays(d, 1)) if (dow(d) >= 1 && dow(d) <= 5) r.push(d); return r }
const pad = n => String(n).padStart(2, '0')
const at = (d, min) => `${d}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00+09:00`
const pick = (r, a) => a[Math.floor(r() * a.length)]
const PEND_DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
const spec = new Map()
function gen(mode) {
  const rS = rng(mode === 'small' ? 12 : 202); const pre = mode === 'small' ? '[소량] ' : ''; const OPEN = [1]
  const day = (d, n, linkFirst) => { for (let j = 0; j < n; j++) {
    const allDay = j >= linkFirst && rS() < 0.15
    const title = pre + `${pick(rS, OBJS)} ${pick(rS, ['미팅', '작업', '리뷰', '통화', '워크숍', '집중 시간'])}`
    let s = null, e = null
    if (!allDay) { const m = 9 * 60 + 15 * Math.floor(rS() * 36); const len = pick(rS, [30, 60, 60, 90, 120]); s = at(d, m); e = at(d, Math.min(m + len, 23 * 60 + 45)) }
    if (j < linkFirst) pick(rS, OPEN); else if (!PEND_DAYS.includes(d) && !allDay && rS() < 0.4) pick(rS, OPEN)
    if (s) { const k = title + '|' + d; spec.set(k, [...(spec.get(k) ?? []), s + '~' + e]) }
  } }
  if (mode === 'small') day('2026-10-06', 8, 2)
  else for (const [f, t, total] of [['2026-09-01', '2026-09-30', 120], ['2026-10-01', '2026-10-31', 180], ['2026-11-01', '2026-11-30', 120]]) {
    const wd = workdays(f, t); const base = Math.floor(total / wd.length); let extra = total - base * wd.length
    for (const d of wd) { let n = base; if (d === '2026-10-14') { n += extra; extra = 0 } else if (f !== '2026-10-01' && extra > 0) { n++; extra-- } day(d, n, PEND_DAYS.includes(d) ? 6 : 0) }
  }
}
gen('small'); gen('full')
const c = new Client(); await c.login()
const oc = await c.req('GET', `/api/worklog/schedules?from=${encodeURIComponent('2026-10-01T00:00:00+09:00')}&to=${encodeURIComponent('2026-11-01T00:00:00+09:00')}`)
const kst = iso => { const x = new Date(Date.parse(iso) + 9 * 3600e3).toISOString(); return x.slice(0, 19) + '+09:00' }
let checked = 0, bad = [], unknown = 0
for (const o of oc.items) {
  if (o.allDay || o.recurring || o.recurrence) continue
  const s = kst(o.startAt), e = kst(o.endAt), k = o.title + '|' + s.slice(0, 10)
  const want = spec.get(k)
  if (!want) { unknown++; bad.push({ title: o.title, s, e, why: '그 날짜에 같은 제목 시드 없음' }); continue }
  checked++
  if (!want.includes(s + '~' + e)) bad.push({ title: o.title, s, e, want })
}
console.log(JSON.stringify({ items: oc.items.length, checked, unknown, mismatches: bad }, null, 1))
