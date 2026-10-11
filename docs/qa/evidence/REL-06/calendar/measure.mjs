// REL-06 캘린더 측정(WY-frontend2). 운영 https://wy-worklog.com, 시험 계정 값은 ../.perf-account.env에서만 읽고 출력하지 않는다.
// 옮긴 일정은 같은 거리만큼 되돌려 놓는다(되돌림 결과를 기록).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire('C:/projects/erp-project/frontend/package.json')
const { chromium } = require('playwright')

const BASE = 'https://wy-worklog.com'
const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1')
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(HERE, '..', '.perf-account.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const RUNS = 3
const out = { startedAt: new Date().toISOString(), runs: [], drags: [], notes: [] }
const log = (...a) => console.log(...a)

// 긴 작업·프레임 기록(문서마다 먼저 심는다)
const INIT = () => {
  window.__lt = []
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push({ s: e.startTime, d: e.duration }))).observe({
      type: 'longtask',
      buffered: true,
    })
  } catch {}
  window.__frames = null
  window.__startFrames = () => {
    window.__frames = []
    let last = performance.now()
    const tick = (t) => {
      if (!window.__frames) return
      window.__frames.push(t - last)
      last = t
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  window.__stopFrames = () => {
    const f = window.__frames || []
    window.__frames = null
    return f
  }
}

const frameStats = (f) => {
  const s = [...f].sort((a, b) => a - b)
  const p = (q) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0)
  return {
    frames: f.length,
    p50: +p(0.5).toFixed(1),
    p95: +p(0.95).toFixed(1),
    max: +(s.at(-1) ?? 0).toFixed(1),
    over50: f.filter((x) => x > 50).length,
    over100: f.filter((x) => x > 100).length,
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`)
  await page.locator('#login-email').fill(env.PERF_EMAIL)
  await page.locator('#login-password').fill(env.PERF_PASSWORD)
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.locator('button[type=submit]').click()])
}

// 첫 렌더링: 문서 시작부터 일정이 그려지고(선택자 n개 이상) 두 프레임 동안 개수가 안 바뀐 때까지
async function firstRender(page, url, sel, label, cpu) {
  await page.goto(url, { waitUntil: 'commit' })
  const t = await page.waitForFunction(
    (sel) =>
      new Promise((res) => {
        const check = (prev, stable) =>
          requestAnimationFrame(() => {
            const n = document.querySelectorAll(sel).length
            if (n > 0 && n === prev) return stable >= 2 ? res({ t: performance.now(), n }) : check(n, stable + 1)
            check(n, 0)
          })
        check(-1, 0)
      }),
    sel,
    { timeout: 60000 },
  )
  const v = await t.jsonValue()
  const extra = await page.evaluate(() => {
    const api = performance
      .getEntriesByType('resource')
      .filter((e) => e.name.includes('/api/'))
      .map((e) => ({ url: e.name.replace(location.origin, '').replace(/\?.*/, ''), ms: Math.round(e.duration) }))
    const nav = performance.getEntriesByType('navigation')[0]
    return { lt: window.__lt, api, domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0) }
  })
  const lt = extra.lt.filter((e) => e.s <= v.t)
  const r = {
    label,
    cpu,
    renderMs: Math.round(v.t),
    items: v.n,
    longTasks: lt.length,
    longTaskMaxMs: Math.round(Math.max(0, ...lt.map((e) => e.d))),
    longTaskTotalMs: Math.round(lt.reduce((a, e) => a + e.d, 0)),
    domContentLoaded: extra.domContentLoaded,
    api: extra.api,
  }
  out.runs.push(r)
  log(JSON.stringify({ ...r, api: undefined }))
  return r
}

// 보기 전환: 키(M/W)를 누른 때부터 새 보기 일정이 그려질 때까지
async function viewSwitch(page, key, sel, label, cpu, min = 1) {
  await page.evaluate(() => (window.__lt = []))
  const t0 = await page.evaluate(() => performance.now())
  await page.keyboard.press(key)
  const v = await (
    await page.waitForFunction(
      ([sel, min]) =>
        new Promise((res) => {
          const check = (prev, stable) =>
            requestAnimationFrame(() => {
              const n = document.querySelectorAll(sel).length
              if (n >= min && n === prev) return stable >= 2 ? res({ t: performance.now(), n }) : check(n, stable + 1)
              check(n, 0)
            })
          check(-1, 0)
        }),
      [sel, min],
      { timeout: 60000 },
    )
  ).jsonValue()
  const lt = await page.evaluate(() => window.__lt)
  const r = {
    label,
    cpu,
    renderMs: Math.round(v.t - t0),
    items: v.n,
    longTasks: lt.length,
    longTaskMaxMs: Math.round(Math.max(0, ...lt.map((e) => e.d))),
  }
  out.runs.push(r)
  log(JSON.stringify(r))
}

const isMove = (r) => /\/api\/.*schedule/i.test(r.url()) && ['PATCH', 'PUT', 'POST'].includes(r.request().method())

// 마우스 끌기: 끄는 동안 프레임, 놓은 뒤 저장 응답까지, 그리고 같은 거리로 되돌리기
async function mouseDrag(page, sel, dx, dy, label, cpu) {
  const pick = await page.evaluate(
    ({ sel, dx, dy }) => {
      const vw = innerWidth
      const vh = innerHeight
      for (const el of document.querySelectorAll(sel)) {
        if (/반복/.test(el.getAttribute('aria-label') || '')) continue
        const r = el.getBoundingClientRect()
        if (r.height < 20 || r.width < 20) continue
        const x = r.left + r.width / 2
        const y = r.top + Math.min(10, r.height / 2)
        if (x + dx < 0 || x + dx > vw - 10 || y + dy < 0 || y + dy > vh - 10 || y < 0 || y > vh) continue
        return { x, y, id: el.dataset.focusId }
      }
      return null
    },
    { sel, dx, dy },
  )
  if (!pick) {
    out.notes.push(`${label}: 끌 수 있는 일정을 화면 안에서 못 찾음`)
    return
  }
  const once = async (from, ddx, ddy, phase) => {
    await page.evaluate(() => {
      window.__lt = []
      window.__startFrames()
    })
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    const steps = 20
    for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (ddx * i) / steps, from.y + (ddy * i) / steps)
    const t0 = Date.now()
    const resp = page.waitForResponse(isMove, { timeout: 30000 }).catch(() => null)
    await page.mouse.up()
    const res = await resp
    const saveMs = Date.now() - t0
    await page.waitForTimeout(400)
    const frames = await page.evaluate(() => window.__stopFrames())
    const lt = await page.evaluate(() => window.__lt)
    const r = {
      label: `${label} ${phase}`,
      cpu,
      saveStatus: res?.status() ?? null,
      saveMs: res ? saveMs : null,
      ...frameStats(frames),
      longTasks: lt.length,
      longTaskMaxMs: Math.round(Math.max(0, ...lt.map((e) => e.d))),
    }
    out.drags.push(r)
    log(JSON.stringify(r))
    return res
  }
  const res1 = await once(pick, dx, dy, '옮기기')
  if (!res1) return
  // 옮긴 자리에서 같은 일정을 다시 찾아 되돌린다
  await page.waitForTimeout(800)
  const back = await page.evaluate((id) => {
    const el = [...document.querySelectorAll('[data-focus-id]')].find((e) => e.dataset.focusId === id)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + Math.min(10, r.height / 2) }
  }, pick.id)
  if (!back) {
    out.notes.push(`${label}: 되돌릴 일정을 못 찾음(focusId ${pick.id}) — 수동 확인 필요`)
    return
  }
  const res2 = await once(back, -dx, -dy, '되돌리기')
  out.notes.push(`${label}: 되돌리기 ${res2 ? `응답 ${res2.status()}` : '응답 없음 — 수동 확인 필요'}`)
}

async function setCpu(page, rate) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  return cdp
}

const browser = await chromium.launch({ headless: true })
try {
  // ── 데스크톱 1440×900
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  await ctx.addInitScript(INIT)
  const page = await ctx.newPage()
  await login(page)
  if (process.argv[2] === 'switch') {
    for (const cpu of [1, 4]) {
      await setCpu(page, cpu)
      for (let i = 0; i < RUNS; i++) {
        await firstRender(page, `${BASE}/calendar/week/2026-10-14`, '[data-segment]', '주 보기 10-14 첫 렌더링', cpu)
        await viewSwitch(page, 'm', '[data-chip]', '주→월 전환(전부 그림)', cpu, 63)
        await viewSwitch(page, 'w', '[data-segment]', '월→주 전환(10-01 주, 전부 그림)', cpu, 40)
      }
    }
    throw new Error('switch-only 끝')
  }
  for (const cpu of [1, 4]) {
    await setCpu(page, cpu)
    for (let i = 0; i < RUNS; i++) {
      await firstRender(page, `${BASE}/calendar/month/2026-10`, '[data-chip]', '월 보기 2026-10 첫 렌더링', cpu)
      await firstRender(page, `${BASE}/calendar/week/2026-10-14`, '[data-segment]', '주 보기 10-14 첫 렌더링', cpu)
      await viewSwitch(page, 'm', '[data-chip]', '주→월 전환', cpu)
      await viewSwitch(page, 'w', '[data-segment]', '월→주 전환', cpu)
    }
    // 끌기(한 번씩 옮기고 되돌림)
    await firstRender(page, `${BASE}/calendar/week/2026-10-14`, '[data-segment]', '주 보기(끌기 전)', cpu)
    await mouseDrag(page, '[data-segment]', 0, 96, '주 보기 일정 끌기(아래로 96px)', cpu)
    await firstRender(page, `${BASE}/calendar/month/2026-10`, '[data-chip]', '월 보기(끌기 전)', cpu)
    const cell = await page.evaluate(() => {
      const c = document.querySelector('[data-chip]')?.closest('[role=gridcell], div')
      return c ? c.getBoundingClientRect().width : 150
    })
    await mouseDrag(page, '[data-chip]', Math.round(cell), 0, `월 보기 일정 끌기(오른쪽 한 칸 ${Math.round(cell)}px)`, cpu)
  }
  await setCpu(page, 1)
  const state = await ctx.storageState()
  await ctx.close()

  // ── 360px 터치(모바일: 주·월은 훑어보기 전용 D-77, 끌기는 일 보기 길게 누르기)
  const mctx = await browser.newContext({
    viewport: { width: 360, height: 780 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    storageState: state,
  })
  await mctx.addInitScript(INIT)
  const m = await mctx.newPage()
  for (const cpu of [1, 4]) {
    const cdp = await setCpu(m, cpu)
    for (let i = 0; i < RUNS; i++) {
      await firstRender(m, `${BASE}/calendar/month/2026-10`, '[data-overview], [data-chip]', '360 월 보기 첫 렌더링', cpu)
      await firstRender(m, `${BASE}/calendar/week/2026-10-14`, '[data-overview], [data-segment]', '360 주 보기 첫 렌더링', cpu)
      await firstRender(m, `${BASE}/calendar/day/2026-10-14`, '[data-segment]', '360 일 보기 10-14 첫 렌더링', cpu)
    }
    // 세로 밀기(손가락) 프레임
    await m.evaluate(() => {
      window.__lt = []
      window.__startFrames()
    })
    await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 600, yDistance: -500, speed: 1200, gestureSourceType: 'touch', repeatCount: 2, repeatDelayMs: 100 })
    await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 300, yDistance: 500, speed: 1200, gestureSourceType: 'touch', repeatCount: 2, repeatDelayMs: 100 })
    const sf = await m.evaluate(() => window.__stopFrames())
    const slt = await m.evaluate(() => window.__lt)
    const sr = { label: '360 일 보기 세로 밀기(터치)', cpu, ...frameStats(sf), longTasks: slt.length, longTaskMaxMs: Math.round(Math.max(0, ...slt.map((e) => e.d))) }
    out.drags.push(sr)
    log(JSON.stringify(sr))
    // 길게 눌러 옮기기 → 되돌리기
    const touchDrag = async (from, dy, phase) => {
      await m.evaluate(() => {
        window.__lt = []
        window.__startFrames()
      })
      const tp = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(from.x, from.y) })
      await m.waitForTimeout(600) // 길게 누르기 450ms
      for (let i = 1; i <= 20; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(from.x, from.y + (dy * i) / 20) })
      const t0 = Date.now()
      const resp = m.waitForResponse(isMove, { timeout: 30000 }).catch(() => null)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      const res = await resp
      const saveMs = Date.now() - t0
      await m.waitForTimeout(400)
      const f = await m.evaluate(() => window.__stopFrames())
      const lt = await m.evaluate(() => window.__lt)
      const r = { label: `360 일 보기 길게 눌러 끌기 ${phase}`, cpu, saveStatus: res?.status() ?? null, saveMs: res ? saveMs : null, ...frameStats(f), longTasks: lt.length, longTaskMaxMs: Math.round(Math.max(0, ...lt.map((e) => e.d))) }
      out.drags.push(r)
      log(JSON.stringify(r))
      return res
    }
    await firstRender(m, `${BASE}/calendar/day/2026-10-14`, '[data-segment]', '360 일 보기(끌기 전)', cpu)
    const pick = await m.evaluate(() => {
      for (const el of document.querySelectorAll('[data-segment]')) {
        if (/반복/.test(el.getAttribute('aria-label') || '')) continue
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        if (r.width < 20 || r.height < 20 || r.top < 120 || r.bottom > innerHeight - 160) continue
        return { x: r.left + r.width / 2, y: r.top + Math.min(10, r.height / 2), id: el.dataset.focusId }
      }
      return null
    })
    if (!pick) out.notes.push(`360 끌기 cpu${cpu}: 끌 일정을 못 찾음`)
    else {
      const r1 = await touchDrag(pick, 96, '옮기기')
      if (r1) {
        await m.waitForTimeout(800)
        const back = await m.evaluate((id) => {
          const el = [...document.querySelectorAll('[data-focus-id]')].find((e) => e.dataset.focusId === id)
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { x: r.left + r.width / 2, y: r.top + Math.min(10, r.height / 2) }
        }, pick.id)
        const r2 = back ? await touchDrag(back, -96, '되돌리기') : null
        out.notes.push(`360 끌기 cpu${cpu}: 되돌리기 ${r2 ? `응답 ${r2.status()}` : '실패 — 수동 확인 필요'}`)
      } else out.notes.push(`360 끌기 cpu${cpu}: 저장 응답 없음(옮겨지지 않음)`)
    }
  }
  await mctx.close()
} catch (e) {
  out.error = String(e?.stack || e)
  console.error(e)
} finally {
  await browser.close()
  out.endedAt = new Date().toISOString()
  fs.writeFileSync(path.join(HERE, process.argv[2] === 'switch' ? 'result-switch.json' : 'result.json'), JSON.stringify(out, null, 2))
  log('notes', JSON.stringify(out.notes))
}
