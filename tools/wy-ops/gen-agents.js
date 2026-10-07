#!/usr/bin/env node
// 역할 파일 생성기(wy-ops 4단계): 템플릿 + 역할 원본 + 프로젝트 설정 → .claude/agents/<역할>.md
//   node tools/wy-ops/gen-agents.js [--check] [--root <저장소>] [--out <폴더>]
//   --check  쓰지 않고 지금 파일과 비교만 한다(줄바꿈·BOM은 무시). 다르면 처음 달라진 줄을 보여 주고 종료 코드 1
// 입력
//   <저장소>/.claude/wy-ops.json         roles(agent:false는 건너뜀), pmRole, commitRole, docs, memory …
//   <저장소>/.claude/ops/agent.md        프로젝트 템플릿(없으면 tools/wy-ops/templates/agent.md)
//   <저장소>/.claude/ops/roles/<역할>.md  역할 원본: frontmatter(description + 추가 줄) + '이 역할의 작업 방식' 본문
// 자리표시자: {{name}} {{description}} {{frontmatter}} {{body}}와 설정 경로({{pmRole}}, {{docs.progress}} …).
//   {{경로|size}}는 MB 값을 1024의 배수면 'nGB', 아니면 'nMB'로 쓴다. 모르는 자리표시자는 오류로 멈춘다.
const fs = require('fs');
const path = require('path');
const { loadOpsConfig, findProjectRoot } = require('./vscode/opsConfig');

const DEFAULT_TEMPLATE = path.join(__dirname, 'templates', 'agent.md');

function args(argv) {
  const out = { check: false, root: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') out.check = true;
    else if (argv[i] === '--root') out.root = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else throw new Error(`알 수 없는 인자: ${argv[i]}`);
  }
  return out;
}

const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

// 역할 원본: --- description: …, 추가 줄 … --- 본문
function readRole(file) {
  const m = read(file).match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: frontmatter(---)가 없습니다`);
  const lines = m[1].split('\n');
  const desc = lines.find((l) => l.startsWith('description: '));
  if (!desc) throw new Error(`${file}: description이 없습니다`);
  return {
    description: desc.slice('description: '.length),
    frontmatter: lines.filter((l) => l !== desc).map((l) => l + '\n').join(''),
    body: m[2].replace(/\s+$/, ''),
  };
}

const size = (mb) => (Number(mb) % 1024 === 0 ? `${Number(mb) / 1024}GB` : `${Number(mb)}MB`);

function fill(template, values, where) {
  return template.replace(/\{\{([\w.]+)(\|size)?\}\}/g, (all, key, filter) => {
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), values);
    if (v === undefined || v === null || typeof v === 'object') throw new Error(`${where}: 자리표시자 ${all}의 값이 없습니다`);
    return filter ? size(v) : String(v);
  });
}

function generate(root) {
  const ops = loadOpsConfig(root);
  if (!ops) throw new Error(`${root}/.claude/wy-ops.json을 읽지 못했습니다`);
  const projectTemplate = path.join(root, '.claude', 'ops', 'agent.md');
  const templateFile = fs.existsSync(projectTemplate) ? projectTemplate : DEFAULT_TEMPLATE;
  const template = read(templateFile);
  const roles = (ops.roles || []).filter((r) => r && r.name && r.agent !== false);
  if (!roles.length) throw new Error('wy-ops.json에 역할 파일을 만들 역할(agent가 false가 아닌 roles)이 없습니다');
  return roles.map((r) => {
    const roleFile = path.join(root, '.claude', 'ops', 'roles', `${r.name}.md`);
    if (!fs.existsSync(roleFile)) throw new Error(`역할 원본이 없습니다: ${roleFile}`);
    const role = readRole(roleFile);
    return { name: r.name, text: fill(template, { ...ops, ...role, name: r.name }, templateFile) };
  });
}

function firstDiff(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return { line: i + 1, want: x[i], got: y[i] };
  return null;
}

function main() {
  const opt = args(process.argv.slice(2));
  const root = path.resolve(opt.root || findProjectRoot(process.cwd()) || '');
  if (!fs.existsSync(path.join(root, '.claude', 'wy-ops.json'))) throw new Error('프로젝트 설정(.claude/wy-ops.json)을 찾지 못했습니다. --root로 저장소를 지정하세요');
  const outDir = path.resolve(opt.out || path.join(root, '.claude', 'agents'));
  let differ = 0;
  for (const { name, text } of generate(root)) {
    const file = path.join(outDir, `${name}.md`);
    if (opt.check) {
      // core.autocrlf=true인 체크아웃은 CRLF로 풀리므로, 읽을 때처럼 BOM·줄 끝을 정규화해 비교한다
      const cur = fs.existsSync(file) ? read(file) : null;
      if (cur === text) console.log(`같음  ${name}`);
      else {
        differ++;
        const d = cur === null ? null : firstDiff(text, cur);
        console.log(cur === null ? `없음  ${name}` : `다름  ${name} (${d.line}행)\n  생성: ${d.want}\n  지금: ${d.got}`);
      }
    } else {
      // 이미 있는 파일은 그 줄바꿈(CRLF/LF)을 따라 줄바꿈만 바뀐 diff가 생기지 않게 한다. 새 파일은 LF, BOM 없음
      const crlf = fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('\r\n');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(file, crlf ? text.replace(/\n/g, '\r\n') : text, 'utf8');
      console.log(`썼음  ${file}${crlf ? ' (CRLF)' : ''}`);
    }
  }
  if (opt.check) {
    console.log(differ ? `다른 파일 ${differ}개` : '모두 같음');
    process.exit(differ ? 1 : 0);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('gen-agents: ' + err.message);
    process.exit(2);
  }
}

module.exports = { generate, readRole, fill, size };
