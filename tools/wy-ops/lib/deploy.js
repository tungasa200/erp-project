#!/usr/bin/env node
// 버전 설치(R2): 커밋된(HEAD) tools/wy-ops를 ~/.wy-tools/wy-ops/<버전>-<커밋>/에 꺼내고, current 정션을 그 폴더로 바꾼다.
//   훅과 껍데기 확장은 current 경로를 쓴다. 최근 KEEP개 버전만 남기고, rollback은 정션만 되돌린다.
//   여러 세션이 같은 워킹트리에서 일하므로 워킹트리가 아니라 HEAD를 꺼낸다(지금의 vscode/deploy.js와 같은 이유).
//   설치본에는 테스트를 넣지 않는다. 껍데기 확장 폴더(stub-ext)를 함께 만들고 해시를 deployed.json에 남긴다.
// CLI: node tools/wy-ops/lib/deploy.js [--keep 3] [--no-legacy]   |   node tools/wy-ops/lib/deploy.js rollback [<버전 폴더 이름>]
//   R4 전환 전까지는 옛 설치본(~/.wy-tools/vscode-dashboard, 지금 훅·확장이 쓰는 곳)에도 함께 배포한다(--no-legacy로 끔).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const stub = require('./stub');

const PKG = path.resolve(__dirname, '..');
const KEEP = 3;

const toolsDir = () => (process.env.WY_TOOLS_DIR ? path.join(process.env.WY_TOOLS_DIR, 'wy-ops') : path.join(os.homedir(), '.wy-tools', 'wy-ops'));
const git = (args, cwd, enc = 'utf8') => execFileSync('git', args, { cwd, encoding: enc, maxBuffer: 64 * 1024 * 1024 });
const skip = (rel) => rel.split('/').includes('test') || rel.endsWith('.test.js');

// 버전 폴더 목록(정션·.new·.old 제외), 새것부터
function versions(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => !/^current/.test(n) && !/\.(new|old)$/.test(n) && fs.existsSync(path.join(dir, n, 'deployed.json')))
    .map((n) => ({ name: n, at: Date.parse(JSON.parse(fs.readFileSync(path.join(dir, n, 'deployed.json'), 'utf8')).deployedAt) || 0 }))
    .sort((a, b) => b.at - a.at)
    .map((v) => v.name);
}

function currentTarget(dir) {
  try {
    return path.basename(fs.readlinkSync(path.join(dir, 'current')).replace(/[\\/]+$/, ''));
  } catch {
    return null;
  }
}

// current 정션을 name 폴더로. 이미 있는 정션 위로는 이름을 바꿀 수 없어서(EPERM) 옛 정션을 옆으로 옮긴 뒤 새 정션을 넣는다
function point(dir, name) {
  const cur = path.join(dir, 'current');
  const next = path.join(dir, 'current.new');
  const old = path.join(dir, 'current.old');
  for (const p of [next, old]) if (fs.existsSync(p) || isLink(p)) fs.unlinkSync(p);
  fs.symlinkSync(path.join(dir, name), next, 'junction');
  if (isLink(cur)) fs.renameSync(cur, old);
  fs.renameSync(next, cur);
  if (isLink(old)) fs.unlinkSync(old); // 정션만 지운다(대상 폴더는 남음)
}

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function deploy({ dir = toolsDir(), keep = KEEP, pkg = PKG } = {}) {
  const repo = git(['rev-parse', '--show-toplevel'], pkg).trim();
  const rel = path.relative(repo, pkg).replace(/\\/g, '/');
  const commit = git(['rev-parse', '--short', 'HEAD'], repo).trim();
  const version = JSON.parse(git(['show', `HEAD:${rel}/package.json`], repo)).version;
  const name = `${version}-${commit}`;
  const target = path.join(dir, name);
  const before = currentTarget(dir);
  const prevStub = before ? readDeployed(path.join(dir, before)).stubHash || null : null;
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(target, 'deployed.json'))) {
    const stage = `${target}.new`;
    fs.rmSync(stage, { recursive: true, force: true });
    const entries = git(['ls-tree', '-r', '-z', 'HEAD', '--', `${rel}/`], repo).split('\0').filter(Boolean);
    for (const e of entries) {
      const [meta, file] = e.split('\t');
      const relFile = file.slice(rel.length + 1);
      if (skip(relFile)) continue;
      const dest = path.join(stage, relFile);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, git(['cat-file', 'blob', meta.split(' ')[2]], repo, 'buffer'));
    }
    const { hash } = stub.build(path.join(stage, 'vscode'), path.join(stage, 'stub-ext'));
    fs.writeFileSync(path.join(stage, 'deployed.json'), JSON.stringify({ version, commit, stubHash: hash, source: 'HEAD', deployedAt: new Date().toISOString() }, null, 2) + '\n');
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(stage, target);
  }
  point(dir, name);
  const removed = prune(dir, keep);
  const info = readDeployed(target);
  return { dir, name, version, commit, stubHash: info.stubHash, stubChanged: info.stubHash !== prevStub, previous: before, removed };
}

function readDeployed(versionDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(versionDir, 'deployed.json'), 'utf8'));
  } catch {
    return {};
  }
}

// 새것부터 keep개와 current가 가리키는 폴더는 남긴다
function prune(dir, keep) {
  const cur = currentTarget(dir);
  const all = versions(dir);
  const removed = [];
  for (const n of all.slice(keep)) {
    if (n === cur) continue;
    fs.rmSync(path.join(dir, n), { recursive: true, force: true });
    removed.push(n);
  }
  return removed;
}

// 이전 버전(또는 이름을 준 버전)으로 정션만 되돌린다
function rollback({ dir = toolsDir(), name = null } = {}) {
  const cur = currentTarget(dir);
  const all = versions(dir);
  const to = name || all.find((n) => n !== cur);
  if (!to || !all.includes(to)) throw new Error(`되돌릴 버전이 없습니다(있는 것: ${all.join(', ') || '없음'})`);
  point(dir, to);
  return { from: cur, to };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === 'rollback') {
      const r = rollback({ name: args[1] || null });
      console.log(`되돌렸습니다: ${r.from || '(없음)'} → ${r.to}. VS Code에서 Reload Window를 하세요.`);
    } else {
      const k = args.indexOf('--keep');
      const r = deploy({ keep: k >= 0 ? Number(args[k + 1]) || KEEP : KEEP });
      console.log(`설치했습니다: ${path.join(r.dir, r.name)} (v${r.version}, 커밋 ${r.commit}), current → ${r.name}`);
      if (r.removed.length) console.log(`오래된 버전 정리: ${r.removed.join(', ')}`);
      if (r.stubChanged) console.log('껍데기 확장 내용이 바뀌었습니다: install.ps1 setup(또는 global)으로 다시 설치하세요.');
      if (!args.includes('--no-legacy')) execFileSync(process.execPath, [path.join(PKG, 'vscode', 'deploy.js')], { stdio: 'inherit' });
    }
  } catch (err) {
    console.error(`배포 실패: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { deploy, rollback, versions, currentTarget, point, prune, toolsDir };
