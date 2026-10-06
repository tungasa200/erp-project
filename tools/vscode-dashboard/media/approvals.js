// 승인 센터 탭 렌더링. 상태는 approvalCenter.js가 postMessage로 보낸다.
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  let state = null;
  let kinds = {};
  let autoKinds = [];
  const rejecting = new Set(); // 거부 사유를 쓰는 중인 카드
  const drafts = new Map(); // 다시 그려도 사유가 지워지지 않게 남긴다
  const errors = new Map(); // 카드별 마지막 오류
  const busy = new Set(); // 결정을 보낸 뒤 회신을 기다리는 카드
  let knownPending = null;
  const n = (st) => st.pending.length;
  let lastJson = '';

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

  function announce(text) {
    $('announce').textContent = text;
  }

  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return '';
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}시간 전`;
    return new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  }

  const isPm = (kind) => !autoKinds.includes(kind);

  function kindChip(kind) {
    const pm = isPm(kind);
    const chip = el('span', 'kind ' + (pm ? 'k-pm' : 'k-' + kind));
    chip.append(icon(pm ? 'i-pm' : kind === 'push' ? 'i-push' : 'i-commit'), el('span', null, pm ? `PM 결정 · ${kinds[kind] || kind}` : kinds[kind] || kind));
    return chip;
  }

  function button(cls, label, onClick, iconId, id) {
    const b = el('button', 'btn ' + cls);
    b.type = 'button';
    if (id) b.id = id;
    if (iconId) b.append(icon(iconId));
    b.append(el('span', null, label));
    b.setAttribute('aria-disabled', 'false');
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      onClick();
    });
    return b;
  }

  function send(id, decision, reason) {
    busy.add(id);
    errors.delete(id);
    vscode.postMessage({ type: 'decide', id, decision, reason });
    render();
  }

  function brokenCard(r) {
    const card = el('article', 'card is-broken');
    const p = el('p', 'c-error');
    p.append(icon('i-error'), el('span', null, `요청 파일 형식 오류: requests/${r.id}.json — ${r.broken}. 파일을 고치거나 지우면 카드가 사라집니다.`));
    card.append(p);
    return card;
  }

  function card(r) {
    if (r.broken) return brokenCard(r);
    const pm = isPm(r.kind);
    const card = el('article', 'card' + (pm ? ' is-pm' : ''));
    card.setAttribute('aria-labelledby', 'ct-' + r.id);

    const top = el('div', 'c-top');
    top.append(kindChip(r.kind), el('span', 'c-session', r.session));
    const when = el('span', null, ago(r.createdAt));
    if (r.createdAt) when.title = new Date(r.createdAt).toLocaleString('ko-KR');
    top.append(when);
    card.append(top);

    const title = el('h3', 'c-title', r.title || r.command || '(제목 없음)');
    title.id = 'ct-' + r.id;
    card.append(title);

    const meta = el('p', 'c-meta');
    if (r.branch) {
      const b = el('span', null, '브랜치 ');
      b.append(el('span', 'branch', r.branch));
      meta.append(b);
    }
    if (r.commits.length) {
      const c = el('span', null, '커밋 ');
      c.append(el('b', null, String(r.commits.length) + '개'));
      meta.append(c);
    }
    if (r.fileCount != null) {
      const f = el('span', null, '바뀐 파일 ');
      f.append(el('b', null, String(r.fileCount) + '개'));
      meta.append(f);
    }
    if (meta.childNodes.length) card.append(meta);

    const verify = el('p', 'verify' + (r.verification ? '' : ' is-missing'));
    verify.append(icon(r.verification ? 'i-check' : 'i-error'), el('span', null, r.verification ? '검증: ' + r.verification : '검증 결과가 적혀 있지 않습니다'));
    card.append(verify);

    if (r.command) {
      const cmd = el('pre', 'cmd', r.command);
      cmd.setAttribute('aria-label', '실행할 명령');
      card.append(cmd);
    }

    if (r.commits.length || r.files.length || r.detail) {
      const det = el('details');
      det.append(el('summary', null, '자세히'));
      if (r.commits.length) {
        const ol = el('ol', 'list');
        r.commits.forEach((c) => {
          const li = el('li');
          li.append(el('code', null, c.hash.slice(0, 7)), document.createTextNode(c.subject));
          ol.append(li);
        });
        det.append(el('p', 'detail-text', '커밋'), ol);
      }
      if (r.files.length) {
        const ul = el('ul', 'list');
        r.files.forEach((f) => ul.append(el('li', null, f)));
        det.append(el('p', 'detail-text', '파일'), ul);
      }
      if (r.detail) det.append(el('p', 'detail-text', r.detail));
      card.append(det);
    }

    const waiting = busy.has(r.id);
    const actions = el('div', 'actions');
    if (!rejecting.has(r.id)) {
      const approve = button('primary', '승인', () => send(r.id, 'approved', ''), 'i-check', 'approve-' + r.id);
      const reject = button('danger', '거부', () => {
        rejecting.add(r.id);
        render();
        const ta = document.getElementById('reason-' + r.id);
        if (ta) ta.focus();
      }, 'i-x', 'reject-' + r.id);
      [approve, reject].forEach((b) => b.setAttribute('aria-disabled', String(waiting)));
      approve.setAttribute('aria-describedby', 'ct-' + r.id);
      actions.append(approve, reject);
      card.append(actions);
    } else {
      const box = el('div', 'reject-box');
      const label = el('label', null, '거부 사유(요청한 세션에 그대로 전달됩니다)');
      label.htmlFor = 'reason-' + r.id;
      const ta = el('textarea');
      ta.id = 'reason-' + r.id;
      ta.value = drafts.get(r.id) || '';
      ta.required = true;
      ta.addEventListener('input', () => {
        drafts.set(r.id, ta.value);
        ta.removeAttribute('aria-invalid');
      });
      const confirm = button('danger', '거부 확정', () => {
        if (!ta.value.trim()) {
          ta.setAttribute('aria-invalid', 'true');
          errors.set(r.id, '거부 사유를 적어 주세요.');
          render();
          document.getElementById('reason-' + r.id).focus();
          return;
        }
        send(r.id, 'rejected', ta.value.trim());
      }, 'i-x', 'confirm-' + r.id);
      const cancel = button('ghost', '취소', () => {
        rejecting.delete(r.id);
        errors.delete(r.id);
        render();
        const back = document.getElementById('reject-' + r.id);
        if (back) back.focus();
      }, null, 'cancel-' + r.id);
      confirm.setAttribute('aria-disabled', String(waiting));
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cancel.click();
      });
      actions.append(confirm, cancel);
      box.append(label, ta, actions);
      card.append(box);
    }

    if (errors.has(r.id)) {
      const p = el('p', 'c-error');
      p.setAttribute('role', 'alert');
      p.append(icon('i-error'), el('span', null, errors.get(r.id)));
      card.append(p);
    }
    return card;
  }

  function recentItem(d) {
    const li = el('li');
    const auto = d.by === 'auto';
    const ok = d.decision === 'approved';
    const mark = el('span', 'r-mark ' + (ok ? (auto ? 'r-auto' : 'r-approved') : 'r-rejected'));
    mark.append(icon(ok ? (auto ? 'i-auto' : 'i-check') : 'i-x'), el('span', null, ok ? (auto ? '자동 승인' : '승인') : '거부'));
    const req = d.request;
    const label = `${kinds[d.kind] || d.kind || ''} · ${(req && (req.title || req.command)) || d.command || d.id}`;
    const title = el('span', 'r-title', label);
    title.title = label + (req ? ` (${req.session})` : '');
    const time = el('span', 'r-time', ago(d.decidedAt));
    if (d.decidedAt) time.title = new Date(d.decidedAt).toLocaleString('ko-KR');
    li.append(mark, title, time);
    if (d.reason) li.append(el('span', 'r-reason', '사유: ' + d.reason));
    return li;
  }

  function render() {
    if (!state) return;
    const pending = state.pending;
    const n = pending.length;

    const summary = $('summary');
    summary.textContent = n ? `승인 대기 ${n}건` : '대기 중인 요청이 없습니다';
    summary.classList.toggle('has-pending', n > 0);
    const count = $('pending-count');
    count.textContent = String(n);
    count.classList.toggle('has-pending', n > 0);

    const banner = $('banner');
    banner.hidden = !state.error;
    if (state.error) banner.replaceChildren(icon('i-error'), el('span', null, '승인 파일을 읽지 못했습니다: ' + state.error));

    for (const sw of document.querySelectorAll('.switch')) {
      sw.setAttribute('aria-checked', String(!!state.config.autoApprove[sw.dataset.kind]));
      sw.removeAttribute('aria-busy');
    }

    // 다시 그려도 포커스와 입력 위치를 잃지 않게 id로 되살린다
    const focused = document.activeElement;
    const active = focused && focused.id;
    const sel = focused && focused.tagName === 'TEXTAREA' ? [focused.selectionStart, focused.selectionEnd] : null;
    const list = $('pending');
    if (n) list.replaceChildren(...pending.map(card));
    else {
      const empty = el('div', 'empty');
      empty.append(el('p', null, '대기 중인 요청이 없습니다. 세션이 요청 파일을 쓰면 여기에 바로 나타납니다.'), el('p', 'path', state.root + '\\requests'));
      list.replaceChildren(empty);
    }
    const again = active && document.getElementById(active);
    if (again && again !== focused) {
      again.focus();
      if (sel) again.setSelectionRange(sel[0], sel[1]);
    } else if (!again && /^(approve|reject|confirm|cancel|reason)-/.test(active || '')) {
      // 결정한 카드가 사라지면 다음 카드의 승인 버튼, 없으면 대기 제목으로 포커스를 옮긴다
      const next = list.querySelector('.btn.primary');
      (next || $('h-pending')).focus();
    }

    const recent = $('recent');
    if (state.recent.length) recent.replaceChildren(...state.recent.map(recentItem));
    else recent.replaceChildren(el('li', 'empty-row', '아직 결정한 요청이 없습니다.'));
  }

  window.addEventListener('message', ({ data: msg }) => {
    if (msg.type === 'state') {
      const json = JSON.stringify(msg.state);
      if (json === lastJson) return; // 바뀐 게 없으면 다시 그리지 않는다
      lastJson = json;
      const prev = knownPending;
      state = msg.state;
      kinds = state.kinds || {};
      autoKinds = state.autoKinds || [];
      const ids = new Set(state.pending.map((r) => r.id));
      const added = prev ? state.pending.filter((r) => !prev.has(r.id)).length : 0;
      const decided = [...busy].filter((id) => !ids.has(id)).map((id) => state.recent.find((d) => d.id === id)).filter(Boolean);
      if (decided.length) announce(decided.map((d) => (d.decision === 'approved' ? '승인했습니다' : '거부했습니다')).join(', ') + (n(state) ? `. 남은 대기 ${n(state)}건` : '. 대기 요청이 없습니다'));
      else if (added) announce(`새 승인 요청 ${added}건`);
      // 결정이 끝난 카드의 임시 상태를 지운다
      for (const set of [rejecting, busy]) for (const id of [...set]) if (!ids.has(id)) set.delete(id);
      for (const id of [...drafts.keys()]) if (!ids.has(id)) drafts.delete(id);
      knownPending = ids;
      render();
    } else if (msg.type === 'error') {
      if (msg.id) {
        busy.delete(msg.id);
        errors.set(msg.id, msg.message);
      } else {
        announce('오류: ' + msg.message);
      }
      render();
    }
  });

  for (const sw of document.querySelectorAll('.switch')) {
    sw.addEventListener('click', () => {
      if (!state || sw.getAttribute('aria-busy') === 'true') return;
      const value = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(value));
      sw.setAttribute('aria-busy', 'true');
      vscode.postMessage({ type: 'toggle', kind: sw.dataset.kind, value });
      announce(`${sw.dataset.kind === 'commit' ? '커밋' : '푸시'} 자동 승인 ${value ? '켜짐' : '꺼짐'}`);
    });
  }

  $('open-folder').addEventListener('click', () => vscode.postMessage({ type: 'openFolder' }));

  // 경과 시간 표시를 갱신한다
  setInterval(() => {
    if (!document.querySelector('textarea:focus')) render();
  }, 30000);

  vscode.postMessage({ type: 'ready' });
})();
