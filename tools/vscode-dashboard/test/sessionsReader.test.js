// 세션 상태 읽기(agentsReader, B1-1·B1-3): 상태 조합 표, 이름 중복 정리, 권한 요청 붙이기, 역할 누락, 메시지 도달 여부.
//   node tools/vscode-dashboard/test/sessionsReader.test.js
const assert = require('assert');
const { buildStatus, isReachable } = require('../agentsReader');

const NOW = Date.parse('2026-10-07T12:00:00Z');
const bg = (name, extra) => ({ name, kind: 'background', id: name.slice(-8), sessionId: `${name}-sid`, startedAt: 1, ...extra });
const live = (name, extra) => bg(name, { pid: 100, status: 'busy', state: 'working', ...extra });
const view = (s, opts) => buildStatus([s], { now: NOW, ...opts })[0].view;

// 1. 상태 조합 표 (U-01·U-05, B2 답 Q2와 ended 추가)
const table = [
  ['일하는 중', live('a'), 'working'],
  ['권한 확인 창', live('a', { state: 'blocked', status: 'waiting', waitingFor: 'permission prompt' }), 'permission'],
  ['샌드박스 허용', live('a', { state: 'blocked', status: 'waiting', waitingFor: 'sandbox request' }), 'permission'],
  ['작업자 요청', live('a', { state: 'blocked', status: 'waiting', waitingFor: 'worker request' }), 'permission'],
  ['질문 대화상자는 입력 대기(U-05)', live('a', { state: 'blocked', status: 'waiting', waitingFor: 'dialog open' }), 'input'],
  ['다음 지시 기다림', live('a', { state: 'blocked', status: 'waiting', waitingFor: 'input needed' }), 'input'],
  ['일을 마치고 살아 있음', live('a', { state: 'done', status: 'idle' }), 'input'],
  ['claude stop으로 멈춤', bg('a', { state: 'stopped' }), 'stopped'],
  ['기다리다 저절로 끝남', bg('a', { state: 'done' }), 'ended'],
  ['오류', bg('a', { state: 'failed' }), 'failed'],
  ['VS Code 세션 작업 중', { name: 'p', kind: 'interactive', pid: 1, status: 'busy' }, 'working'],
  ['VS Code 세션 쉬는 중', { name: 'p', kind: 'interactive', pid: 1, status: 'idle' }, 'idle'],
];
for (const [label, s, want] of table) assert.strictEqual(view(s), want, label);

// 2. 이름마다 한 줄: 살아 있는 것 우선, 그다음 최신 startedAt
{
  const rows = buildStatus([
    bg('WY-qa', { state: 'done', startedAt: 30, id: 'old1' }),
    live('WY-qa', { startedAt: 10, id: 'live1' }),
    bg('WY-design', { state: 'stopped', startedAt: 5, id: 'd1' }),
    bg('WY-design', { state: 'done', startedAt: 9, id: 'd2' }),
  ], { now: NOW });
  assert.strictEqual(rows.length, 2, '이름마다 한 줄');
  assert.strictEqual(rows.find((r) => r.name === 'WY-qa').id, 'live1', '살아 있는 것 우선');
  const d = rows.find((r) => r.name === 'WY-design');
  assert.deepStrictEqual([d.id, d.view], ['d2', 'ended'], '모두 끝났으면 최신');
}

// 3. 권한 요청 파일: 최신 하나, 결정·만료는 빼고, 살아 있는 세션만 (B2 답 Q2·Q3)
{
  const req = (createdAt, extra) => ({ key: `k${createdAt}`, sessionId: 'a-sid', tool: 'Bash', command: `echo ${createdAt}`,
    createdAt: `2026-10-07T11:5${createdAt}:00Z`, expiresAt: '2026-10-07T12:10:00Z', decision: null, ...extra });
  const requests = [req(1), req(3), req(4, { decision: 'approved' }), req(5, { expiresAt: '2026-10-07T11:59:00Z' })];
  const [row] = buildStatus([live('a')], { requests, now: NOW });
  assert.strictEqual(row.view, 'permission', '파일만 있어도 살아 있으면 권한 대기');
  assert.deepStrictEqual(row.pending, { key: 'k3', tool: 'Bash', command: 'echo 3' }, '결정 전·만료 전 중 최신');

  assert.strictEqual(view(bg('a', { state: 'done' }), { requests }), 'ended', '죽은 세션의 남은 파일은 무시');
  const [moved] = buildStatus([live('a')], { requests: [req(4, { decision: 'approved' })], now: NOW });
  assert.deepStrictEqual([moved.view, moved.pending], ['working', null], '결정되면 표시가 사라짐');
  const [noFile] = buildStatus([live('a', { state: 'blocked', waitingFor: 'permission prompt' })], { now: NOW });
  assert.deepStrictEqual([noFile.view, noFile.pending], ['permission', null], '파일이 없으면 명령 없이 권한 대기');
}

// 4. 역할 누락(OPS-06 4): agent:true 역할인데 등록 기록의 agentType이 다름. 기록이 없으면 판단하지 않음
{
  const ops = { roles: [{ name: 'WY-commit', agent: true }, { name: 'WY-pm', agent: false }] };
  const registry = new Map([
    ['WY-commit-sid', { sessionId: 'WY-commit-sid', agentType: null }],
    ['WY-pm-sid', { sessionId: 'WY-pm-sid', agentType: null }],
    ['WY-qa-sid', { sessionId: 'WY-qa-sid', agentType: 'WY-qa' }],
  ]);
  const rows = buildStatus([live('WY-commit'), live('WY-pm'), live('WY-qa'), live('WY-design')], { ops, registry, now: NOW });
  const missing = Object.fromEntries(rows.map((r) => [r.name, r.roleMissing]));
  assert.deepStrictEqual(missing, { 'WY-commit': true, 'WY-pm': false, 'WY-qa': false, 'WY-design': false });
  const ok = buildStatus([live('WY-commit')], { ops, registry: new Map([['WY-commit-sid', { agentType: 'WY-commit' }]]), now: NOW });
  assert.strictEqual(ok[0].roleMissing, false, '역할이 맞으면 표시 없음');
}

// 5. 메시지를 받을 수 있는가(B2 SendMessage 훅과 같은 기준)
{
  const list = [bg('WY-commit', { state: 'done' }), live('WY-qa'), bg('WY-qa', { state: 'done', startedAt: 99 }),
    { name: 'WY-pm', kind: 'interactive', pid: 1, status: 'idle' }];
  assert.strictEqual(isReachable(list, 'WY-commit'), false, '끝난 세션');
  assert.strictEqual(isReachable(list, 'WY-qa'), true, '살아 있는 줄이 하나라도 있으면');
  assert.strictEqual(isReachable(list, 'WY-pm'), true, 'VS Code 세션');
  assert.strictEqual(isReachable(list, 'WY-browser'), false, '목록에 없음');
}

// 6. 모르는 형식은 멈추지 않는다
assert.deepStrictEqual(buildStatus([null, 3, { kind: 'background', state: 'weird' }], { now: NOW }).map((r) => r.view), ['stopped']);

console.log('sessionsReader 검사 통과');
