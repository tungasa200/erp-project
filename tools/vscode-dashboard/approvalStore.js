// 승인 센터 저장소: ~/.claude/wy-approvals/ 아래 파일로 요청·결정·토글을 주고받는다.
//   config.json          토글(확장만 쓴다)
//   requests/<id>.json   승인 요청(세션이 쓴다)
//   decisions/<id>.json  결정(확장만 쓴다)
//   used/<id>.json       훅이 결정을 한 번 쓰고 남기는 표시(같은 승인으로 두 번 실행하지 못하게)
// vscode에 의존하지 않아 훅 스크립트와 테스트에서도 쓴다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.WY_APPROVALS_DIR || path.join(os.homedir(), '.claude', 'wy-approvals');
const DIRS = { requests: 'requests', decisions: 'decisions', used: 'used' };
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

// 토글로 자동 승인할 수 있는 종류(커밋, 일반 push). 나머지는 PM 결정이라 항상 사람이 본다
const AUTO_KINDS = ['commit', 'push'];
const KINDS = {
  commit: '커밋',
  push: '푸시',
  'force-push': '강제 푸시',
  branch: '브랜치 생성',
  'delete-branch': '브랜치 삭제',
  merge: '병합',
  reset: 'reset',
  rebase: 'rebase',
  'tag-delete': '태그 삭제',
};
const DEFAULT_CONFIG = { autoApprove: { commit: false, push: false } };

function paths(root = ROOT) {
  return {
    root,
    config: path.join(root, 'config.json'),
    requests: path.join(root, DIRS.requests),
    decisions: path.join(root, DIRS.decisions),
    used: path.join(root, DIRS.used),
  };
}

function ensureDirs(root = ROOT) {
  const p = paths(root);
  for (const d of [p.requests, p.decisions, p.used]) fs.mkdirSync(d, { recursive: true });
  return p;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

// 임시 파일에 쓰고 이름을 바꿔, 읽는 쪽이 반쯤 쓴 파일을 보지 않게 한다
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function readConfig(root = ROOT) {
  try {
    const c = readJson(paths(root).config);
    return { autoApprove: { ...DEFAULT_CONFIG.autoApprove, ...(c && c.autoApprove) }, updatedAt: c.updatedAt };
  } catch {
    return { autoApprove: { ...DEFAULT_CONFIG.autoApprove } };
  }
}

function writeConfig(config, root = ROOT) {
  ensureDirs(root);
  writeJsonAtomic(paths(root).config, { autoApprove: config.autoApprove, updatedAt: new Date().toISOString() });
}

function listJson(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && ID_RE.test(f.slice(0, -5)));
  } catch {
    return [];
  }
}

const normalize = (cmd) => String(cmd || '').trim().replace(/\s+/g, ' ');

// 요청 파일을 화면용 모양으로 고른다. 형식이 틀린 파일은 broken으로 남겨 화면에 알린다
function readRequest(file, id) {
  try {
    const r = readJson(file);
    if (!r || typeof r !== 'object') throw new Error('객체가 아님');
    if (!KINDS[r.kind]) throw new Error(`알 수 없는 종류: ${r.kind}`);
    return {
      id,
      kind: r.kind,
      session: String(r.session || '(세션 미상)'),
      createdAt: r.createdAt || null,
      title: String(r.title || ''),
      branch: r.branch ? String(r.branch) : '',
      command: r.command ? String(r.command) : '',
      commits: Array.isArray(r.commits) ? r.commits.slice(0, 50).map((c) => ({ hash: String(c.hash || ''), subject: String(c.subject || '') })) : [],
      files: Array.isArray(r.files) ? r.files.slice(0, 200).map(String) : [],
      fileCount: Number.isFinite(r.fileCount) ? r.fileCount : Array.isArray(r.files) ? r.files.length : null,
      verification: r.verification ? String(r.verification) : '',
      detail: r.detail ? String(r.detail) : '',
    };
  } catch (err) {
    return { id, broken: err.message };
  }
}

function readState(root = ROOT) {
  const p = paths(root);
  const decisions = new Map();
  for (const f of listJson(p.decisions)) {
    try {
      decisions.set(f.slice(0, -5), readJson(path.join(p.decisions, f)));
    } catch {
      // 확장이 쓰는 중인 파일은 다음 갱신에서 다시 읽는다
    }
  }
  const requests = listJson(p.requests).map((f) => readRequest(path.join(p.requests, f), f.slice(0, -5)));
  const pending = requests.filter((r) => !decisions.has(r.id)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const byId = new Map(requests.map((r) => [r.id, r]));
  const recent = [...decisions.entries()]
    .map(([id, d]) => ({ id, ...d, request: byId.get(id) || null }))
    .sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))
    .slice(0, 10);
  return { root: p.root, config: readConfig(root), pending, recent };
}

function decide(id, decision, { reason = '', by = 'user', root = ROOT } = {}) {
  if (!ID_RE.test(id)) throw new Error('요청 id 형식이 틀림');
  if (decision !== 'approved' && decision !== 'rejected') throw new Error('결정 값이 틀림');
  if (decision === 'rejected' && !String(reason).trim()) throw new Error('거부 사유가 필요함');
  const p = ensureDirs(root);
  const file = path.join(p.decisions, `${id}.json`);
  if (fs.existsSync(file)) throw new Error('이미 결정된 요청');
  const req = readRequest(path.join(p.requests, `${id}.json`), id);
  if (req.broken) throw new Error('요청 파일을 읽지 못함');
  const out = {
    id,
    decision,
    reason: String(reason).trim(),
    by,
    kind: req.kind,
    command: normalize(req.command),
    decidedAt: new Date().toISOString(),
  };
  writeJsonAtomic(file, out);
  return out;
}

// 토글이 켜진 종류의 대기 요청을 자동 승인한다. 승인한 id 목록을 돌려준다
function autoApprove(state, root = ROOT) {
  const done = [];
  for (const r of state.pending) {
    if (!r.broken && AUTO_KINDS.includes(r.kind) && state.config.autoApprove[r.kind]) {
      try {
        decide(r.id, 'approved', { by: 'auto', root });
        done.push(r.id);
      } catch {
        // 이미 결정됐으면 넘어간다
      }
    }
  }
  return done;
}

module.exports = { ROOT, KINDS, AUTO_KINDS, ID_RE, paths, ensureDirs, readJson, writeJsonAtomic, readConfig, writeConfig, readState, decide, autoApprove, normalize };
