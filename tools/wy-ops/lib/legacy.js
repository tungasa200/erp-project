// 이 PC 정리(cleanup-legacy, U-13): 옛 승인 위치와 옛 설치본. install.ps1이 목록을 보여 주고 확인(y)을 받은 뒤 remove를 부른다.
//   list(home, opts) → [{ path, what, count, inUse }]
//     옛 승인 위치: <승인 바탕>/requests·decisions·used 폴더와 decisions.log(프로젝트별 폴더가 생기기 전 3단계의 파일)
//     옛 설치본: <home>/.wy-tools/vscode-dashboard
//     inUse: 넘겨받은 settings 파일의 훅이 아직 그 경로를 가리킴 → 지우면 훅이 조용히 꺼지므로 remove가 거부한다
//   remove(items, home, opts) → [{ path, removed, reason? }]  받은 것 중 지금 list에 있는 것만 지운다
// 프로젝트별 승인 폴더(<승인 바탕>/<namespace>/…)는 어떤 경우에도 대상이 아니다.
const fs = require('fs');
const path = require('path');
const { readSettings, scriptOf } = require('./settings');

const OLD_APPROVAL_DIRS = ['requests', 'decisions', 'used'];
const OLD_APPROVAL_FILES = ['decisions.log'];

const lower = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();

function bases(home, opts = {}) {
  const env = opts.env || process.env;
  return {
    approvals: opts.approvalsBase || env.WY_APPROVALS_DIR || path.join(home, '.claude', 'wy-approvals'),
    oldInstall: opts.oldInstall || path.join(home, '.wy-tools', 'vscode-dashboard'),
  };
}

function countFiles(p) {
  let n = 0;
  const walk = (q) => {
    let st;
    try {
      st = fs.lstatSync(q);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const c of fs.readdirSync(q)) walk(path.join(q, c));
    else n++;
  };
  walk(p);
  return n;
}

// 훅이 가리키는 스크립트 경로들(settings 파일 여럿)
function hookTargets(settingsFiles = []) {
  const out = [];
  for (const f of settingsFiles) {
    let s;
    try {
      s = readSettings(f);
    } catch {
      continue;
    }
    for (const groups of Object.values(s.hooks || {})) {
      for (const g of groups || []) for (const h of g.hooks || []) {
        const p = scriptOf(h);
        if (p) out.push(lower(p));
      }
    }
  }
  return out;
}

function list(home, opts = {}) {
  const b = bases(home, opts);
  const targets = hookTargets(opts.settingsFiles);
  const items = [];
  for (const name of OLD_APPROVAL_DIRS) {
    const p = path.join(b.approvals, name);
    if (fs.existsSync(p) && fs.lstatSync(p).isDirectory()) items.push({ path: p, what: `옛 승인 위치의 ${name}/(프로젝트별 폴더 전, 3단계 파일)`, count: countFiles(p), inUse: false });
  }
  for (const name of OLD_APPROVAL_FILES) {
    const p = path.join(b.approvals, name);
    if (fs.existsSync(p) && fs.lstatSync(p).isFile()) {
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).length;
      items.push({ path: p, what: `옛 승인 위치의 ${name}(${lines}줄)`, count: 1, inUse: false });
    }
  }
  if (fs.existsSync(b.oldInstall)) {
    const inUse = targets.some((t) => t.startsWith(lower(b.oldInstall) + '/'));
    items.push({ path: b.oldInstall, what: inUse ? '옛 설치본(훅이 아직 가리킴 — 먼저 setup으로 훅을 옮기세요)' : '옛 설치본(R4 전 확장·훅)', count: countFiles(b.oldInstall), inUse });
  }
  return items;
}

function remove(items, home, opts = {}) {
  const allowed = new Map(list(home, opts).map((i) => [lower(i.path), i]));
  const b = bases(home, opts);
  return (items || []).map((it) => {
    const p = it && (it.path || it);
    const known = p && allowed.get(lower(p));
    if (!known) return { path: p, removed: false, reason: '정리 대상 목록에 없는 경로' };
    // 프로젝트별 승인 폴더 안으로 들어가는 경로는 목록 규칙상 나올 수 없지만, 한 번 더 막는다
    const rel = path.relative(b.approvals, known.path);
    if (!rel.startsWith('..') && rel.includes(path.sep)) return { path: known.path, removed: false, reason: '프로젝트별 승인 폴더 안' };
    if (known.inUse) return { path: known.path, removed: false, reason: '훅이 아직 가리킴(setup으로 훅을 옮긴 뒤 다시)' };
    fs.rmSync(known.path, { recursive: true, force: true });
    return { path: known.path, removed: true };
  });
}

// CLI(install.ps1 cleanup-legacy가 부른다): node legacy.js list [--settings <파일>]... | node legacy.js remove <경로>... [--settings <파일>]...
function main(argv = process.argv.slice(2)) {
  const home = require('os').homedir();
  const settingsFiles = [];
  const rest = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--settings') settingsFiles.push(argv[++i]);
    else rest.push(argv[i]);
  }
  if (argv[0] === 'list') process.stdout.write(JSON.stringify(list(home, { settingsFiles }), null, 2) + '\n');
  else if (argv[0] === 'remove') process.stdout.write(JSON.stringify(remove(rest, home, { settingsFiles }), null, 2) + '\n');
  else {
    process.stderr.write('사용: node legacy.js list|remove [경로...] [--settings <settings.local.json>]\n');
    return 2;
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { list, remove, OLD_APPROVAL_DIRS, OLD_APPROVAL_FILES };
