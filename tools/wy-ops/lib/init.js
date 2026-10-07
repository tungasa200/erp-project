// 새 프로젝트에 운영 도구 파일을 만든다(OPS-10-2). install.js init이 부르고, settings 병합·승인 폴더·doctor는 install.js가 이어서 한다.
//   init({ project, name, prefix, roles, templatesDir }) → { files: [{ file, action }], claudeMd, ops }
//   만드는 것: .claude/wy-ops.json, .claude/ops/roles/<prefix><짧은 이름>.md, .claude/ops/pm-ops.project.md,
//              .claude/agents/*.md·.claude/skills/pm-ops/(gen-agents·gen-skill), .gitignore 줄, .claude/wy-ops.lock.json
//   이미 있는 파일은 덮지 않는다(lock에 없는 기존 파일 = unmanaged → 건너뜀). CLAUDE.md는 고치지 않고 넣을 절만 돌려준다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const lock = require('./lock');

const PKG = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(f, 'utf8');

function fillText(text, vars) {
  return text.replace(/\{\{(project|prefix|rolesTable)\}\}/g, (m, k) => (vars[k] == null ? m : vars[k]));
}

function rolesTable(ops) {
  const rows = ops.roles.map((r) => `| \`${r.name}\` | ${r.summary || ''} |`);
  return ['| 이름 | 역할 |', '|---|---|', ...rows].join('\n');
}

function init({ project, name, prefix, roles = null, templatesDir = path.join(PKG, 'templates'), version = null }) {
  if (!project) throw new Error('project가 없습니다');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name || '')) throw new Error(`프로젝트 이름은 영문·숫자·._-로: ${name}`);
  if (!/^[A-Za-z0-9]{1,8}-$/.test(prefix || '')) throw new Error(`역할 접두사는 영문·숫자 1~8자 + '-'(예: AB-): ${prefix}`);
  const vars = { project: name, prefix };
  fs.mkdirSync(project, { recursive: true });
  const cfgFile = path.join(project, '.claude', 'wy-ops.json');
  const l = lock.readLock(project);
  const planned = [];
  const plan = (file, content) => planned.push({ ...lock.decide(project, l, file, content), content });

  // 1. 설정: 이미 있으면 그것을 쓴다(덮지 않음)
  let ops;
  if (fs.existsSync(cfgFile)) {
    ops = JSON.parse(read(cfgFile).replace(/^﻿/, ''));
    planned.push({ file: '.claude/wy-ops.json', action: 'unmanaged', content: null });
  } else {
    ops = JSON.parse(fillText(read(path.join(templatesDir, 'wy-ops.json')), vars));
    if (roles && roles.length) {
      const keep = new Set(roles.map((r) => `${prefix}${r}`));
      keep.add(ops.pmRole);
      keep.add(ops.commitRole); // 커밋 역할은 가드 훅이 기대하므로 늘 남긴다
      ops.roles = ops.roles.filter((r) => keep.has(r.name));
    }
    plan('.claude/wy-ops.json', JSON.stringify(ops, null, 2) + '\n');
  }

  // 2. 역할 원본(agent:true만): templates/roles/<짧은 이름>.md
  for (const r of ops.roles.filter((x) => x.agent)) {
    const short = r.name.startsWith(prefix) ? r.name.slice(prefix.length) : r.name;
    const src = path.join(templatesDir, 'roles', `${short}.md`);
    if (!fs.existsSync(src)) throw new Error(`역할 템플릿이 없습니다: roles/${short}.md`);
    plan(`.claude/ops/roles/${r.name}.md`, fillText(read(src), vars));
  }
  plan('.claude/ops/pm-ops.project.md', fillText(read(path.join(templatesDir, 'pm-ops.project.md')), vars));

  // 3. .gitignore: 빠진 줄만 덧붙인다(사람이 관리하는 파일이라 lock에 넣지 않음)
  const gi = path.join(project, '.gitignore');
  const have = fs.existsSync(gi) ? read(gi) : '';
  const want = read(path.join(templatesDir, 'gitignore.txt')).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  const missing = want.filter((w) => !have.split(/\r?\n/).map((s) => s.trim()).includes(w));
  if (missing.length) fs.writeFileSync(gi, `${have}${have && !have.endsWith('\n') ? '\n' : ''}\n# WY Ops\n${missing.join('\n')}\n`);

  let next = lock.writePlanned(project, l, planned.filter((p) => p.content != null), version);

  // 4. 생성: gen-agents·gen-skill(사람이 고친 생성 파일이 있으면 생성기를 돌리지 않는다 — update가 차이만 보여 줌)
  const gen = (script) => execFileSync(process.execPath, [path.join(PKG, script), '--root', project], { encoding: 'utf8' });
  gen('gen-agents.js');
  gen('gen-skill.js');
  const generated = [];
  for (const f of listGenerated(project)) generated.push({ ...lock.decide(project, next, f, read(path.join(project, f))), content: read(path.join(project, f)) });
  next = lock.writePlanned(project, next, generated, version);

  const claudeMd = fillText(read(path.join(templatesDir, 'claude-md.md')), { ...vars, rolesTable: rolesTable(ops) });
  return {
    files: [...planned, ...generated].map(({ file, action }) => ({ file, action })),
    gitignoreAdded: missing,
    claudeMd,
    ops,
  };
}

// 생성 파일 목록(프로젝트 기준 상대 경로)
function listGenerated(project) {
  const out = [];
  const agents = path.join(project, '.claude', 'agents');
  if (fs.existsSync(agents)) for (const f of fs.readdirSync(agents).filter((x) => x.endsWith('.md')).sort()) out.push(`.claude/agents/${f}`);
  for (const f of ['.claude/skills/pm-ops/SKILL.md', '.claude/skills/pm-ops/scripts/session.ps1']) if (fs.existsSync(path.join(project, f))) out.push(f);
  return out;
}

module.exports = { init, listGenerated, rolesTable, fillText };
