// 생성 파일 보호(OPS-10-3): init·update가 만든 파일의 해시를 .claude/wy-ops.lock.json에 남기고,
// 다음 update 때 사람이 고친 파일(지금 해시 ≠ lock 해시)은 덮지 않고 차이만 보여 준다.
//   lock 형식: { schema: 1, version, files: { "<프로젝트 기준 상대 경로>": "<sha256>" } }
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOCK = path.join('.claude', 'wy-ops.lock.json');
// CRLF 체크아웃(autocrlf)에서도 같은 해시가 나오게 줄바꿈을 맞춘 뒤 잰다
const hash = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
const rel = (root, file) => path.relative(root, path.resolve(root, file)).replace(/\\/g, '/');

function readLock(root) {
  try {
    const l = JSON.parse(fs.readFileSync(path.join(root, LOCK), 'utf8'));
    return l && typeof l.files === 'object' ? l : { schema: 1, files: {} };
  } catch {
    return { schema: 1, files: {} };
  }
}

// 파일 하나를 어떻게 할지: create(없음) · same(내용 같음) · update(lock과 같은 상태라 덮어도 됨)
//   · modified(사람이 고침 → 덮지 않음) · unmanaged(lock에 없는데 이미 있음 → 덮지 않음, init이 남의 파일을 덮지 않게)
function decide(root, lock, file, content) {
  const key = rel(root, file);
  const full = path.join(root, key);
  if (!fs.existsSync(full)) return { file: key, action: 'create' };
  const now = hash(fs.readFileSync(full, 'utf8'));
  if (now === hash(content)) return { file: key, action: 'same' };
  const locked = lock.files[key];
  if (!locked) return { file: key, action: 'unmanaged' };
  return { file: key, action: locked === now ? 'update' : 'modified' };
}

// 계획대로 쓴다. create·update만 쓰고, 쓴 파일과 same인 파일의 해시를 lock에 남긴다
function writePlanned(root, lock, items, version) {
  const next = { schema: 1, version: version || lock.version || null, files: { ...lock.files } };
  for (const { file, content, action } of items) {
    if (action === 'create' || action === 'update') {
      const full = path.join(root, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    if (action === 'create' || action === 'update' || action === 'same') next.files[file] = hash(content);
  }
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, LOCK), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

module.exports = { LOCK, hash, readLock, decide, writePlanned };
