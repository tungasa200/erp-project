// 메시지 대상 확인 훅(B2-6) 검사
//   node tools/vscode-dashboard/test/hooks-message.test.js
const assert = require('assert');
const { check, nameOf } = require('../hooks/wy-message-guard.js');

const bg = (name, state, alive, startedAt) => ({ name, kind: 'background', state, startedAt, ...(alive ? { pid: 1, status: 'idle' } : {}) });
const list = [
  bg('WY-qa', 'done', false, 1),
  bg('WY-commit', 'done', false, 1),
  bg('WY-commit', 'working', true, 2), // 교대 뒤 새 세션
  bg('WY-design', 'stopped', false, 3),
  bg('WY-design', 'failed', false, 5),
  { name: 'WY-pm', kind: 'interactive', state: 'working', startedAt: 1 },
];

assert.strictEqual(nameOf('WY-qa [3fa9c1]'), 'WY-qa');
assert.strictEqual(nameOf(' WY-qa '), 'WY-qa');

const qa = check(list, 'WY-qa');
assert.strictEqual(qa && qa.decision, 'deny', '끝난 세션은 거부');
assert.ok(qa.reason.includes('session.ps1 start WY-qa') && qa.reason.includes('done'), '사유에 상태·다시 띄우는 법');
assert.ok(check(list, 'WY-qa [abc123]'), 'ref가 붙어도 같은 판단');
assert.ok(check(list, 'WY-design').reason.includes('failed'), '가장 최근 세션의 상태');
assert.strictEqual(check(list, 'WY-commit'), null, '같은 이름의 살아 있는 세션이 있으면 통과');
assert.strictEqual(check(list, 'WY-pm'), null, '대화형은 통과');
assert.strictEqual(check(list, 'WY-backend9'), null, '목록에 없는 이름은 통과(하위 에이전트·팀원)');
assert.strictEqual(check(list, 'main'), null, 'main은 통과');
assert.strictEqual(check([], 'WY-qa'), null, '빈 목록은 통과');
assert.strictEqual(check(null, ''), null, '대상 없음은 통과');

console.log('message 훅 검사 통과');
