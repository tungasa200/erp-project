// 사이드바 패널 렌더링. 데이터는 extension.js가 postMessage로 보낸다.
(() => {
  const vscode = acquireVsCodeApi();
  const GB = 1024 ** 3;
  const LOW_FREE = GB;
  const $ = (id) => document.getElementById(id);

  const STATES = {
    working: { label: '작업 중', icon: 'i-working' },
    idle: { label: '대기', icon: 'i-idle' },
    waiting: { label: '입력 대기', icon: 'i-waiting' },
    approval: { label: '승인 대기', icon: 'i-approval' },
    stopped: { label: '멈춤', icon: 'i-stopped' },
    failed: { label: '오류', icon: 'i-failed' },
    none: { label: '없음', icon: 'i-none' },
  };
  // 진행 중 > 대기 > 멈춤 > 오류 > 없음. 같은 그룹 안은 역할 표 순서
  const GROUP = { working: 0, idle: 1, waiting: 1, approval: 1, stopped: 2, failed: 3, none: 4 };
  // waitingFor 중 사람이 승인·선택해야 하는 것. 'input needed'는 다음 지시를 기다리는 상태
  const NEEDS_APPROVAL = ['permission prompt', 'sandbox request', 'worker request', 'dialog open'];
  const WAITING_FOR = {
    'permission prompt': '권한 승인 요청',
    'sandbox request': '샌드박스 허용 요청',
    'worker request': '작업자 요청',
    'dialog open': '선택 대화상자 열림',
    'input needed': '다음 지시를 기다림',
  };

  const saved = vscode.getState() || {};
  const folded = new Set(saved.folded || []);
  let roles = [];
  let lastSessions = null;
  let wasLow = false;
  let lastAt = 0;
  const failed = new Set();

  const fmtGB = (b) => (b / GB).toFixed(1) + ' GB';
  const fmtSize = (b) => (b >= GB ? (b / GB).toFixed(2) + ' GB' : Math.round(b / 1024 ** 2) + ' MB');
  const fmtTime = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour12: false });

  function fmtElapsed(startedAt) {
    if (!startedAt) return '—';
    const min = Math.floor((Date.now() - startedAt) / 60000);
    if (min < 1) return '1분 미만';
    if (min < 60) return min + '분';
    const h = Math.floor(min / 60);
    if (h < 10) return h + '시간 ' + (min % 60) + '분';
    if (h < 24) return h + '시간';
    return Math.floor(h / 24) + '일 ' + (h % 24) + '시간';
  }

  // 백그라운드는 state(working·blocked·done·failed·stopped)+waitingFor, VS Code 세션은 status(busy·waiting·idle)
  function stateOf(s) {
    const v = String(s.state || s.status || '').toLowerCase();
    const st = String(s.status || '').toLowerCase();
    const wf = String(s.waitingFor || '').toLowerCase();
    if (['stopped', 'done', 'exited', 'killed'].includes(v)) return 'stopped';
    if (['failed', 'error', 'crashed'].includes(v)) return 'failed';
    if (NEEDS_APPROVAL.includes(wf)) return 'approval';
    if (v === 'blocked') return 'waiting';
    if (st === 'waiting') return wf === 'input needed' ? 'waiting' : 'approval';
    if (['busy', 'working', 'running', 'starting'].includes(v) || st === 'busy') return 'working';
    return 'idle';
  }

  function sortRows(rows) {
    const rank = (n) => {
      const i = roles.indexOf(n);
      return i < 0 ? roles.length : i;
    };
    return rows.sort(
      (a, b) =>
        GROUP[a.st] - GROUP[b.st] ||
        rank(a.name) - rank(b.name) ||
        a.name.localeCompare(b.name) ||
        ((b.s && b.s.startedAt) || 0) - ((a.s && a.s.startedAt) || 0),
    );
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function icon(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  // 주기 갱신은 읽어 주지 않고, 수동 새로고침 완료와 메모리 경고 전환만 알린다
  function announce(text) {
    $('announce').textContent = text;
  }

  function errLine(text) {
    const p = el('p', 'err-line');
    p.append(icon('i-error'), el('span', null, text));
    return p;
  }

  // 블록 본문 대신 오류 한 줄을 보여 준다. 다음에 성공하면 본문이 돌아온다
  function showError(boxId, errId, text) {
    $(boxId).hidden = !!text;
    const err = $(errId);
    err.hidden = !text;
    if (text) err.replaceChildren(...errLine(text).childNodes);
  }

  function stamp() {
    const s = $('stamp');
    if (failed.size) {
      s.textContent = '일부 정보를 읽지 못했습니다';
      s.classList.add('is-error');
    } else {
      s.textContent = lastAt ? fmtTime(lastAt) + ' 갱신' : '불러오는 중…';
      s.classList.remove('is-error');
    }
  }

  function renderMemory(msg) {
    const box = $('mem');
    box.classList.remove('is-loading');
    showError('mem', 'mem-err', msg.error && '메모리를 읽지 못했습니다: ' + msg.error);
    if (msg.error) return;
    const { total, free } = msg.data;
    const used = total - free;
    const pct = Math.round((used / total) * 100);
    const low = free < LOW_FREE;
    box.classList.toggle('is-low', low);
    if (low !== wasLow) announce(low ? `여유 메모리 ${fmtGB(free)}, 1GB 미만입니다` : '여유 메모리가 1GB 이상으로 돌아왔습니다');
    wasLow = low;
    $('mem-free').textContent = fmtGB(free);
    $('mem-total').textContent = '전체 ' + fmtGB(total);
    const meter = $('mem-meter');
    meter.style.setProperty('--used', String(used / total));
    meter.style.setProperty('--limit', Math.max(0, ((total - LOW_FREE) / total) * 100) + '%');
    meter.setAttribute('aria-valuenow', String(pct));
    meter.setAttribute('aria-valuetext', `사용 ${fmtGB(used)}, 여유 ${fmtGB(free)}`);
    const note = $('mem-note');
    note.replaceChildren();
    if (low) note.append(icon('i-warn'), el('span', null, '여유 1GB 미만 — 무거운 작업을 시작하지 마세요'));
    else note.append(el('span', null, `사용 ${fmtGB(used)} · ${pct}%`));
  }

  function renderProcesses(msg) {
    const list = $('procs');
    list.classList.remove('is-loading');
    list.replaceChildren();
    if (msg.error) {
      const li = el('li');
      li.append(errLine('프로세스 목록을 읽지 못했습니다: ' + msg.error));
      list.append(li);
      return;
    }
    if (!msg.data.length) {
      list.append(el('li', 'empty', '표시할 프로세스가 없습니다'));
      return;
    }
    const max = msg.data[0].bytes;
    for (const p of msg.data) {
      const li = el('li', 'proc');
      const name = el('span', 'proc-name', p.name);
      name.title = p.name;
      name.append(el('span', 'proc-count', '×' + p.count));
      const bar = el('span', 'proc-bar');
      bar.setAttribute('aria-hidden', 'true');
      const fill = el('i');
      fill.style.setProperty('--share', String(p.bytes / max));
      bar.append(fill);
      li.append(name, el('span', 'proc-mem', fmtSize(p.bytes)), bar);
      list.append(li);
    }
  }

  function sessionRow(name, s, state) {
    const tr = el('tr');
    if (state === 'approval') tr.className = 'is-approval';
    if (state === 'none') tr.className = 'is-absent';
    const who = el('td');
    const nm = el('span', 's-name', name);
    nm.title = name;
    const meta = el('span', 's-meta');
    if (s) {
      meta.append(el('span', null, (s.kind === 'background' ? '백그라운드' : 'VS Code') + ' · '), el('span', 's-id', s.id));
    } else {
      meta.textContent = '띄우지 않음';
    }
    who.append(nm, meta);
    const st = el('td');
    const chip = el('span', 'state st-' + state);
    chip.append(icon(STATES[state].icon), el('span', null, STATES[state].label));
    const wf = s && s.waitingFor;
    if (wf) chip.title = WAITING_FOR[String(wf).toLowerCase()] || wf;
    st.append(chip);
    const age = el('td', 'num elapsed', s && state !== 'stopped' ? fmtElapsed(s.startedAt) : '—');
    if (s && s.startedAt) age.title = new Date(s.startedAt).toLocaleString('ko-KR') + ' 시작';
    tr.append(who, st, age);
    return tr;
  }

  function renderSessions(msg) {
    const body = $('sess-body');
    body.classList.remove('is-loading');
    body.replaceChildren();
    if (msg.error) {
      const td = el('td');
      td.colSpan = 3;
      td.append(errLine('세션 목록을 읽지 못했습니다: ' + msg.error));
      const tr = el('tr');
      tr.append(td);
      body.append(tr);
      $('sess-sum').textContent = '';
      return;
    }
    const sessions = msg.data.map((s) => ({ name: s.name, s, st: stateOf(s) }));
    const seen = new Set(sessions.map((r) => r.name));
    const rows = sortRows([...sessions, ...roles.filter((r) => !seen.has(r)).map((r) => ({ name: r, s: null, st: 'none' }))]);
    for (const r of rows) body.append(sessionRow(r.name, r.s, r.st));
    if (!rows.length) {
      const td = el('td', 'empty', '실행 중인 Claude 세션이 없습니다');
      td.colSpan = 3;
      const tr = el('tr');
      tr.append(td);
      body.append(tr);
    }

    const live = sessions.filter((r) => GROUP[r.st] <= 1).length;
    const approval = sessions.filter((r) => r.st === 'approval').length;
    $('sess-sum').textContent = `실행 ${live}` + (approval ? ` · 승인 대기 ${approval}` : '') + (roles.length ? ` / 역할 ${roles.length}` : '');
  }

  const RENDER = { memory: renderMemory, processes: renderProcesses, sessions: renderSessions };

  // 접기: 상태는 webview state에 남기고, 접힌 블록은 확장이 읽지 않는다
  function applyFold(source, btnId, bodyId) {
    const btnEl = $(btnId);
    const isFolded = folded.has(source);
    btnEl.setAttribute('aria-expanded', String(!isFolded));
    $(bodyId).hidden = isFolded;
    btnEl.closest('.block').classList.toggle('is-folded', isFolded);
  }

  $('proc-fold').addEventListener('click', () => {
    const isFolded = !folded.has('processes');
    if (isFolded) folded.add('processes');
    else folded.delete('processes');
    vscode.setState({ ...saved, folded: [...folded] });
    applyFold('processes', 'proc-fold', 'proc-body');
    vscode.postMessage({ type: 'fold', source: 'processes', folded: isFolded });
  });
  applyFold('processes', 'proc-fold', 'proc-body');

  window.addEventListener('message', ({ data: msg }) => {
    if (msg.type === 'refreshed') {
      btn.setAttribute('aria-busy', 'false');
      btn.setAttribute('aria-disabled', 'false');
      announce(failed.size ? '새로고침했지만 일부 정보를 읽지 못했습니다' : '새로고침했습니다');
      return;
    }
    if (msg.type === 'roles') {
      roles = msg.data || [];
      if (lastSessions) renderSessions(lastSessions);
      return;
    }
    const render = RENDER[msg.type];
    if (!render) return;
    if (msg.type === 'sessions') lastSessions = msg;
    render(msg);
    if (msg.error) failed.add(msg.type);
    else {
      failed.delete(msg.type);
      lastAt = Math.max(lastAt, msg.at);
    }
    stamp();
  });

  const btn = $('refresh');
  // disabled는 키보드 포커스를 잃게 하므로 aria-disabled로 막는다
  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-disabled') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    btn.setAttribute('aria-disabled', 'true');
    vscode.postMessage({ type: 'refresh' });
  });

  vscode.postMessage({ type: 'ready', folded: [...folded] });
})();
