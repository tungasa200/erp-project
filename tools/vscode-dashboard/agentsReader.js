// 세션 상태 읽기(운영 도구 구현 계획 2.2, 담당 WY-backend1): claude agents 목록에 권한 요청 파일과 세션 등록 기록을 붙여
// 화면이 바로 쓸 수 있는 상태(view)로 바꾼다. vscode에 의존하지 않아 훅(B2)·활동 탭(B3)·테스트에서도 쓴다.
//   readSessionStatus({ root, ops }) → [{ name, id, sessionId, kind, state, status, waitingFor, view, pending, roleMissing, startedAt, alive }]
//   view: working(일하는 중) · idle(대기) · input(입력 대기) · permission(권한 대기) · stopped(멈춤) · ended(대기 중 종료됨) · failed(오류)
const { execFile } = require('child_process');
const { listPermissionRequests, readSessionRegistry } = require('./approvalStore');

const COMMAND_TIMEOUT = 8000;

// waitingFor 중 사람이 도구 실행을 허용해야 하는 것(U-01). 'dialog open'(질문 대화상자)·'input needed'는 입력 대기(U-05)
const PERMISSION_WAITS = ['permission prompt', 'sandbox request', 'worker request'];
const INPUT_WAITS = ['dialog open', 'input needed'];

const lower = (v) => String(v || '').toLowerCase();

// claude는 npm .cmd 래퍼라 cmd.exe로 실행한다. stderr는 CP949라 글자가 깨지므로 오류 문구는 종료 코드로만 만든다
function readAgents() {
  return new Promise((resolve, reject) => {
    execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'claude agents --json --all'],
      { timeout: COMMAND_TIMEOUT, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          if (err.killed) reject(new Error(`claude agents 응답 없음(${COMMAND_TIMEOUT / 1000}초)`));
          else if (err.code === 'ENOENT') reject(new Error('claude agents 명령을 찾을 수 없음'));
          else reject(new Error(`claude agents 실패(종료 코드 ${err.code})`));
          return;
        }
        try {
          const list = JSON.parse(stdout);
          if (!Array.isArray(list)) throw new Error();
          resolve(list);
        } catch {
          reject(new Error('claude agents 출력을 해석하지 못함'));
        }
      });
  });
}

// 살아 있는 세션: interactive는 목록에 있으면 실행 중, 백그라운드는 프로세스(pid)나 status가 있을 때.
// --all이 함께 주는 끝난 백그라운드는 state만 있고 pid·status가 없다
function isAlive(s) {
  return s.kind === 'interactive' || s.pid != null || !!s.status;
}

// 이 이름의 세션이 지금 메시지를 받을 수 있는가(B2 SendMessage 훅과 같은 기준)
function isReachable(list, name) {
  return (list || []).some((s) => s && s.name === name && isAlive(s));
}

// 이름마다 한 줄: 살아 있는 것 우선, 그다음 최신 startedAt (교대 전 세션은 숨긴다)
function latestByName(list) {
  const best = new Map();
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const name = s.name || '(이름 없음)';
    const cur = best.get(name);
    let better;
    if (!cur) better = true;
    else if (isAlive(s) !== isAlive(cur)) better = isAlive(s);
    else better = (s.startedAt || 0) > (cur.startedAt || 0);
    if (better) best.set(name, s);
  }
  return best;
}

function viewOf(s, hasPending) {
  const st = lower(s.state);
  const wf = lower(s.waitingFor);
  const alive = isAlive(s);
  if (['failed', 'error', 'crashed'].includes(st)) return 'failed';
  if (PERMISSION_WAITS.includes(wf)) return 'permission';
  // 권한 요청 파일만 있을 때는 살아 있는 세션만 인정한다(훅이 기다리다 세션이 죽으면 파일이 남는다)
  if (hasPending && alive) return 'permission';
  if (['stopped', 'exited', 'killed'].includes(st)) return 'stopped';
  if (!alive) return st === 'done' ? 'ended' : 'stopped';
  if (INPUT_WAITS.includes(wf) || st === 'blocked') return 'input';
  const status = lower(s.status);
  if (st === 'done' || status === 'waiting') return 'input';
  if (['working', 'running', 'starting'].includes(st) || status === 'busy') return 'working';
  return 'idle';
}

// 결정 전이고 만료되지 않은 권한 요청 중 세션마다 가장 최근 것
function pendingBySession(requests, now) {
  const out = new Map();
  for (const r of requests || []) {
    if (!r || !r.sessionId || r.decision) continue;
    const exp = Date.parse(r.expiresAt);
    if (!Number.isNaN(exp) && exp <= now) continue;
    const cur = out.get(r.sessionId);
    if (!cur || String(r.createdAt) > String(cur.createdAt)) out.set(r.sessionId, r);
  }
  return out;
}

// 역할 누락: --agent로 띄워야 하는 역할(wy-ops.json roles의 agent:true)인데 등록 기록의 agentType이 다르다.
// 등록 기록이 없으면(훅 설치 전에 뜬 세션) 판단하지 않는다
function roleMissingOf(s, ops, registry) {
  const role = ops && Array.isArray(ops.roles) && ops.roles.find((r) => r && r.name === s.name);
  if (!role || !role.agent) return false;
  const rec = s.sessionId && registry && registry.get(s.sessionId);
  return !!rec && rec.agentType !== s.name;
}

function buildStatus(list, { requests = [], registry = new Map(), ops = null, now = Date.now() } = {}) {
  const pending = pendingBySession(requests, now);
  return [...latestByName(list || []).entries()].map(([name, s]) => {
    const p = s.sessionId ? pending.get(s.sessionId) : undefined;
    const view = viewOf(s, !!p);
    return {
      name,
      id: s.id || (s.sessionId || '').slice(0, 8) || null,
      sessionId: s.sessionId || null,
      kind: s.kind,
      state: s.state,
      status: s.status,
      waitingFor: s.waitingFor,
      view,
      pending: view === 'permission' && p ? { key: p.key, tool: p.tool, command: p.command } : null,
      roleMissing: roleMissingOf(s, ops, registry),
      startedAt: s.startedAt,
      alive: isAlive(s),
    };
  });
}

// 승인 폴더를 읽지 못해도 세션 목록은 보여 준다
function safe(fn, fallback) {
  try {
    return fn() || fallback;
  } catch {
    return fallback;
  }
}

async function readSessionStatus({ root, ops = null, list } = {}) {
  const agents = list || (await readAgents());
  return buildStatus(agents, {
    requests: safe(() => listPermissionRequests(root), []),
    registry: safe(() => readSessionRegistry(root), new Map()),
    ops,
  });
}

module.exports = { readSessionStatus, readAgents, buildStatus, isReachable, isAlive, PERMISSION_WAITS, INPUT_WAITS };
