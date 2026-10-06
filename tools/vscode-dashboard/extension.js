// 세션 현황 대시보드: 메모리·프로세스·Claude 세션을 사이드바 webview에 보여 주고, WY 승인 센터 탭을 띄운다.
const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { ApprovalCenter } = require('./approvalCenter');
const { loadOpsConfig } = require('./opsConfig');

const VIEW_ID = 'erpSessions.panel';
const INTERVAL = { memory: 5000, processes: 15000, sessions: 10000 };
const COMMAND_TIMEOUT = 8000;

// stderr는 콘솔 코드 페이지(CP949)라 글자가 깨지므로 오류 문구는 종료 코드로만 만든다
function run(label, file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: COMMAND_TIMEOUT, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (!err) resolve(stdout);
      else if (err.killed) reject(new Error(`${label} 응답 없음(${COMMAND_TIMEOUT / 1000}초)`));
      else if (err.code === 'ENOENT') reject(new Error(`${label} 명령을 찾을 수 없음`));
      else reject(new Error(`${label} 실패(종료 코드 ${err.code})`));
    });
  });
}

function firstLine(err) {
  return String((err && err.message) || err).split(/\r?\n/).find((l) => l.trim()) || '알 수 없는 오류';
}

function readMemory() {
  return { total: os.totalmem(), free: os.freemem() };
}

// tasklist CSV: "이미지","PID","세션 이름","세션#","메모리 사용"("12,345 K")
async function readProcesses() {
  const out = await run('tasklist', 'tasklist', ['/fo', 'csv', '/nh']);
  const groups = new Map();
  for (const line of out.split(/\r?\n/)) {
    const cols = line.match(/"([^"]*)"/g);
    if (!cols || cols.length < 5) continue;
    const image = cols[0].slice(1, -1).replace(/\.exe$/i, '');
    const kb = Number(cols[4].replace(/[^\d]/g, ''));
    if (!kb) continue;
    const key = image.toLowerCase();
    const g = groups.get(key) || { name: image, bytes: 0, count: 0 };
    g.bytes += kb * 1024;
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
}

// claude는 npm .cmd 래퍼라 cmd.exe로 실행한다
async function readSessions() {
  const out = await run('claude agents', process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'claude agents --json --all']);
  let list;
  try {
    list = JSON.parse(out);
  } catch {
    throw new Error('claude agents 출력을 해석하지 못함');
  }
  return list.map((s) => ({
    name: s.name || '(이름 없음)',
    kind: s.kind,
    status: s.status,
    state: s.state,
    waitingFor: s.waitingFor,
    id: s.id || (s.sessionId || '').slice(0, 8),
    startedAt: s.startedAt,
  }));
}

// 역할 순서: 프로젝트 설정(.claude/wy-ops.json)의 roles, 없으면 CLAUDE.md 세션 역할 표, 둘 다 없으면 빈 목록
function readRoles() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) return [];
  const ops = loadOpsConfig(folder.uri.fsPath);
  if (ops && Array.isArray(ops.roles) && ops.roles.length) return ops.roles.map((r) => r && r.name).filter(Boolean);
  try {
    const text = fs.readFileSync(path.join(folder.uri.fsPath, 'CLAUDE.md'), 'utf8');
    const section = text.split(/^## /m).find((s) => s.startsWith('세션 역할')) || '';
    return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  } catch {
    return [];
  }
}

const READERS = { memory: async () => readMemory(), processes: readProcesses, sessions: readSessions };

class Provider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.view = undefined;
    this.timers = [];
    this.inflight = {};
    this.cache = {};
    this.folded = new Set(); // 접어 둔 블록은 읽지 않는다
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((msg) => {
      // 숨겼다 다시 보이면 webview가 새로 뜨므로 ready마다 마지막 값을 다시 보낸다
      if (msg.type === 'ready') {
        this.folded = new Set(msg.folded || []);
        this.post({ type: 'roles', data: readRoles() });
        Object.values(this.cache).forEach((m) => this.post(m));
        if (view.visible) this.start();
      } else if (msg.type === 'refresh') {
        this.refreshAll().then(() => this.post({ type: 'refreshed' }));
      } else if (msg.type === 'fold') {
        if (msg.folded) this.folded.add(msg.source);
        else {
          this.folded.delete(msg.source);
          this.update(msg.source);
        }
      }
    });
    view.onDidChangeVisibility(() => (view.visible ? this.start() : this.stop()));
    view.onDidDispose(() => {
      this.stop();
      this.view = undefined;
    });
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(media, f)).toString();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource}`,
    ].join('; ');
    return fs
      .readFileSync(path.join(media.fsPath, 'panel.html'), 'utf8')
      .replace(/{{csp}}/g, csp)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{css}}/g, uri('panel.css'))
      .replace(/{{js}}/g, uri('panel.js'));
  }

  post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  // 같은 출처를 읽는 중이면 새로 띄우지 않고 그 결과를 기다린다
  update(source) {
    if (!this.inflight[source]) {
      this.inflight[source] = (async () => {
        let msg;
        try {
          msg = { type: source, data: await READERS[source](), at: Date.now() };
        } catch (err) {
          msg = { type: source, error: firstLine(err), at: Date.now() };
        }
        this.inflight[source] = undefined;
        this.cache[source] = msg;
        this.post(msg);
      })();
    }
    return this.inflight[source];
  }

  refreshAll() {
    return Promise.all(Object.keys(READERS).filter((s) => !this.folded.has(s)).map((s) => this.update(s)));
  }

  // 패널이 보일 때만 폴링한다
  start() {
    this.stop();
    this.refreshAll();
    this.timers = Object.keys(READERS).map((s) => setInterval(() => this.folded.has(s) || this.update(s), INTERVAL[s]));
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }
}

function activate(context) {
  const provider = new Provider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand('erpSessions.refresh', () => provider.refreshAll()),
    { dispose: () => provider.stop() },
  );
  // 승인 센터가 실패해도 세션 현황은 계속 쓸 수 있게 따로 띄운다
  try {
    new ApprovalCenter(context);
  } catch (err) {
    vscode.window.showErrorMessage(`WY 승인 센터를 시작하지 못했습니다: ${err.message}`);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
