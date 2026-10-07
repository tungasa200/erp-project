#!/usr/bin/env node
// WY Ops 설치 명령 본체(OPS-10). install.ps1이 그대로 넘겨 부른다.
//   deploy                          HEAD를 버전 폴더에 설치하고 current를 바꾼다(lib/deploy.js)
//   global   [--skip-plugins]       deploy + 껍데기 확장 + 필수 플러그인 + NEW-PC.md 체크리스트. 어느 프로젝트도 건드리지 않는다
//   setup    [--project <폴더>]     global + 이 프로젝트 settings.local.json 병합(차이 → 확인) + 승인 폴더 + doctor + 남은 일 할 일 카드
//   doctor   [--json]               점검(lib/doctor.js, 읽기만)
//   rollback [<버전>]               current를 이전 버전으로
//   cleanup-legacy                  옛 승인 위치·옛 설치본 목록 → 확인 → 지움(lib/legacy.js)
//   init --name <이름> --prefix <XX-> [--roles a,b] [--project <폴더, 기본 현재 폴더>]
//                                   새 프로젝트(OPS-10-2): 설정·역할 원본·생성 파일·.gitignore(lib/init.js) + settings 병합 + 승인 폴더 + doctor,
//                                   CLAUDE.md에 넣을 절을 출력만 한다. 그 PC에 global(또는 setup)을 먼저 해 둔다
//   update [--project <폴더>]       deploy + 생성 파일 다시 만들기(사람이 고친 것은 덮지 않고 차이만, lib/update.js)
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

// code·claude·gh는 Windows에서 .cmd라 cmd.exe로 부른다
function run(cmd, args = []) {
  const q = (a) => (/[\s"&|<>^]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);
  const r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [cmd, ...args].map(q).join(' ')], { encoding: 'utf8', windowsHide: true, timeout: 180000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
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
  fs.rmSync(file, { force: true });
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
// doctor에 넘길 값: 시험용 --extensions-dir도 함께(설치한 곳과 같은 곳을 점검하게)
const doctorOpts = (project) => ({ repoRoot: project, home: os.homedir(), ...(opt('--extensions-dir') ? { extensionsDir: opt('--extensions-dir') } : {}) });
const extInstalled = (id) => run('code', codeArgs(['--list-extensions'])).stdout.split(/\r?\n/).some((l) => l.trim().toLowerCase() === id);

function settingsStep(project, dep) {
  const settings = require('./settings');
  const hooksDir = path.join(dep.dir, 'current', 'vscode', 'hooks').replace(/\\/g, '/');
  for (const f of ['wy-approval-guard.js', 'wy-message-guard.js', 'wy-permission.js', 'wy-session-start.js']) {
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
    const r = require('./init').init({ project, name, prefix, roles: opt('--roles') ? opt('--roles').split(',').map((s) => s.trim()).filter(Boolean) : null });
    for (const f of r.files) say(`  ${f.action.padEnd(9)} ${f.file}${f.action === 'modified' || f.action === 'unmanaged' ? ' (그대로 둠)' : ''}`);
    if (r.gitignoreAdded.length) say(`  .gitignore에 더함: ${r.gitignoreAdded.join(', ')}`);
    settingsStep(project, { dir: toolsDir() });
    store().ensureDirs(store().rootFor(project));
    doctorStep(project, { todos: true });
    say('\nCLAUDE.md에 아래 절을 넣으세요(자동으로 고치지 않습니다):\n');
    say(r.claudeMd.trim());
    say('\n다음: VS Code에서 "Developer: Reload Window"를 실행하세요.');
    return undefined;
  }
  if (cmd === 'update') {
    const project = projectRoot();
    deployStep();
    let update;
    try {
      update = require('./update').update;
    } catch {
      return say('update: lib/update.js가 없어 생성 파일은 다시 만들지 않았습니다');
    }
    for (const f of update({ project })) say(`  ${f.action.padEnd(9)} ${f.file}${f.diff ? `\n${f.diff}` : ''}`);
    say('다음: VS Code에서 "Developer: Reload Window"를 실행하세요.');
    return undefined;
  }
  if (cmd === 'global' || cmd === 'setup') {
    prereqs();
    const project = cmd === 'setup' ? projectRoot() : null;
    // R4 전환 조건: 옛 확장이 있는 PC에서 setup은 승인 대기 카드가 0일 때만(원장이 새로 시작되므로)
    const oldExt = !flag('--skip-extension') && extInstalled(OLD_EXT);
    if (project && oldExt) {
      const pending = store().countPending(store().rootFor(project));
      if (pending > 0) throw new Error(`승인 대기 카드가 ${pending}장 있습니다. 모두 처리한 뒤 다시 실행하세요(확장 전환 때 출처 대조 원장이 새로 시작됩니다)`);
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
      if (oldExt) say('\n출처 대조 원장을 새로 시작했습니다: 이 시각 전의 결정은 신뢰합니다(확장 id 변경, K4).');
    }
    printNewPc();
    say('다음: VS Code에서 "Developer: Reload Window"를 실행하세요.');
    return undefined;
  }
  say('사용법: install.ps1 deploy | global | setup | init --name <이름> --prefix <XX-> | update | doctor | rollback [버전] | cleanup-legacy  [--yes] [--project <폴더>] [--skip-plugins] [--skip-extension]');
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

module.exports = { run, installedStubHash };
