#!/usr/bin/env node
// WY Ops 설치 명령 본체(OPS-10). install.ps1이 그대로 넘겨 부른다.
//   deploy                          HEAD를 버전 폴더에 설치하고 current를 바꾼다(lib/deploy.js)
//   global   [--skip-plugins]       deploy + 껍데기 확장 + 필수 플러그인 + NEW-PC.md 체크리스트. 어느 프로젝트도 건드리지 않는다
//   setup    [--project <폴더>]     global + 이 프로젝트 settings.local.json 병합(차이 → 확인) + 승인 폴더 + doctor + 남은 일 할 일 카드
//   doctor   [--json]               점검(lib/doctor.js, 읽기만)
//   rollback [<버전>]               current를 이전 버전으로
//   cleanup-legacy                  옛 승인 위치·옛 설치본 목록 → 확인 → 지움(lib/legacy.js)
//   init --name <이름> --prefix <XX-> [--stack <id>] [--verify-<build|test|...> <명령>] [--roles a,b] [--count backend=2,frontend=2]
//        [--area "<역할>=<디렉터리>;…"] [--no-principles] [--project <폴더, 기본 현재 폴더>]
//                                   새 프로젝트(OPS-10-2): 설정·역할 원본·생성 파일·.gitignore(lib/init.js) + settings 병합 + 승인 폴더 + doctor,
//                                   CLAUDE.md에 넣을 절을 출력만 한다. 그 PC에 global(또는 setup)을 먼저 해 둔다
//   update [--project <폴더>] [--dry-run]  deploy + 생성 파일 다시 만들기(사람이 고친 것은 덮지 않고 차이만, lib/update.js)
//   gen [--project <폴더>]                 .claude/ops 원본을 고친 뒤 역할 파일·pm-ops 스킬 다시 만들기(lock도 맞춤)
//   export [--out <zip>] [--no-settings]   개인 이전 묶음(git 밖 상태: 메모리·승인 이력·인수인계·settings.local.json)을 zip으로(lib/transfer.js)
//   import <zip> [--dry-run] [--no-settings] 묶음 들여오기. 덮어쓸 파일이 있으면 목록을 보여 주고 확인(원래 파일은 백업), 들여온 승인은 '사용됨' 표시
// 공통: --yes(확인 없이 진행), --extensions-dir <폴더>(code에 넘김, 시험용). 결정 파일(decisions/·used/)은 쓰지 않는다(OPS-10-3).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PKG = path.resolve(__dirname, '..');
const OLD_EXT = 'erp-project.erp-session-dashboard';
const STUB_EXT = 'wy-ops.wy-ops';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
const say = (s = '') => process.stdout.write(s + '\n');

// code·claude·gh는 Windows에서 .cmd 래퍼라 cmd.exe로 부르고, 나머지(where 등)는 바로 부른다.
// cmd /s는 명령줄의 첫·끝 따옴표를 떼므로, 인자를 감싼 명령줄 전체를 한 번 더 "…"로 감싸고 그대로(verbatim) 넘긴다.
// 이렇게 하지 않으면 공백·한글이 든 경로(--extensions-dir 등)가 깨진다(R5, doctor.js와 같은 방식)
const CMD_WRAPPERS = ['code', 'claude', 'gh'];
function run(cmd, args = []) {
  const opts = { encoding: 'utf8', windowsHide: true, timeout: 180000 };
  let r;
  if (process.platform === 'win32' && CMD_WRAPPERS.includes(cmd)) {
    const q = (a) => (/[\s"&|<>^()]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);
    r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[cmd, ...args].map(q).join(' ')}"`], { ...opts, windowsVerbatimArguments: true });
  } else {
    r = spawnSync(cmd, args, opts);
  }
  return { status: r.error ? null : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const codeArgs = (args) => (opt('--extensions-dir') ? ['--extensions-dir', opt('--extensions-dir'), ...args] : args);

function confirm(question) {
  if (flag('--yes')) return true;
  process.stdout.write(`${question} [y/N] `);
  const buf = Buffer.alloc(256);
  let n = 0;
  try {
    n = fs.readSync(0, buf, 0, buf.length, null);
  } catch {
    return false;
  }
  return /^\s*y/i.test(buf.slice(0, n).toString());
}

// 묶음이 옮기지 않는 것: 새 PC에서 사람이 다시 하는 일(import·restore 끝에 출력)
const NEW_PC_TODO = [
  'Claude Code 로그인(claude 실행 후 /login)',
  'GitHub 로그인(gh auth login)',
  '외부 콘솔(배포·호스팅 등) 로그인. 전용 Chrome 프로필은 옮기지 않으므로 새로 로그인합니다',
  'MCP 서버 토큰 다시 입력',
  '비밀값 폴더(.claude/wy-ops.json의 secretsDir, 정했을 때만)를 손으로 직접 복사. 묶음에는 비밀값을 넣지 않습니다',
  'install.ps1 doctor로 남은 항목 확인',
];

// 커밋 안 된 변경·푸시 안 된 커밋(어느 브랜치든). git 저장소가 아니면 빈 목록
function gitPending(project) {
  const git = (args) => spawnSync('git', ['-C', project, ...args], { encoding: 'utf8', windowsHide: true });
  if (git(['rev-parse', '--is-inside-work-tree']).status !== 0) return [];
  const out = [];
  const changed = String(git(['status', '--porcelain']).stdout || '').split(/\r?\n/).filter(Boolean).length;
  if (changed) out.push(`커밋 안 된 변경 ${changed}개 — 묶음에 들어가지 않습니다. 커밋·푸시하거나 따로 옮기세요`);
  const ahead = String(git(['log', '--branches', '--not', '--remotes', '--oneline']).stdout || '').split(/\r?\n/).filter(Boolean).length;
  if (ahead) out.push(`푸시 안 된 커밋 ${ahead}개 — 새 PC에서 clone하면 없습니다. 먼저 푸시하세요`);
  return out;
}

// 한 줄 입력(입력이 없거나 읽을 수 없으면 빈 문자열)
function ask(question) {
  process.stdout.write(`${question} `);
  const buf = Buffer.alloc(1024);
  let n = 0;
  try {
    n = fs.readSync(0, buf, 0, buf.length, null);
  } catch {
    return '';
  }
  return buf.slice(0, n).toString().split(/\r?\n/)[0].trim();
}

function prereqs() {
  const missing = ['git', 'node', 'code', 'claude'].filter((c) => run('where', [c]).status !== 0);
  if (missing.length) throw new Error(`필요한 도구가 PATH에 없습니다: ${missing.join(', ')} (NEW-PC.md의 '새 PC 전제' 참고)`);
}

function deployStep() {
  const { deploy } = require('./deploy');
  const r = deploy({});
  say(`설치본: ${path.join(r.dir, r.name)} (v${r.version}, 커밋 ${r.commit}), current → ${r.name}`);
  if (r.removed.length) say(`오래된 버전 정리: ${r.removed.join(', ')}`);
  return r;
}

// 설치된 껍데기의 해시(extensions.json에서 위치를 찾아 package.json을 읽는다)
function installedStubHash() {
  const dir = opt('--extensions-dir') || path.join(os.homedir(), '.vscode', 'extensions');
  try {
    const list = JSON.parse(fs.readFileSync(path.join(dir, 'extensions.json'), 'utf8'));
    const e = list.find((x) => x.identifier && x.identifier.id === STUB_EXT);
    if (!e) return null;
    const loc = e.location && (e.location.fsPath || e.location.path || '').replace(/^\/([A-Za-z]:)/, '$1');
    return JSON.parse(fs.readFileSync(path.join(loc || path.join(dir, e.relativeLocation || ''), 'package.json'), 'utf8')).wyOpsStubHash || null;
  } catch {
    return null;
  }
}

function extensionStep(dep) {
  const current = path.join(dep.dir, 'current');
  if (installedStubHash() === dep.stubHash) {
    say('확장: 껍데기 확장이 최신입니다(재설치 불필요).');
    return false;
  }
  const { vsix } = require('./vsix');
  const file = path.join(os.tmpdir(), `wy-ops-${dep.stubHash}.vsix`);
  fs.writeFileSync(file, vsix(path.join(current, 'stub-ext')));
  const r = run('code', codeArgs(['--install-extension', file, '--force']));
  try {
    fs.unlinkSync(file); // fs.rmSync는 한글 경로에서 프로세스를 죽인다(R5)
  } catch {
    // 이미 없으면 그만
  }
  if (r.status !== 0) throw new Error(`확장 설치 실패: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
  say(`확장: ${STUB_EXT}를 설치했습니다(Reload Window 필요).`);
  return true;
}

function pluginsStep() {
  const raw = JSON.parse(fs.readFileSync(path.join(PKG, 'plugins.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.plugins || [];
  let have = [];
  try {
    have = JSON.parse(run('claude', ['plugin', 'list', '--json']).stdout).map((p) => p.id || p.name);
  } catch {
    // 목록을 못 읽으면 설치를 시도한다(이미 있으면 claude가 알려 줌)
  }
  for (const p of list.filter((x) => x.required)) {
    if (have.includes(p.id)) {
      say(`플러그인: ${p.id} 설치됨`);
      continue;
    }
    const src = p.ref ? `${p.marketplace}#${p.ref}` : p.marketplace;
    run('claude', ['plugin', 'marketplace', 'add', src]); // 이미 있으면 실패해도 된다
    const r = run('claude', ['plugin', 'install', p.id, '--scope', 'user']);
    if (r.status !== 0) throw new Error(`플러그인 설치 실패: ${p.id} — ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
    say(`플러그인: ${p.id} 설치했습니다`);
  }
  const optional = list.filter((x) => !x.required);
  if (optional.length) say(`선택 플러그인(필요하면 직접 설치): ${optional.map((p) => `claude plugin install ${p.id}`).join(' / ')}`);
}

// 이 폴더를 Claude Code가 신뢰하는지(~/.claude.json의 projects[경로].hasTrustDialogAccepted, 읽기만).
// VS Code 작성자 신뢰와 따로이고, 없으면 claude --bg가 'Workspace not trusted'로 뜨지 않는다(R6). 하위 폴더는 위 폴더의 신뢰를 따른다
function claudeTrusted(project, home = os.homedir()) {
  let projects = {};
  try {
    projects = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).projects || {};
  } catch {
    return null; // 읽지 못하면 모른다
  }
  const norm = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const want = norm(project);
  return Object.entries(projects).some(([k, v]) => v && v.hasTrustDialogAccepted && (want === norm(k) || want.startsWith(`${norm(k)}/`)));
}

function trustHint(project) {
  if (claudeTrusted(project) !== false) return;
  say(`\n이 폴더는 아직 Claude Code가 신뢰하지 않습니다(${project}). 그 폴더의 터미널에서 claude를 한 번 실행해 'Do you trust the files in this folder?'에 Yes → /exit 하세요.`);
  say('VS Code의 작성자 신뢰와는 따로이고, 이것이 없으면 백그라운드 역할 세션이 "Workspace not trusted"로 뜨지 않습니다.');
}

function printNewPc() {
  const f = path.join(PKG, 'NEW-PC.md');
  if (fs.existsSync(f)) say(`\n${fs.readFileSync(f, 'utf8').trim()}\n`);
}

function projectRoot() {
  const p = opt('--project');
  if (p) return path.resolve(p);
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('저장소 안에서 실행하거나 --project <폴더>를 주세요');
  return path.resolve(r.stdout.trim());
}

const store = () => require('../vscode/approvalStore');
// R4 전환 조건으로 세는 대기 카드: 출처 대조 원장이 지키는 결정 종류(git 계열·choice·permission)만.
// todo(할 일)는 '했음' 결정이 원장 보호 대상이 아니고 전환 뒤에 처리해도 되므로 세지 않는다 — R4를 안내하는 할 일 카드 자체가 걸리던 결함(pm 결정)
const PROTECTED_KINDS = () => new Set([...Object.keys(store().GIT_KINDS), 'choice', 'permission']);
function protectedPending(root) {
  const kinds = PROTECTED_KINDS();
  return store().readState(root).pending.filter((r) => !r.broken && kinds.has(r.kind)).map((r) => r.id);
}
// doctor에 넘길 값: 시험용 --extensions-dir도 함께(설치한 곳과 같은 곳을 점검하게)
const doctorOpts = (project) => ({ repoRoot: project, home: os.homedir(), ...(opt('--extensions-dir') ? { extensionsDir: opt('--extensions-dir') } : {}) });
const extInstalled = (id) => run('code', codeArgs(['--list-extensions'])).stdout.split(/\r?\n/).some((l) => l.trim().toLowerCase() === id);

function settingsStep(project, dep) {
  const settings = require('./settings');
  const hooksDir = path.join(dep.dir, 'current', 'vscode', 'hooks').replace(/\\/g, '/');
  for (const f of ['wy-approval-guard.js', 'wy-message-guard.js', 'wy-permission.js', 'wy-session-start.js', 'wy-context-size.js']) {
    if (!fs.existsSync(path.join(hooksDir, f))) throw new Error(`훅 파일이 없습니다: ${hooksDir}/${f} (훅이 조용히 통과하지 않게 settings를 바꾸지 않습니다)`);
  }
  const file = path.join(project, '.claude', 'settings.local.json');
  const { next, changes } = settings.plan(settings.readSettings(file), hooksDir);
  if (!changes.length) return say('settings: 바꿀 것 없음');
  say(`settings: ${file}`);
  for (const c of changes) say(`  ${settings.describe(c)}`);
  if (!confirm('위처럼 바꿀까요?')) throw new Error('settings를 바꾸지 않고 멈췄습니다');
  const bak = settings.apply(file, next);
  say(bak ? `settings: 바꿨습니다(백업 ${bak})` : 'settings: 새로 만들었습니다');
}

function doctorStep(project, { todos }) {
  let doctor;
  try {
    doctor = require('./doctor');
  } catch {
    return say('doctor: lib/doctor.js가 없어 건너뜁니다');
  }
  const results = doctor.checkAll(doctorOpts(project));
  const order = { fail: 0, warn: 1, ok: 2 };
  for (const r of results.slice().sort((a, b) => order[a.level] - order[b.level])) say(`${r.level === 'ok' ? '  ok ' : r.level === 'warn' ? 'WARN ' : 'FAIL '} ${r.title}${r.detail ? ` — ${r.detail}` : ''}${r.level !== 'ok' && r.fix ? `\n       고치기: ${r.fix}` : ''}`);
  if (todos) {
    const { writeTodo } = require('./todo');
    const root = store().rootFor(project);
    for (const r of results.filter((x) => x.todo)) {
      const w = writeTodo(root, r.todo);
      if (w.written) say(`할 일 카드를 올렸습니다: ${w.id}`);
    }
  }
  return results;
}

function main() {
  const cmd = argv[0];
  if (cmd === 'deploy') return void deployStep();
  if (cmd === 'rollback') {
    const r = require('./deploy').rollback({ name: argv[1] && !argv[1].startsWith('--') ? argv[1] : null });
    return say(`되돌렸습니다: ${r.from || '(없음)'} → ${r.to}. Reload Window를 하세요.`);
  }
  if (cmd === 'doctor') {
    const project = projectRoot();
    if (flag('--json')) return say(JSON.stringify(require('./doctor').checkAll(doctorOpts(project)), null, 2));
    const res = doctorStep(project, { todos: false }) || [];
    process.exitCode = res.some((r) => r.level === 'fail') ? 1 : 0;
    return undefined;
  }
  if (cmd === 'cleanup-legacy') {
    const legacy = require('./legacy');
    const settingsFiles = [path.join(projectRoot(), '.claude', 'settings.local.json')];
    const items = legacy.list(os.homedir(), { settingsFiles });
    if (!items.length) return say('정리할 옛 파일이 없습니다');
    for (const i of items) say(`  ${i.path} — ${i.what}${i.count != null ? ` (${i.count}개)` : ''}${i.inUse ? ' [아직 사용 중: 건너뜀]' : ''}`);
    if (!confirm('위 목록을 지울까요?')) return say('지우지 않았습니다');
    for (const r of legacy.remove(items.filter((i) => !i.inUse), os.homedir(), { settingsFiles })) say(`  ${r.removed ? '지움' : '건너뜀'} ${r.path}${r.reason ? ` (${r.reason})` : ''}`);
    return undefined;
  }
  if (cmd === 'init') {
    const name = opt('--name');
    const prefix = opt('--prefix');
    if (!name || !prefix) throw new Error('init에는 --name <프로젝트 이름>과 --prefix <역할 접두사, 예: AB->가 필요합니다');
    const project = path.resolve(opt('--project') || process.cwd());
    const { toolsDir } = require('./deploy');
    const current = path.join(toolsDir(), 'current');
    if (!fs.existsSync(path.join(current, 'deployed.json'))) throw new Error(`이 PC에 패키지가 없습니다(${current}). 먼저 이 저장소에서 install.ps1 global을 실행하세요`);
    const initLib = require('./init');
    const { VERIFY_KEYS } = require('../gen-agents');
    const stacks = initLib.listStacks();
    let stack = opt('--stack');
    if (!stack) {
      say('기술 스택을 고르세요(개발 도구 점검과 검증 명령이 정해집니다):');
      stacks.forEach((s, i) => say(`  ${i + 1}. ${s.id} — ${s.label}`));
      const a = ask(`번호 또는 이름 [${stacks.findIndex((s) => s.id === 'custom') + 1}]:`);
      stack = stacks[Number(a) - 1] ? stacks[Number(a) - 1].id : a || 'custom';
    }
    // 검증 명령 덮어쓰기: --verify-<키> "<명령>". 직접 입력(custom)이면 빠진 것을 묻는다(--yes면 묻지 않고 비워 둠)
    const verify = {};
    for (const [k, label] of VERIFY_KEYS) {
      if (opt(`--verify-${k}`) != null) verify[k] = opt(`--verify-${k}`);
      else if (stack === 'custom' && !flag('--yes')) verify[k] = ask(`  ${label} 명령(없으면 Enter):`);
    }
    // 역할 구성: --roles <그룹,…>(고르기), --count backend=2,frontend=2(같은 역할 여러 세션), --area "<역할>=<영역>;…"(담당 디렉터리)
    // 직접 주지 않았으면 여러 개로 나눌 수 있는 역할의 수와 영역을 묻는다(--yes면 기본값: 영역은 pm이 배정)
    const catalog = JSON.parse(fs.readFileSync(path.join(PKG, 'templates', 'roles.json'), 'utf8'));
    const roles = opt('--roles') ? opt('--roles').split(',').map((s) => s.trim()).filter(Boolean) : null;
    const pairs = (text, sep) => Object.fromEntries(String(text || '').split(sep).map((s) => s.split('=').map((x) => x.trim())).filter(([k, v]) => k && v != null));
    const counts = Object.fromEntries(Object.entries(pairs(opt('--count'), ',')).map(([k, v]) => [k, Number(v)]));
    const areas = pairs(opt('--area'), ';');
    if (!flag('--yes') && opt('--count') == null && opt('--area') == null) {
      say('같은 역할을 여러 세션으로 나눠 병렬로 일할 수 있습니다(0이면 빼기).');
      for (const g of catalog.groups.filter((x) => x.multi && (!roles || roles.includes(x.id)))) {
        const a = ask(`  ${g.id} 세션 수 [${g.count}]:`);
        if (a) counts[g.id] = Number(a);
        const n = counts[g.id] == null ? g.count : counts[g.id];
        for (let i = 1; n > 1 && i <= n; i++) {
          const v = ask(`    ${prefix}${g.id}${i} 담당 영역(디렉터리, 없으면 Enter = pm이 배정):`);
          if (v) areas[`${prefix}${g.id}${i}`] = v;
        }
      }
    }
    const r = initLib.init({ project, name, prefix, stack, verify, roles, counts, areas, principles: !flag('--no-principles') });
    say(`스택: ${r.ops.stack || '(없음)'} · 역할 ${r.ops.roles.map((x) => x.name).join(', ')}`);
    for (const f of r.files) say(`  ${f.action.padEnd(9)} ${f.file}${f.action === 'modified' || f.action === 'unmanaged' ? ' (그대로 둠)' : ''}`);
    if (r.gitignoreAdded.length) say(`  .gitignore에 더함: ${r.gitignoreAdded.join(', ')}`);
    settingsStep(project, { dir: toolsDir() });
    store().ensureDirs(store().rootFor(project));
    doctorStep(project, { todos: true });
    say(`\nCLAUDE.md에 아래 절을 넣으세요(자동으로 고치지 않습니다. 같은 내용: .claude/ops/CLAUDE.part.md${flag('--no-principles') ? '' : ', 작업 원칙 절은 빼도 됩니다'}):\n`);
    say(r.claudeMd.trim());
    trustHint(project);
    say('\n다음: VS Code에서 "Developer: Reload Window"를 실행하세요.');
    return undefined;
  }
  if (cmd === 'update') {
    const project = projectRoot();
    deployStep();
    const { update, format } = require('./update');
    const version = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
    say(format(update({ project, version, dryRun: flag('--dry-run') })));
    say('다음: VS Code에서 "Developer: Reload Window"를 실행하세요.');
    return undefined;
  }
  if (cmd === 'gen') {
    // 역할 파일·pm-ops 스킬 다시 만들기(.claude/ops 원본을 고친 뒤). 생성기가 lock도 함께 맞춘다
    const project = projectRoot();
    for (const script of ['gen-agents.js', 'gen-skill.js']) {
      const g = spawnSync(process.execPath, [path.join(PKG, script), '--root', project], { encoding: 'utf8' });
      process.stdout.write(g.stdout || '');
      if (g.status !== 0) throw new Error(`${script} 실패: ${(g.stderr || '').trim()}`);
    }
    return undefined;
  }
  if (cmd === 'export') {
    const project = projectRoot();
    // 이전 전 점검: 커밋 안 된 변경·푸시 안 된 커밋은 묶음에 들어가지 않는다(git으로 옮길 것)
    const pending = gitPending(project);
    for (const line of pending) say(`[주의] ${line}`);
    say('역할 세션이 하던 일이 있으면 먼저 진행 상태를 저장하게 하세요(pm이 교대 준비를 지시 → 각 세션이 인수인계 저장).');
    say('묶음은 지금 시점의 사본입니다. 동기화가 아니므로 묶은 뒤 원래 PC에서 바뀐 것은 옮겨지지 않습니다.');
    if (pending.length && !confirm('그래도 묶을까요?')) return say('묶지 않았습니다');
    const include = flag('--no-settings') ? { settingsLocal: false } : {};
    const r = require('./transfer').exportState({ project, out: opt('--out') ? path.resolve(opt('--out')) : undefined, include });
    say(`개인 이전 묶음: ${r.file} (파일 ${r.files.length}개)`);
    for (const s of r.skipped || []) say(`  뺌 ${s.kind}/${s.rel} — ${s.reason}`);
    say('\n개인 USB나 드라이브로만 옮기고, 옮긴 뒤 지우세요.');
    say('비밀값 검사는 이름표가 붙은 토큰·키 모양만 잡습니다. 이름표 없는 비밀값(비밀번호만 적힌 줄 등)은 메모리에 적지 마세요.');
    return undefined;
  }
  if (cmd === 'import') {
    const zipFile = argv[1] && !argv[1].startsWith('--') ? path.resolve(argv[1]) : null;
    if (!zipFile) throw new Error('import에는 묶음 파일이 필요합니다: install.ps1 import <zip> [--project <폴더>]');
    const project = projectRoot();
    const include = flag('--no-settings') ? { settingsLocal: false } : {};
    const t = require('./transfer');
    const plan = t.importState({ project, zip: zipFile, include, dryRun: true });
    const over = plan.files.filter((f) => f.status === 'overwrite');
    say(`들여올 파일 ${plan.files.length}개(새 ${plan.files.filter((f) => f.status === 'new').length}, 같음 ${plan.files.filter((f) => f.status === 'same').length}, 덮어씀 ${over.length})`);
    for (const f of over) say(`  덮어씀 ${f.kind} ${f.target}`);
    if (flag('--dry-run')) return undefined;
    if (over.length && !confirm('위 파일을 덮어쓸까요? (원래 파일은 백업합니다)')) return say('들여오지 않았습니다');
    const r = t.importState({ project, zip: zipFile, include });
    say(`들여왔습니다: ${r.files.filter((f) => f.status !== 'same').length}개`);
    if (r.backupDir) say(`백업: ${r.backupDir}`);
    if (r.markedUsed) say(`승인 이력 ${r.markedUsed}건은 '사용됨'으로 표시했습니다(이 PC에서 승인으로 다시 쓰이지 않음)`);
    for (const s of r.skipped || []) say(`  건너뜀 ${s.kind}/${s.rel} — ${s.reason}`);
    const plugins = r.plugins && r.plugins.enabledPlugins ? Object.keys(r.plugins.enabledPlugins).filter((k) => r.plugins.enabledPlugins[k]) : [];
    if (plugins.length) say(`원래 PC에서 켜 둔 플러그인(참고, 필수 플러그인은 setup이 설치): ${plugins.join(', ')}`);
    say('\n새 PC에서 다시 할 일(묶음으로 옮기지 않음):');
    for (const t of NEW_PC_TODO) say(`  - ${t}`);
    return undefined;
  }
  if (cmd === 'global' || cmd === 'setup') {
    prereqs();
    const project = cmd === 'setup' ? projectRoot() : null;
    // R4 전환 조건: 옛 확장이 있는 PC에서 setup은 승인 대기 카드가 0일 때만(원장이 새로 시작되므로)
    const oldExt = !flag('--skip-extension') && extInstalled(OLD_EXT);
    if (project && oldExt) {
      const pending = protectedPending(store().rootFor(project));
      if (pending.length) throw new Error(`결정을 기다리는 카드가 ${pending.length}장 있습니다(${pending.join(', ')}). 모두 처리한 뒤 다시 실행하세요(확장 전환 때 출처 대조 원장이 새로 시작됩니다)`);
    }
    const dep = deployStep();
    if (!flag('--skip-extension')) {
      if (oldExt && confirm(`옛 확장 ${OLD_EXT}를 제거하고 ${STUB_EXT}로 바꿀까요?`)) {
        run('code', codeArgs(['--uninstall-extension', OLD_EXT]));
        say(`확장: 옛 확장 ${OLD_EXT}를 제거했습니다`);
      }
      extensionStep(dep);
    }
    if (!flag('--skip-plugins')) pluginsStep();
    if (project) {
      settingsStep(project, dep);
      store().ensureDirs(store().rootFor(project)); // 빈 폴더만 만든다(결정 파일은 쓰지 않음)
      doctorStep(project, { todos: true });
      trustHint(project);
      if (oldExt) say('\n출처 대조 원장을 새로 시작했습니다: 이 시각 전의 결정은 신뢰합니다(확장 id 변경, K4).');
    }
    printNewPc();
    say('다음: VS Code에서 "Developer: Reload Window"를 실행하세요.');
    return undefined;
  }
  say('사용법: install.ps1 deploy | global | setup | init --name <이름> --prefix <XX-> [--stack <id>] [--count …] [--area …] [--no-principles] | gen | update | doctor | rollback [버전] | cleanup-legacy | export [--out <zip>] | import <zip> [--dry-run]  [--yes] [--no-settings] [--project <폴더>] [--skip-plugins] [--skip-extension]');
  process.exitCode = 64;
  return undefined;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`실패: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { run, installedStubHash, protectedPending, claudeTrusted };
