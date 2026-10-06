#!/usr/bin/env node
// 설치본 갱신: 저장소의 개발본(tools/vscode-dashboard)을 저장소 밖 설치 폴더로 복사한다.
//   node tools/vscode-dashboard/deploy.js [--force]
// VS Code 확장과 승인 가드 훅은 설치 폴더를 쓰므로, 개발 중인 파일이 쓰는 확장에 바로 실리지 않는다.
// 커밋 안 된 변경이 있으면 거부한다(--force로 무시). 새 폴더를 다 만든 뒤 이름을 바꿔 한 번에 교체한다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = __dirname;
const TARGET = process.env.WY_TOOLS_DIR ? path.join(process.env.WY_TOOLS_DIR, 'vscode-dashboard') : path.join(os.homedir(), '.wy-tools', 'vscode-dashboard');
const FILES = ['package.json', 'extension.js', 'approvalCenter.js', 'approvalStore.js', 'README.md', 'media', 'hooks'];

function git(args) {
  return execFileSync('git', args, { cwd: SRC, encoding: 'utf8' }).trim();
}

function main() {
  const force = process.argv.includes('--force');
  const dirty = git(['status', '--porcelain', '--untracked-files=all', '--', '.']);
  if (dirty && !force) {
    console.error('커밋 안 된 변경이 있어 배포하지 않습니다(--force로 무시):\n' + dirty);
    process.exit(1);
  }
  const version = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version;
  const stage = `${TARGET}.new`;
  const old = `${TARGET}.old`;
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const f of FILES) fs.cpSync(path.join(SRC, f), path.join(stage, f), { recursive: true });
  fs.writeFileSync(
    path.join(stage, 'deployed.json'),
    JSON.stringify({ version, commit: git(['rev-parse', '--short', 'HEAD']), dirty: !!dirty, deployedAt: new Date().toISOString() }, null, 2) + '\n',
  );

  fs.rmSync(old, { recursive: true, force: true });
  try {
    if (fs.existsSync(TARGET)) fs.renameSync(TARGET, old);
    fs.renameSync(stage, TARGET);
    fs.rmSync(old, { recursive: true, force: true });
  } catch (err) {
    // 폴더를 다른 프로세스가 잡고 있어 이름을 못 바꾸면 파일을 덮어쓴다
    if (!fs.existsSync(TARGET) && fs.existsSync(old)) fs.renameSync(old, TARGET);
    fs.cpSync(stage, TARGET, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
    console.warn(`폴더 교체 대신 덮어썼습니다(${err.code || err.message}).`);
  }
  console.log(`배포했습니다: ${TARGET} (v${version}${dirty ? ', 커밋 안 된 변경 포함' : ''})`);
  console.log('VS Code에서 "Developer: Reload Window"를 실행하면 새 코드가 실립니다.');
}

main();
