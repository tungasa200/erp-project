// 승인 가드 훅 쓰기 판단 검사: 보호 경로에 쓰는 명령은 거부, 읽기·다른 파일에 쓰기는 통과
//   node tools/vscode-dashboard/test/guard.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
process.env.WY_APPROVALS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wy-guard-'));
const { evaluate, classify, writesApprovalFiles } = require('../hooks/wy-approval-guard.js');

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL ' + m); } };
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'wy-guard-proj-'));
// 와일드카드 검사용: 프로젝트 안에 보호 파일과 승인 폴더 모양을 만든다
fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
fs.writeFileSync(path.join(proj, '.claude', 'wy-ops.json'), '{}');
fs.mkdirSync(path.join(proj, 'h', '.claude', 'wy-approvals', 'erp-project', 'decisions'), { recursive: true });
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.writeFileSync(path.join(proj, 'src', 'a.log'), '');
const ev = (cmd) => evaluate({ tool_name: 'Bash', tool_input: { command: cmd }, agent_type: 'WY-backend2', cwd: proj, session_id: 's' });
const W = String.raw;
const NL = '\n';

const deny = [
  // 보호 경로에 직접 쓰기
  'echo x > .claude/wy-ops.json',
  'echo x >> C:/projects/erp-project/.claude/wy-ops.local.json',
  W`Set-Content .claude\settings.local.json '{}'`,
  'sed -i s/a/b/ .claude/wy-ops.json',
  'cp x .claude/settings.local.json',
  'rm -rf ~/.claude/wy-approvals/erp-project/used',
  'echo {} > ~/.claude/wy-approvals/erp-project/decisions/x.json',
  'echo x >> ~/.claude/wy-approvals/erp-project/decisions.log',
  'echo {} > ~/.claude/wy-approvals/decisions/x.json',
  'cp a ~/.wy-tools/vscode-dashboard/x',
  W`[IO.File]::WriteAllText(".claude/wy-ops.json", "{}")`,
  // 인터프리터 쓰기 API·난독화
  `node -e "require('fs').writeFileSync('.claude/wy-ops.json','{}')"`,
  `node -e "const fs=require('fs');fs.writeFileSync(process.env.HOME+'/.claude/wy-approvals/erp-project/decisions/a.json','{}')"`,
  `node -e "require('fs').appendFileSync('.claude/settings.local.json','x')"`,
  `node -e "const f=require('fs');f['write'+'FileSync']('.claude/wy-ops.json','{}')"`,
  `node -e "require('fs').renameSync('x','.claude/wy-ops.json')"`,
  `python -c "open('.claude/settings.local.json','w').write('{}')"`,
  `python -c "import json;json.dump({},open('.claude/wy-ops.json',mode='a'))"`,
  `python -c "import os;os.remove('.claude/settings.local.json')"`,
  `python -c "getattr(__import__('os'),'remove')('.claude/wy-ops.json')"`,
  W`powershell -Command "Get-Content .claude/wy-ops.json | Set-Content .claude/wy-ops.local.json"`,
  `node -e "eval(atob('...'))" .claude/wy-ops.json`,
  `node .claude/wy-ops.json`,
  `bash -c "true" .claude/settings.local.json`,
  // 변수·알 수 없는 대상으로 우회
  W`$p='.claude/settings.local.json'; Set-Content $p '{}'`,
  W`$p = "C:\Users\k\.claude\wy-approvals\erp-project\decisions\a.json"; Out-File -FilePath $p -InputObject x`,
  'p=.claude/wy-ops.json; cp x $p',
  'f=.claude/wy-ops.json; echo {} > "$f"',
  'f=~/.claude/wy-approvals/erp-project/decisions/a.json; echo x > $(echo $f)',
  W`set P=.claude\wy-ops.json & echo x > %P%`,
  // 보호 폴더로 이동한 뒤 상대 경로로 쓰기(WY-commit 검증에서 찾은 우회)
  'cd ~/.claude/wy-approvals/erp-project/decisions && echo {} > x.json',
  'cd ~/.claude/wy-approvals/erp-project/decisions && cp a.json x.json',
  'Set-Location ~/.claude/wy-approvals/erp-project/decisions; Set-Content x.json 1',
  'pushd ~/.claude/wy-approvals/erp-project/used; touch x.json; popd',
  'cd .claude && echo {} > wy-ops.json',
  'cd ~/.wy-tools/vscode-dashboard/hooks && rm wy-approval-guard.js',
  W`sl C:\Users\k\.claude\wy-approvals\erp-project\decisions; ni x.json`,
  'd=~/.claude/wy-approvals/erp-project/decisions; cd $d && echo {} > x.json',
  // 와일드카드로 보호 경로를 숨기기(WY-commit 검증에서 찾음) — 실제로 펼쳐 보고 막는다
  'cd h/.cl*/wy-a*/erp-project/decisions && echo {} > x.json',
  'cd h/.claude/wy-*/*/dec* && cp a.json x.json',
  'cd nothing-here-*/zz? && echo {} > x.json',
  'echo {} > .cl*/wy-ops.json',
  'cp x .clau?e/wy-ops.json',
  'rm h/.claude/wy-app*/erp-project/decisions/*',
  // 와일드카드 인자를 인터프리터 쓰기 API로 넘기기(WY-commit 검증에서 찾음)
  `node -e "require('fs').writeFileSync(process.argv[1],'x')" h/.cl*/wy-a*/erp-project/decisions/a.json`,
  `python -c "import sys;open(sys.argv[1],'w').write('x')" .cl*/wy-ops.json`,
  `node -e "console.log(1)" h/.cl*/wy-a*/erp-project/decisions/a.json`,
  // 보호 파일이 나오는 명령에서 읽기 API가 없는 인터프리터 코드는 판단할 수 없어 막는다
  'cat .claude/settings.local.json | node -e "process.stdin.pipe(process.stdout)" > out.json',
];
const allow = [
  // 읽기
  'cat .claude/wy-ops.json',
  'git add .claude/wy-ops.json .claude/settings.local.json',
  'git diff -- .claude/wy-ops.json',
  'Get-Content .claude/wy-ops.json',
  'Get-Content .claude/settings.local.json | ConvertFrom-Json',
  'Test-Path .claude/wy-ops.local.json',
  W`[IO.File]::ReadAllText("C:\projects\erp-project\.claude\wy-ops.json")`,
  'tail -n 0 -F ~/.claude/wy-approvals/erp-project/decisions.log',
  'until [ -f ~/.claude/wy-approvals/erp-project/decisions/x.json ]; do sleep 5; done; cat ~/.claude/wy-approvals/erp-project/decisions/x.json',
  'cat ~/.claude/wy-approvals/erp-project/decisions.log | tail -5',
  'ls -la ~/.claude/wy-approvals/erp-project/decisions/',
  'cat ~/.claude/wy-approvals/erp-project/decisions/a.json 2>/dev/null',
  'type .claude\\wy-ops.json',
  `node -e 'const d=require("C:/Users/k/.claude/wy-approvals/erp-project/decisions/20261007-x.json");console.log(d.decision, d.reason)'`,
  `python -c "import json;json.load(open('.claude/settings.local.json'))"`,
  `node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/wy-ops.json','utf8')).roles.length)"`,
  `node -e "const d=require('./.claude/wy-ops.json');console.log(d.roles.map(r=>r.name).join())"`,
  `python3 -c "import json;print(json.load(open('.claude/wy-ops.json','r'))['project'])"`,
  W`powershell -Command "Get-Content .claude/wy-ops.json | ConvertFrom-Json"`,
  // 우리 스크립트 실행
  'powershell -NoProfile -ExecutionPolicy Bypass -File .claude/skills/pm-ops/scripts/session.ps1 list',
  'node tools/wy-ops/gen-agents.js --check',
  'node tools/vscode-dashboard/deploy.js',
  // 요청 파일 쓰기(보호 대상 아님)
  'echo {} > ~/.claude/wy-approvals/erp-project/requests/x.json',
  // 보호 파일을 읽어 다른 곳에 쓰기(B2-1 오탐 수정)
  'cat .claude/wy-ops.json > /tmp/copy.json',
  // WY-commit 커밋 메시지 파일: 본문에 보호 파일 이름이 들어 있어도 메시지 파일 쓰기는 통과(B2-1 오탐 수정)
  `cat > .git/WY_COMMIT_MSG <<'EOF'${NL}chore: .claude/wy-ops.json과 .claude/settings.local.json 설명 수정${NL}EOF`,
  `printf '%s\\n' "fix: ~/.claude/wy-approvals/erp-project/decisions 경로 안내" > .git/WY_COMMIT_MSG`,
  `echo "docs: .claude/wy-ops.local.json 언급 (a > b)" > C:/Users/k/AppData/Local/Temp/msg.txt`,
  `git commit -F .git/WY_COMMIT_MSG -m ".claude/wy-ops.json 정리"`,
  // 와일드카드가 보호 경로에 닿지 않으면 통과
  'rm src/*.log',
  'cp src/*.log /tmp/',
  'node build.js src/*.js',
  // 정규식에 쓰인 [ ](와일드카드 아님) — 배포본이 정규식 오류로 막던 것(WY-commit 결함 보고)
  `grep -nE "require\\(['\\"](jsdom|[a-z@][^./'\\"]*)['\\"]\\)" a.js | grep -vE "'(fs|os)'"`,
  `sed -n '/^\\[/p' notes.txt`,
  `rg "\\[(완료|차단)\\]" docs/`,
  `node -e "console.log(require('fs').readFileSync(process.argv[1],'utf8'))" .cl*/wy-ops.json`,
  'ls h/.cl*/wy-a*/erp-project/decisions',
  'cd src/* && echo x > out.txt',
  // 보호 폴더로 이동해 읽기만 하는 것은 통과
  'cd ~/.claude/wy-approvals/erp-project/decisions && cat x.json',
  'cd ~/.claude/wy-approvals/erp-project && ls decisions',
  'Set-Location ~/.claude/wy-approvals/erp-project/decisions; Get-Content x.json',
];
for (const c of deny) { const e = ev(c); ok(e && e.decision === 'deny', 'should deny: ' + c); }
for (const c of allow) { const e = ev(c); ok(e === null || (c.startsWith('git commit') && e.reason.includes('WY-commit')), 'should allow: ' + c + ' → ' + JSON.stringify(e)); }
ok(classify('git push -f origin x') === 'force-push' && classify('git status') === null && classify('git rebase --abort') === null, 'classify regression');
ok(ev('git push').decision === 'deny', 'non-commit session git push denied');
ok(writesApprovalFiles('ls') === false, 'unrelated passes');
fs.rmSync(proj, { recursive: true, force: true });
fs.rmSync(process.env.WY_APPROVALS_DIR, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : `guard 검사 통과 (거부 ${deny.length}, 통과 ${allow.length})`);
process.exit(fail ? 1 : 0);
