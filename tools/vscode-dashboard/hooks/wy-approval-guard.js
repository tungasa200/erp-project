#!/usr/bin/env node
// WY 승인 가드(PreToolUse 훅, Bash·PowerShell). 초안 — 적용은 사용자 설정에서 한다.
// - 잠금 대상 git 명령: commit·push·강제 푸시·브랜치 생성/삭제·merge(gh pr merge)·reset·rebase·태그 삭제. 모두 승인 센터의 승인 결정이 있어야 한다.
// - 잠금 대상은 WY-commit(agent_type)만 실행한다. agent_type이 없는 세션도 거부한다.
// - 승인 한 건은 한 번만 쓴다(used/<id>.json).
// - 승인 파일(decisions/·decisions.log·used/)과 설치본(~/.wy-tools)에 쓰는 셸 명령은 막는다. 읽기(cat·ls·tail·test, 감시 루프)는 통과한다.
// 훅은 오류·시간 초과 때 통과시키므로(fail open), 여기서는 어떤 오류든 종료 코드 2로 막는다.
const fs = require('fs');
const path = require('path');
const store = require('../approvalStore');
const { loadOpsConfig } = require('../opsConfig');

// 기본값. 훅 입력의 cwd에서 프로젝트 설정(.claude/wy-ops.json)을 찾으면 commitRole·approvals.ttlMinutes를 쓴다
const DEFAULT_TTL_MINUTES = 60; // 결정 후 이 시간 안에만 쓸 수 있다
const DEFAULT_COMMIT_SESSION = 'WY-commit';
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
const PROTECTED = ['wy-approvals/config.json', 'wy-approvals/decisions', 'wy-approvals/used', '.wy-tools/'];
// 파일을 쓰거나 지울 수 있는 프로그램(PowerShell 별칭 포함). 인터프리터는 무엇이든 쓸 수 있어 함께 막는다
const WRITERS = new Set([
  'cp', 'mv', 'rm', 'rmdir', 'del', 'erase', 'copy', 'move', 'ren', 'rename', 'touch', 'mkdir', 'tee', 'truncate', 'dd', 'install', 'ln', 'chmod', 'chown', 'xargs',
  'set-content', 'sc', 'add-content', 'ac', 'out-file', 'new-item', 'ni', 'remove-item', 'ri', 'rd', 'copy-item', 'cpi', 'move-item', 'mi',
  'rename-item', 'rni', 'clear-content', 'clc', 'set-item', 'si', 'tee-object',
  'node', 'python', 'python3', 'py', 'perl', 'ruby', 'deno', 'bun', 'powershell', 'pwsh', 'cmd', 'bash', 'sh', 'invoke-expression', 'iex',
]);
const LEADING_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'until', 'while', 'if', '!', '{', '(', 'time', 'exec', 'sudo', 'env', '&']);

// 명령을 &&, ||, ;, |, 줄바꿈으로 나눈다(따옴표 안은 나누지 않는다)
function segments(command) {
  const out = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && command[i + 1] === '&')) {
      if (ch === '&' || (ch === '|' && command[i + 1] === '|')) i++;
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function tokens(segment) {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^["']|["']$/g, ''));
}

// 한 조각이 잠금 대상이면 종류를, 아니면 null
function classify(segment) {
  let t = tokens(segment);
  while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t = t.slice(1); // 앞의 VAR=값
  if (!t.length) return null;
  const prog = path.basename(t[0]).toLowerCase().replace(/\.exe$/, '');
  if (prog === 'gh') return t[1] === 'pr' && t[2] === 'merge' ? 'merge' : null;
  if (prog !== 'git') return null;
  let i = 1;
  while (i < t.length && t[i].startsWith('-')) {
    i += GIT_OPTS_WITH_VALUE.has(t[i]) ? 2 : 1;
  }
  const sub = t[i];
  const rest = t.slice(i + 1);
  const has = (...flags) => rest.some((a) => flags.includes(a) || flags.some((f) => f.endsWith('=') && a.startsWith(f)));
  const positional = rest.filter((a) => !a.startsWith('-'));
  switch (sub) {
    case 'commit':
      return 'commit';
    case 'push':
      // 원격 브랜치를 지우는 push(--delete, :브랜치, --prune)는 브랜치 삭제로 본다
      if (has('--delete', '-d', '--prune') || positional.some((a) => a.startsWith(':'))) return 'delete-branch';
      if (has('-f', '--force', '--force-with-lease', '--force-with-lease=', '--force-if-includes', '--mirror') || positional.some((a) => a.startsWith('+'))) return 'force-push';
      return 'push';
    case 'merge':
    case 'rebase':
      return has('--abort', '--quit') ? null : sub; // 되돌리기는 잠그지 않는다
    case 'reset':
      return 'reset';
    case 'branch':
      if (has('-d', '-D', '--delete')) return 'delete-branch';
      if (has('-l', '--list', '-a', '--all', '-r', '--remotes', '--show-current', '-v', '-vv', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--format=', '--sort=', '--column', '--no-column')) return null;
      return positional.length || has('-m', '-M', '-c', '-C', '--move', '--copy') ? 'branch' : null;
    case 'checkout':
      return has('-b', '-B', '--orphan') ? 'branch' : null;
    case 'switch':
      return has('-c', '-C', '--create', '--force-create', '--orphan') ? 'branch' : null;
    case 'tag':
      return has('-d', '--delete') ? 'tag-delete' : null;
    default:
      return null;
  }
}

const mentionsProtected = (t) => {
  const c = t.replace(/\\/g, '/').toLowerCase();
  return PROTECTED.some((p) => c.includes(p));
};

// 보호 경로에 쓰는 명령인지 본다. 경로를 읽기만 하는 명령은 통과시킨다
function writesApprovalFiles(command) {
  if (!mentionsProtected(command)) return false;
  // 리다이렉트 대상(> >> 2> *>)
  for (const m of command.matchAll(/>{1,2}\s*("[^"]*"|'[^']*'|[^\s|;&<>]+)/g)) if (mentionsProtected(m[1])) return true;
  for (const seg of segments(command)) {
    if (!mentionsProtected(seg)) continue;
    let t = tokens(seg);
    while (t.length && (LEADING_KEYWORDS.has(t[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]))) t = t.slice(1);
    if (!t.length) continue;
    if (/^\[[\w.]+\]::/.test(t[0])) return true; // [IO.File]::WriteAllText 같은 .NET 호출
    const prog = path.basename(t[0]).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
    const rest = t.slice(1);
    if (WRITERS.has(prog)) return true;
    if (prog === 'sed' && rest.some((a) => a.startsWith('-i') || a === '--in-place')) return true;
    if (prog === 'find' && rest.some((a) => ['-delete', '-exec', '-execdir', '-ok'].includes(a))) return true;
  }
  return false;
}

// 같은 종류·같은 명령으로 승인된, 아직 쓰지 않은 결정을 찾는다(taken에 든 것은 건너뛴다)
function findApproval(kind, segment, taken, root, ttlMs) {
  const p = store.paths(root);
  const want = store.normalize(segment);
  let files = [];
  try {
    files = fs.readdirSync(p.decisions).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }
  for (const f of files) {
    const id = f.slice(0, -5);
    if (!store.ID_RE.test(id) || taken.has(id) || fs.existsSync(path.join(p.used, f))) continue;
    let d;
    try {
      d = store.readJson(path.join(p.decisions, f));
    } catch {
      continue;
    }
    const fresh = Date.now() - Date.parse(d.decidedAt) < ttlMs;
    if (d.decision === 'approved' && d.kind === kind && store.normalize(d.command) === want && fresh) return id;
  }
  return null;
}

function markUsed(ids, input, root) {
  const p = store.paths(root);
  fs.mkdirSync(p.used, { recursive: true });
  for (const id of ids) {
    fs.writeFileSync(path.join(p.used, `${id}.json`), JSON.stringify({ id, usedAt: new Date().toISOString(), session_id: input.session_id || null }) + '\n');
  }
}

function evaluate(input, root = store.ROOT) {
  const command = String((input.tool_input && input.tool_input.command) || '');
  if (!command) return null;
  if (writesApprovalFiles(command)) {
    return { decision: 'deny', reason: '승인 파일(~/.claude/wy-approvals의 decisions·decisions.log·used)과 설치본(~/.wy-tools)에는 셸 명령으로 쓸 수 없습니다. 읽기(cat·ls·tail·test)는 됩니다. 요청은 requests/에만 쓰세요.' };
  }
  const guarded = segments(command).map((s) => ({ segment: s, kind: classify(s) })).filter((g) => g.kind);
  if (!guarded.length) return null;
  const ops = loadOpsConfig(input.cwd || process.cwd());
  const COMMIT_SESSION = (ops && typeof ops.commitRole === 'string' && ops.commitRole) || DEFAULT_COMMIT_SESSION;
  const ttlMinutes = Number(ops && ops.approvals && ops.approvals.ttlMinutes);
  const ttlMs = (ttlMinutes > 0 ? ttlMinutes : DEFAULT_TTL_MINUTES) * 60 * 1000;
  if (input.agent_type !== COMMIT_SESSION) {
    const who = input.agent_type || 'agent_type 없음';
    return { decision: 'deny', reason: `'${store.KINDS[guarded[0].kind]}' 명령은 ${COMMIT_SESSION}(--agent ${COMMIT_SESSION}로 띄운 세션)만 실행합니다(이 세션: ${who}). 커밋 요청은 ${COMMIT_SESSION}에 보내세요.` };
  }
  // 조각마다 승인을 먼저 다 찾고, 모두 있을 때만 한꺼번에 사용 표시를 남긴다(일부만 쓰고 막히면 승인이 헛되이 사라진다)
  const taken = new Set();
  for (const g of guarded) {
    const id = findApproval(g.kind, g.segment, taken, root, ttlMs);
    if (!id) {
      return {
        decision: 'deny',
        reason: `승인이 없습니다: ${store.KINDS[g.kind]} "${store.normalize(g.segment)}". ~/.claude/wy-approvals/requests/에 요청 파일을 쓰고(command에 이 명령 그대로) 승인 센터의 결정을 기다린 뒤 다시 실행하세요.`,
      };
    }
    taken.add(id);
  }
  markUsed(taken, input, root);
  return { decision: 'allow', reason: `승인 센터 결정 ${[...taken].join(', ')}` };
}

function respond(result) {
  if (!result) process.exit(0); // 잠금 대상이 아니면 평소 권한 흐름대로
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: result.decision, permissionDecisionReason: result.reason } };
  process.stdout.write(JSON.stringify(out));
  if (result.decision === 'deny') {
    process.stderr.write(result.reason + '\n');
    process.exit(2);
  }
  process.exit(0);
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      respond(evaluate(JSON.parse(raw)));
    } catch (err) {
      // 판단을 못 하면 막는다. 잠금 대상이 아니었더라도 원인을 알 수 있게 사유를 남긴다
      process.stderr.write(`WY 승인 가드 오류로 막았습니다: ${err.message}\n`);
      process.exit(2);
    }
  });
}

module.exports = { segments, classify, evaluate, writesApprovalFiles };
