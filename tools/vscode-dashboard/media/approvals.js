// 승인 센터 탭 렌더링. 상태는 approvalCenter.js가 postMessage로 보낸다.
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  let state = null;
  let kinds = {};
  let routineKinds = [];
  const rejecting = new Set(); // 거부 사유를 쓰는 중인 카드
  const drafts = new Map(); // 다시 그려도 지워지지 않게 남기는 입력(거부 사유 문자열, 결정 카드는 선택 상태)
  const invalid = new Map(); // 결정 카드 id → 답하지 않은 질문 번호
  const errors = new Map(); // 카드별 마지막 오류
  const busy = new Set(); // 결정을 보낸 뒤 회신을 기다리는 카드
  let knownPending = null;
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

  const isChoice = (kind) => kind === 'choice';
  const isPm = (kind) => !isChoice(kind) && !routineKinds.includes(kind);

  function kindChip(kind) {
    let cls = 'k-' + kind;
    let iconId = kind === 'push' ? 'i-push' : 'i-commit';
    let label = kinds[kind] || kind;
    if (isChoice(kind)) {
      cls = 'k-choice';
      iconId = 'i-choice';
    } else if (isPm(kind)) {
      cls = 'k-pm';
      iconId = 'i-pm';
      label = `PM 결정 · ${label}`;
    }
    const chip = el('span', 'kind ' + cls);
    chip.append(icon(iconId), el('span', null, label));
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

  function errorLine(id) {
    if (!errors.has(id)) return null;
    const p = el('p', 'c-error');
    p.setAttribute('role', 'alert');
    p.append(icon('i-error'), el('span', null, errors.get(id)));
    return p;
  }

  function cardTop(r) {
    const top = el('div', 'c-top');
    top.append(kindChip(r.kind), el('span', 'c-session', r.session));
    const when = el('span', null, ago(r.createdAt));
    if (r.createdAt) when.title = new Date(r.createdAt).toLocaleString('ko-KR');
    top.append(when);
    if (r.relatedSessions && r.relatedSessions.length) {
      const rel = el('span', 'related');
      rel.setAttribute('aria-label', '관련 세션 ' + r.relatedSessions.join(', '));
      r.relatedSessions.forEach((s) => rel.append(el('span', null, s)));
      top.append(rel);
    }
    return top;
  }

  function send(id, message) {
    busy.add(id);
    errors.delete(id);
    vscode.postMessage({ id, ...message });
    render();
  }

  function brokenCard(r) {
    const card = el('article', 'card is-broken');
    const p = el('p', 'c-error');
    p.append(icon('i-error'), el('span', null, `요청 파일 형식 오류: requests/${r.id}.json — ${r.broken}. 파일을 고치거나 지우면 카드가 사라집니다.`));
    card.append(p);
    return card;
  }

  // git 명령 승인 카드
  function gitCard(r) {
    const card = el('article', 'card' + (isPm(r.kind) ? ' is-pm' : ''));
    card.setAttribute('aria-labelledby', 'ct-' + r.id);
    card.append(cardTop(r));

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
      c.append(el('b', null, r.commits.length + '개'));
      meta.append(c);
    }
    if (r.fileCount != null) {
      const f = el('span', null, '바뀐 파일 ');
      f.append(el('b', null, r.fileCount + '개'));
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
      const approve = button('primary', '승인', () => send(r.id, { type: 'decide', decision: 'approved' }), 'i-check', 'approve-' + r.id);
      const reject = button('danger', '거부', () => {
        rejecting.add(r.id);
        render();
        const ta = $('reason-' + r.id);
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
          errors.set(r.id, '거부 사유를 적어 주세요.');
          render();
          const again = $('reason-' + r.id);
          again.setAttribute('aria-invalid', 'true');
          again.focus();
          return;
        }
        send(r.id, { type: 'decide', decision: 'rejected', reason: ta.value.trim() });
      }, 'i-x', 'confirm-' + r.id);
      const cancel = button('ghost', '취소', () => {
        rejecting.delete(r.id);
        errors.delete(r.id);
        render();
        const back = $('reject-' + r.id);
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
    const err = errorLine(r.id);
    if (err) card.append(err);
    return card;
  }

  function choiceDraft(r) {
    if (!drafts.has(r.id)) drafts.set(r.id, { answers: r.questions.map(() => ({ selected: [], otherOn: false, other: '' })), note: '' });
    return drafts.get(r.id);
  }

  // 선택지 결정 카드(AskUserQuestion과 같은 모양: 질문 1~4개, 선택지 2~4개, 기타 직접 입력)
  function choiceCard(r) {
    const d = choiceDraft(r);
    const bad = invalid.get(r.id) || new Set();
    const card = el('article', 'card is-choice');
    card.setAttribute('aria-labelledby', 'ct-' + r.id);
    card.append(cardTop(r));

    const title = el('h3', 'c-title', r.title || (r.questions.length === 1 ? r.questions[0].question : `질문 ${r.questions.length}개`));
    title.id = 'ct-' + r.id;
    card.append(title);
    if (r.background) card.append(el('p', 'bg-text', r.background));

    r.questions.forEach((q, i) => {
      const a = d.answers[i];
      const base = `ch-${r.id}-q${i}`;
      const fs = el('fieldset', 'q' + (bad.has(i) ? ' is-invalid' : ''));
      fs.id = base;
      const legend = el('legend', 'q-head');
      if (q.header) legend.append(el('span', 'q-tag', q.header));
      legend.append(el('span', null, q.question), el('span', 'q-mode', q.multiSelect ? '여러 개 고를 수 있음' : '하나만 고름'));
      fs.append(legend);
      if (bad.has(i)) {
        const msg = el('p', 'c-error', null);
        msg.id = base + '-err';
        msg.append(icon('i-error'), el('span', null, '이 질문에 답해 주세요.'));
        fs.append(msg);
        fs.setAttribute('aria-describedby', msg.id);
      }

      const opts = el('div', 'opts');
      const type = q.multiSelect ? 'checkbox' : 'radio';
      const sync = () => {
        invalid.get(r.id) && invalid.get(r.id).delete(i);
      };
      q.options.forEach((o, j) => {
        const row = el('label', 'opt');
        const input = el('input');
        input.type = type;
        input.name = base;
        input.id = `${base}-o${j}`;
        input.checked = a.selected.includes(o.label);
        input.addEventListener('change', () => {
          if (q.multiSelect) a.selected = input.checked ? [...a.selected, o.label] : a.selected.filter((s) => s !== o.label);
          else {
            a.selected = [o.label];
            a.otherOn = false;
          }
          sync();
        });
        const label = el('span', 'opt-label', o.label);
        if (o.recommended) {
          const rec = el('span', 'rec');
          rec.append(icon('i-star'), el('span', null, '추천'));
          label.append(rec);
        }
        row.append(input, label);
        if (o.description) row.append(el('span', 'opt-desc', o.description));
        opts.append(row);
      });
      if (q.allowOther) {
        const row = el('label', 'opt');
        const input = el('input');
        input.type = type;
        input.name = base;
        input.id = `${base}-oth`;
        input.checked = a.otherOn;
        const text = el('input', 'other-input');
        text.type = 'text';
        text.id = `${base}-other`;
        text.value = a.other;
        text.placeholder = '직접 입력';
        text.setAttribute('aria-label', `${q.header || q.question} — 기타 답 직접 입력`);
        input.addEventListener('change', () => {
          a.otherOn = input.checked;
          if (!q.multiSelect && input.checked) a.selected = [];
          if (input.checked) text.focus();
          sync();
        });
        // 글을 쓰면 기타가 선택된다
        text.addEventListener('input', () => {
          a.other = text.value;
          if (text.value && !input.checked) {
            input.checked = true;
            a.otherOn = true;
            if (!q.multiSelect) a.selected = [];
          }
          sync();
        });
        text.addEventListener('click', (e) => e.preventDefault()); // label 안의 입력칸을 눌러도 선택이 뒤집히지 않게
        row.append(input, el('span', 'opt-label', '기타'), text);
        opts.append(row);
      }
      fs.append(opts);
      card.append(fs);
    });

    const note = el('div', 'note');
    const nl = el('label', null, '메모(선택) — 요청한 세션에 함께 전달됩니다');
    nl.htmlFor = `ch-${r.id}-note`;
    const ta = el('textarea');
    ta.id = `ch-${r.id}-note`;
    ta.value = d.note;
    ta.addEventListener('input', () => (d.note = ta.value));
    note.append(nl, ta);
    card.append(note);

    const actions = el('div', 'actions');
    const sendBtn = button('primary', '보내기', () => {
      const missing = new Set(r.questions.map((q, i) => i).filter((i) => {
        const a = d.answers[i];
        return !a.selected.length && !(a.otherOn && a.other.trim());
      }));
      if (missing.size) {
        invalid.set(r.id, missing);
        errors.set(r.id, `답하지 않은 질문이 ${missing.size}개 있습니다.`);
        render();
        const first = [...missing][0];
        const target = $(`ch-${r.id}-q${first}-o0`);
        if (target) target.focus();
        return;
      }
      invalid.delete(r.id);
      send(r.id, {
        type: 'answer',
        answers: d.answers.map((a) => ({ selected: a.selected, other: a.otherOn ? a.other.trim() : '' })),
        note: d.note.trim(),
      });
    }, 'i-send', `ch-${r.id}-send`);
    sendBtn.setAttribute('aria-disabled', String(busy.has(r.id)));
    sendBtn.setAttribute('aria-describedby', 'ct-' + r.id);
    actions.append(sendBtn);
    card.append(actions);
    const err = errorLine(r.id);
    if (err) card.append(err);
    return card;
  }

  const card = (r) => (r.broken ? brokenCard(r) : isChoice(r.kind) ? choiceCard(r) : gitCard(r));

  function answerSummary(d) {
    const parts = (d.answers || []).map((a, i) => {
      const picked = [...(a.selected || []), ...(a.other ? ['기타: ' + a.other] : [])].join(', ');
      return `${a.header || 'Q' + (i + 1)}: ${picked}`;
    });
    if (d.note) parts.push('메모: ' + d.note);
    return parts.join(' / ');
  }

  function recentItem(d) {
    const li = el('li');
    const req = d.request;
    let mark;
    if (d.decision === 'answered') {
      mark = el('span', 'r-mark r-answered');
      mark.append(icon('i-choice'), el('span', null, '답변'));
    } else {
      const ok = d.decision === 'approved';
      mark = el('span', 'r-mark ' + (ok ? 'r-approved' : 'r-rejected'));
      mark.append(icon(ok ? 'i-check' : 'i-x'), el('span', null, ok ? '승인' : '거부'));
    }
    const what = (req && (req.title || req.command || (req.questions && req.questions[0].question))) || d.command || d.id;
    const label = `${kinds[d.kind] || d.kind || ''} · ${what}`;
    const title = el('span', 'r-title', label);
    title.title = label + (d.session ? ` (${d.session})` : '');
    const time = el('span', 'r-time', ago(d.decidedAt));
    if (d.decidedAt) time.title = new Date(d.decidedAt).toLocaleString('ko-KR');
    li.append(mark, title, time);
    const extra = d.decision === 'answered' ? answerSummary(d) : d.reason ? '사유: ' + d.reason : '';
    if (extra) li.append(el('span', 'r-reason', extra));
    return li;
  }

  function counts(pending) {
    const broken = pending.filter((r) => r.broken).length;
    const choices = pending.filter((r) => r.kind === 'choice').length;
    return { total: pending.length, choices, broken, approvals: pending.length - choices - broken };
  }

  function render() {
    if (!state) return;
    const pending = state.pending;
    const c = counts(pending);

    const summary = $('summary');
    summary.textContent = c.total ? [c.approvals && `승인 대기 ${c.approvals}건`, c.choices && `결정 대기 ${c.choices}건`, c.broken && `형식 오류 ${c.broken}건`].filter(Boolean).join(' · ') : '대기 중인 요청이 없습니다';
    summary.classList.toggle('has-pending', c.total > 0);
    const count = $('pending-count');
    count.textContent = String(c.total);
    count.classList.toggle('has-pending', c.total > 0);

    const banner = $('banner');
    banner.hidden = !state.error;
    if (state.error) banner.replaceChildren(icon('i-error'), el('span', null, '승인 파일을 읽지 못했습니다: ' + state.error));

    // 다시 그려도 포커스와 입력 위치를 잃지 않게 id로 되살린다
    const focused = document.activeElement;
    const active = focused && focused.id;
    const textual = focused && (focused.tagName === 'TEXTAREA' || (focused.tagName === 'INPUT' && focused.type === 'text'));
    const sel = textual ? [focused.selectionStart, focused.selectionEnd] : null;
    const list = $('pending');
    if (c.total) list.replaceChildren(...pending.map(card));
    else {
      const empty = el('div', 'empty');
      empty.append(el('p', null, '대기 중인 요청이 없습니다. 세션이 요청 파일을 쓰면 여기에 바로 나타납니다.'), el('p', 'path', state.root + '\\requests'));
      list.replaceChildren(empty);
    }
    const again = active && $(active);
    if (again && again !== focused) {
      again.focus();
      if (sel) again.setSelectionRange(sel[0], sel[1]);
    } else if (!again && /^(approve|reject|confirm|cancel|reason|ch)-/.test(active || '')) {
      // 결정한 카드가 사라지면 다음 카드의 첫 버튼, 없으면 대기 제목으로 포커스를 옮긴다
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
      routineKinds = state.routineKinds || [];
      const ids = new Set(state.pending.map((r) => r.id));
      const added = prev ? state.pending.filter((r) => !prev.has(r.id)).length : 0;
      const decided = [...busy].filter((id) => !ids.has(id)).map((id) => state.recent.find((d) => d.id === id)).filter(Boolean);
      const left = state.pending.length ? `. 남은 대기 ${state.pending.length}건` : '. 대기 요청이 없습니다';
      const word = (d) => (d.decision === 'approved' ? '승인했습니다' : d.decision === 'rejected' ? '거부했습니다' : '답을 보냈습니다');
      if (decided.length) announce(decided.map(word).join(', ') + left);
      else if (added) announce(`새 요청 ${added}건`);
      // 결정이 끝난 카드의 임시 상태를 지운다
      for (const set of [rejecting, busy]) for (const id of [...set]) if (!ids.has(id)) set.delete(id);
      for (const map of [drafts, invalid, errors]) for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id);
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

  $('open-folder').addEventListener('click', () => vscode.postMessage({ type: 'openFolder' }));

  // 경과 시간 표시를 갱신한다. 입력 중에는 건드리지 않는다
  setInterval(() => {
    const f = document.activeElement;
    if (!(f && (f.tagName === 'TEXTAREA' || f.tagName === 'INPUT'))) render();
  }, 30000);

  vscode.postMessage({ type: 'ready' });
})();
