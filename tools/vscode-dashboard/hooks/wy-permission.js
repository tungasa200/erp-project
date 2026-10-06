#!/usr/bin/env node
// 권한 카드 훅(OPS-02 ①, 운영 도구 구현 계획 B2-4)
//   PermissionRequest: 확인 창이 뜰 상황이면 승인 센터에 권한 카드를 올리고, 결정을 기다려 허용·거부를 돌려준다.
//   PermissionDenied: 분류기가 막은 명령을 할 일 카드(직접 실행)로 올린다. 이미 막힌 결정은 뒤집지 않는다.
// 2026-10-07 실험: 훅 입력에 tool_use_id가 없다 → 결정 키는 sha1(session_id·tool_name·tool_input) 앞 16자.
// 같은 명령을 다시 요청하면 앞 카드가 이미 결정·사용됐을 때 -2, -3…을 붙여 새 카드로 만든다.
// 허용은 그 한 번만(updatedPermissions 안 씀). 15분 안에 결정이 없으면 사유와 함께 거부한다(Q1, 2026-10-07 사용자 결정).
// 결정 파일은 확장만 쓴다. 이 훅은 used/<id>.json(사용·시간 초과 표시)만 쓴다.
// 오류가 나면 아무것도 돌려주지 않는다 → 평소 흐름(확인 창). 자동 허용은 하지 않는다.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('../approvalStore');

const WAIT_MS = Number(process.env.WY_PERMISSION_WAIT_MS) || 15 * 60 * 1000; // 테스트에서 줄인다
const POLL_MS = 1000;

const keyOf = (input) =>
  crypto.createHash('sha1').update([input.session_id, input.tool_name, JSON.stringify(input.tool_input || {})].join('|')).digest('hex').slice(0, 16);

// 사람이 읽을 명령 한 줄
function commandOf(input) {
  const t = input.tool_input || {};
  if (typeof t.command === 'string') return t.command;
  if (typeof t.file_path === 'string') return `${input.tool_name} ${t.file_path}`;
  return `${input.tool_name} ${JSON.stringify(t).slice(0, 300)}`;
}

// 세션 이름(claude agents). 못 찾으면 null
function sessionNameOf(sessionId) {
  try {
    const r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'claude agents --json --all'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const hit = JSON.parse(r.stdout).find((a) => a.sessionId === sessionId);
    return (hit && hit.name) || null;
  } catch {
    return null;
  }
}

// 아직 결정·사용·만료되지 않은 같은 키의 카드가 있으면 그것을 이어서 기다리고, 없으면 새 id를 정한다
function pickId(p, key) {
  for (let n = 1; n < 100; n++) {
    const id = n === 1 ? `perm-${key}` : `perm-${key}-${n}`;
    const req = path.join(p.requests, `${id}.json`);
    if (!fs.existsSync(req)) return { id, reuse: false };
    const done = fs.existsSync(path.join(p.decisions, `${id}.json`)) || fs.existsSync(path.join(p.used, `${id}.json`));
    if (!done) return { id, reuse: true };
  }
  throw new Error('같은 명령의 권한 카드가 너무 많음');
}

function writeRequest(p, id, input, now) {
  const command = commandOf(input);
  const sessionName = sessionNameOf(input.session_id);
  const who = sessionName || `세션 ${String(input.session_id || '').slice(0, 8)}`;
  store.writeJsonAtomic(path.join(p.requests, `${id}.json`), {
    kind: 'permission',
    key: id.slice('perm-'.length),
    session: who,
    sessionId: input.session_id || null,
    sessionName,
    tool: input.tool_name,
    toolInput: input.tool_input || {},
    command,
    permissionMode: input.permission_mode || null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + WAIT_MS).toISOString(),
    title: `${who}: ${input.tool_name} 실행 허용`,
    what: command,
    why: `${who} 세션이 이 도구를 실행하려고 확인을 기다립니다(ask 규칙·보호 경로 등).`,
    onClick: '허용: 이 한 번만 실행됩니다. 거부: 사유가 세션에 전달되고 실행하지 않습니다. 15분 안에 결정이 없으면 거부됩니다.',
  });
}

function markUsed(p, id, body) {
  fs.mkdirSync(p.used, { recursive: true });
  fs.writeFileSync(path.join(p.used, `${id}.json`), JSON.stringify({ id, at: new Date().toISOString(), ...body }) + '\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function onPermissionRequest(input, root) {
  const p = store.ensureDirs(root);
  const key = keyOf(input);
  const { id, reuse } = pickId(p, key);
  const now = new Date();
  if (!reuse) writeRequest(p, id, input, now);
  const deadline = now.getTime() + WAIT_MS;
  const decisionFile = path.join(p.decisions, `${id}.json`);
  while (Date.now() < deadline) {
    if (fs.existsSync(decisionFile)) {
      let d;
      try {
        d = store.readJson(decisionFile);
      } catch {
        await sleep(POLL_MS); // 쓰는 중이면 다시 읽는다
        continue;
      }
      markUsed(p, id, { decision: d.decision, sessionId: input.session_id || null });
      if (d.decision === 'approved') return { behavior: 'allow' };
      return { behavior: 'deny', message: `승인 센터에서 거부됨: ${d.reason || '사유 없음'}` };
    }
    await sleep(POLL_MS);
  }
  markUsed(p, id, { decision: 'expired', sessionId: input.session_id || null });
  return { behavior: 'deny', message: '승인 센터에서 15분 동안 결정이 없어 거부했습니다. 다시 요청하거나 할 일 카드로 올리세요.' };
}

function onPermissionDenied(input, root) {
  const p = store.ensureDirs(root);
  const id = `denied-${keyOf(input)}`;
  if (fs.existsSync(path.join(p.requests, `${id}.json`))) return;
  const command = commandOf(input);
  const sessionName = sessionNameOf(input.session_id);
  const who = sessionName || `세션 ${String(input.session_id || '').slice(0, 8)}`;
  store.writeJsonAtomic(path.join(p.requests, `${id}.json`), {
    kind: 'todo',
    session: who,
    sessionId: input.session_id || null,
    createdAt: new Date().toISOString(),
    title: `${who}: 분류기가 막은 명령 직접 실행`,
    what: command,
    why: `자동 판단(분류기)이 이 명령을 막았습니다${input.reason ? `: ${input.reason}` : ''}. 훅으로 뒤집지 않으므로 사람이 직접 실행할지 정해야 합니다.`,
    onClick: '했음: 명령을 직접 실행했거나 필요 없다고 정했음을 세션에 알립니다.',
    steps: ['명령을 확인하고 필요하면 VS Code 터미널에서 직접 실행합니다.', `실행할 명령: ${command}`],
  });
}

function respond(decision) {
  if (decision) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
  process.exit(0);
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', async () => {
    try {
      const input = JSON.parse(raw);
      const root = store.rootFor(input.cwd || process.cwd());
      if (input.hook_event_name === 'PermissionDenied') {
        onPermissionDenied(input, root);
        process.exit(0);
      }
      respond(await onPermissionRequest(input, root));
    } catch (err) {
      // 판단하지 못하면 평소 흐름으로 둔다(허용하지 않음)
      process.stderr.write(`WY 권한 훅 오류: ${err.message}\n`);
      process.exit(0);
    }
  });
}

module.exports = { keyOf, commandOf, pickId, onPermissionRequest, onPermissionDenied };
