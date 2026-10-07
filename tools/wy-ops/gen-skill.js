#!/usr/bin/env node
// pm-ops 스킬 생성기(wy-ops 5단계): 코어 템플릿 + 프로젝트 설정 + 프로젝트 부록 → .claude/skills/pm-ops/SKILL.md
//   node tools/wy-ops/gen-skill.js [--check] [--root <저장소>] [--out <파일>]
//   --check  쓰지 않고 지금 파일과 비교만 한다(줄바꿈·BOM은 무시). 다르면 처음 달라진 줄을 보여 주고 종료 코드 1
// 입력
//   tools/wy-ops/templates/pm-ops/SKILL.md   코어(모든 프로젝트 공통, {{pmRole}} 같은 설정 자리표시자)
//   <저장소>/.claude/wy-ops.json              pmRole, commitRole, docs, memory, rotation, approvals
//   <저장소>/.claude/ops/pm-ops.project.md    프로젝트 부록(있으면 코어 뒤에 그대로 붙인다)
// 실행할 때 부록을 따로 읽게 하면 빠뜨릴 수 있어, 한 파일로 합친다.
const fs = require('fs');
const path = require('path');
const { loadOpsConfig, findProjectRoot } = require('./vscode/opsConfig');
const { fill } = require('./gen-agents');

const CORE = path.join(__dirname, 'templates', 'pm-ops', 'SKILL.md');
const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

function generate(root) {
  const ops = loadOpsConfig(root);
  if (!ops) throw new Error(`${root}/.claude/wy-ops.json을 읽지 못했습니다`);
  let text = fill(read(CORE), ops, CORE);
  const addendum = path.join(root, '.claude', 'ops', 'pm-ops.project.md');
  if (fs.existsSync(addendum)) text = text.replace(/\n*$/, '\n\n') + read(addendum).replace(/\n*$/, '\n');
  return text;
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const unknown = argv.filter((a, i) => !['--check', '--root', '--out'].includes(a) && !['--root', '--out'].includes(argv[i - 1]));
  if (unknown.length) throw new Error(`알 수 없는 인자: ${unknown.join(' ')}`);
  const root = path.resolve(at('--root') || findProjectRoot(process.cwd()) || '');
  if (!fs.existsSync(path.join(root, '.claude', 'wy-ops.json'))) throw new Error('프로젝트 설정(.claude/wy-ops.json)을 찾지 못했습니다. --root로 저장소를 지정하세요');
  const file = path.resolve(at('--out') || path.join(root, '.claude', 'skills', 'pm-ops', 'SKILL.md'));
  const text = generate(root);
  if (check) {
    const cur = fs.existsSync(file) ? read(file) : null;
    if (cur === text) {
      console.log(`같음  ${file}`);
      process.exit(0);
    }
    const a = text.split('\n');
    const b = (cur || '').split('\n');
    const i = a.findIndex((l, k) => l !== b[k]);
    console.log(cur === null ? `없음  ${file}` : `다름  ${file} (${i + 1}행)\n  생성: ${a[i]}\n  지금: ${b[i]}`);
    process.exit(1);
  }
  // 이미 있는 파일은 그 줄바꿈을 따른다(gen-agents.js와 같음)
  const crlf = fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('\r\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, crlf ? text.replace(/\n/g, '\r\n') : text, 'utf8');
  console.log(`썼음  ${file}${crlf ? ' (CRLF)' : ''}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('gen-skill: ' + err.message);
    process.exit(2);
  }
}

module.exports = { generate };
